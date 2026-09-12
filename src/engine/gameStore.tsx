import React, { createContext, useCallback, useContext, useMemo, useReducer } from 'react'
import { getEpisode as getAuthoredEpisode } from '@/content/episodes'
import { characterGroups, getGroup } from '@/content/characterGroups'
import { getCharacter } from '@/content/characters'
import type {
  Character,
  CharacterGroup,
  ChatTurn,
  Choice,
  ConceptId,
  DecisionRecord,
  Episode,
  Mastery,
  PlayerState,
  Scene,
  WagerResult,
} from '@/types'
import { applyDecision, baselineMastery, episodeScore, levelFromXp, selectVariant } from './adaptive'
import { awardForDecision, awardForEpisode, equip, freshCosmetics, purchase, unequip } from './cosmetics'
import { estimateSuccess, resolveWager, wagerOptions, type WagerOption, type WagerTier } from './risk'
import { validateEpisode } from './validateEpisode'

/* ============================================================================
 * GAME ENGINE
 *
 * A reducer. That is the point: every state transition in the player's
 * experience is a pure function of (state, action) over authored data. No
 * model output can move the player to a scene that does not exist, skip an
 * act, or invent a branch. LLMs live strictly at the edges — conversation,
 * coaching, and authoring.
 *
 * Actions carry ids, never payloads the engine would have to trust: a choice is
 * looked up on the current scene, a wager's stake and payout are derived from
 * the player's balance. Generated episodes enter through PUBLISH_EPISODE, which
 * refuses any graph that fails validation — so nothing unvalidated is playable.
 * ========================================================================== */

export type View =
  | 'signin'
  | 'pickshow'
  | 'home'
  | 'intro'
  | 'scene'
  | 'profile'
  | 'shop'
  | 'authoring'
  | 'results'

/**
 * Who is using the app. Auth is a deliberate prototype stub — picking a
 * provider on the sign-in screen IS the sign-in. Nothing here is a credential
 * and nothing is verified; it exists to route employees to the lobby and
 * admins to the Studio, and to keep that choice across reloads.
 */
export type SessionRole = 'employee' | 'admin'

export interface Session {
  role: SessionRole
  /** Display name of the fake IdP, e.g. 'Okta'. Shown, never checked. */
  provider: string
  signedInAt: number
}
export type Phase = 'dialogue' | 'wager' | 'choices' | 'outcome' | 'ending'

export interface Adaptation {
  focus: ConceptId
  rationale: string
  sceneId: string
}

export interface GameState {
  view: View
  /** Null until signed in; the app renders the sign-in screen while it is. */
  session: Session | null
  player: PlayerState
  /**
   * The chosen show. Null until this person picks one, which is what routes
   * them to the picker; see loadGroupId.
   */
  groupId: string | null
  /**
   * Who the player last selected on the home screen. Voice playback resolves
   * this character's voice profile, so selection alone changes the voice.
   */
  selectedCharacterId: string | null
  /** Generated episodes that passed validation. Company content, not progress. */
  published: Record<string, Episode>
  episodeId: string | null
  sceneId: string | null
  phase: Phase
  dialogueIndex: number
  /** Set while the wager terminal is open, cleared once resolved. */
  stagedWager: (WagerOption & { estimate: number }) | null
  lastChoice: Choice | null
  lastWager: WagerResult | null
  decisionStartedAt: number | null
  masteryAtStart: Record<ConceptId, Mastery> | null
  decisionsThisEpisode: DecisionRecord[]
  adaptation: Adaptation | null
  chat: { open: boolean; characterId: string | null }
  questionsAsked: number
  finalScore: number | null
  creditsDelta: number
}

const STORAGE_KEY = 'onboard.player.v1'
const PUBLISHED_KEY = 'onboard.published.v1'
const SESSION_KEY = 'onboard.session.v1'
const GROUP_KEY = 'onboard.group.v1'

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    // Storage is not a trust boundary: an unknown role falls back to the least
    // privileged one rather than being taken at face value.
    if (parsed?.role !== 'employee' && parsed?.role !== 'admin') return null
    return { role: parsed.role, provider: String(parsed.provider ?? ''), signedInAt: Number(parsed.signedInAt) || Date.now() }
  } catch {
    return null
  }
}

const saveSession = (sn: Session) => {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sn))
  } catch {
    /* private mode — the session lasts for this tab only */
  }
}

const clearSession = () => {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* nothing to clear */
  }
}

/**
 * The chosen show, or null if this person has never picked one.
 *
 * That null is load-bearing: it is the difference between "show me the picker"
 * and "take me to the lobby", so it must not be collapsed to a default here.
 * Everything downstream reads `getGroup(state.groupId)`, which already falls
 * back to the first group, so a null id renders fine while the picker is on
 * its way.
 *
 * Storage is not a trust boundary, exactly as with the session above: an id
 * that no longer names a group reads as "never chosen" rather than being
 * passed through.
 */
function loadGroupId(): string | null {
  try {
    const raw = localStorage.getItem(GROUP_KEY)
    return characterGroups.some((g) => g.id === raw) ? raw : null
  } catch {
    return null
  }
}

const saveGroupId = (id: string) => {
  try {
    localStorage.setItem(GROUP_KEY, id)
  } catch {
    /* private mode — the choice lasts for this tab only */
  }
}

/**
 * Where each role belongs once signed in. Employees who have never chosen a
 * show get the picker first; admins go straight to the Studio, because the
 * show scopes the lobby and they are not headed there.
 */
const landingFor = (role: SessionRole, groupId: string | null): View =>
  role === 'admin' ? 'authoring' : groupId ? 'home' : 'pickshow'

function loadPlayer(): PlayerState {
  const fresh: PlayerState = {
    name: 'NEW ASSOCIATE',
    level: 3,
    xp: 980,
    credits: 1240,
    reputation: 3,
    mastery: baselineMastery(),
    decisions: [],
    completedEpisodes: [],
    transcript: [],
    cosmetics: freshCosmetics(),
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fresh
    const parsed = JSON.parse(raw) as PlayerState
    return {
      ...fresh,
      ...parsed,
      mastery: { ...fresh.mastery, ...parsed.mastery },
      cosmetics: { ...fresh.cosmetics, ...parsed.cosmetics },
    }
  } catch {
    return fresh
  }
}

const savePlayer = (p: PlayerState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* private mode — progression is in-memory only */
  }
}

function loadPublished(): Record<string, Episode> {
  try {
    const raw = localStorage.getItem(PUBLISHED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Episode>
    // Storage is not a trust boundary: stored graphs are re-validated on load.
    return Object.fromEntries(Object.entries(parsed).filter(([, ep]) => validateEpisode(ep).ok))
  } catch {
    return {}
  }
}

const savePublished = (eps: Record<string, Episode>) => {
  try {
    localStorage.setItem(PUBLISHED_KEY, JSON.stringify(eps))
  } catch {
    /* quota or private mode — published episodes last for this session */
  }
}

export const initialState = (): GameState => {
  const session = loadSession()
  const groupId = loadGroupId()
  return {
  view: session ? landingFor(session.role, groupId) : 'signin',
  session,
  player: loadPlayer(),
  groupId,
  selectedCharacterId: null,
  published: loadPublished(),
  episodeId: null,
  sceneId: null,
  phase: 'dialogue',
  dialogueIndex: 0,
  stagedWager: null,
  lastChoice: null,
  lastWager: null,
  decisionStartedAt: null,
  masteryAtStart: null,
  decisionsThisEpisode: [],
  adaptation: null,
  chat: { open: false, characterId: null },
  questionsAsked: 0,
  finalScore: null,
  creditsDelta: 0,
  }
}

export type Action =
  | { type: 'GOTO'; view: View }
  | { type: 'SIGN_IN'; role: SessionRole; provider: string }
  | { type: 'SIGN_OUT' }
  | { type: 'SELECT_GROUP'; groupId: string }
  | { type: 'SELECT_CHARACTER'; characterId: string }
  | { type: 'SELECT_EPISODE'; episodeId: string }
  | { type: 'START_EPISODE' }
  | { type: 'ADVANCE_DIALOGUE' }
  | { type: 'OPEN_CHOICES' }
  | { type: 'STAGE_WAGER'; tier: WagerTier }
  | { type: 'SKIP_WAGER' }
  | { type: 'CHOOSE'; choiceId: string }
  | { type: 'CONTINUE' }
  | { type: 'OPEN_CHAT'; characterId: string }
  | { type: 'CLOSE_CHAT' }
  | { type: 'CHAT_TURN'; turn: ChatTurn }
  | { type: 'PUBLISH_EPISODE'; episode: Episode; status: 'draft' | 'published' }
  | { type: 'REMOVE_EPISODE'; episodeId: string }
  | { type: 'RESET_PROGRESS' }
  | { type: 'BUY_ITEM'; itemId: string }
  | { type: 'EQUIP_ITEM'; itemId: string }
  | { type: 'UNEQUIP_ITEM'; itemId: string }

/** Authored episodes first — a generated graph can never shadow one. */
export const findEpisode = (state: Pick<GameState, 'published'>, id: string | null | undefined): Episode | undefined =>
  id ? (getAuthoredEpisode(id) ?? state.published[id]) : undefined

/** Enter a scene, resolving adaptive variant slots deterministically. */
function enterScene(state: GameState, ep: Episode, sceneId: string): GameState {
  let scene = ep.scenes[sceneId]
  let adaptation = state.adaptation

  if (scene?.variants?.length) {
    const pick = selectVariant(scene, state.player.mastery)
    adaptation = { focus: pick.focus, rationale: pick.rationale, sceneId: pick.sceneId }
    scene = ep.scenes[pick.sceneId]
    sceneId = pick.sceneId
  }

  return {
    ...state,
    sceneId,
    phase: scene.kind === 'ending' ? 'ending' : 'dialogue',
    dialogueIndex: 0,
    stagedWager: null,
    adaptation,
    chat: { open: false, characterId: null },
    decisionStartedAt: scene.kind === 'decision' ? Date.now() : null,
  }
}

function finishEpisode(state: GameState, ep: Episode): GameState {
  const score = episodeScore(state.decisionsThisEpisode)
  const best = state.decisionsThisEpisode.filter((d) => d.quality === 'best').length
  const xp = Math.round(score * 3.1) + best * 45
  const progressed: PlayerState = {
    ...state.player,
    xp: state.player.xp + xp,
    level: levelFromXp(state.player.xp + xp),
    completedEpisodes: [...new Set([...state.player.completedEpisodes, ep.id])],
    decisions: [...state.player.decisions, ...state.decisionsThisEpisode],
  }
  const player = awardForEpisode(progressed, state.decisionsThisEpisode)
  savePlayer(player)
  return { ...state, view: 'results', player, finalScore: score }
}

export function reducer(state: GameState, action: Action): GameState {
  const ep = findEpisode(state, state.episodeId)
  const scene: Scene | undefined = ep && state.sceneId ? ep.scenes[state.sceneId] : undefined

  switch (action.type) {
    case 'GOTO':
      /* Every destination is behind the sign-in gate. */
      if (!state.session) return state
      return { ...state, view: action.view }

    case 'SIGN_IN': {
      const session: Session = { role: action.role, provider: action.provider, signedInAt: Date.now() }
      saveSession(session)
      return { ...state, session, view: landingFor(action.role, state.groupId) }
    }

    case 'SIGN_OUT': {
      clearSession()
      /* Progression, published content and the chosen show all survive — this
       * is a role switch, not a wipe, and signing back in should not ask for a
       * show again. RESET_PROGRESS is the destructive one. */
      return { ...state, session: null, view: 'signin' }
    }

    case 'SELECT_GROUP': {
      const group = getGroup(action.groupId)
      if (group.id === state.groupId) return state
      /* The show is a preference, not view state: it is chosen once at
       * onboarding and changed rarely, so it outlives the tab. */
      saveGroupId(group.id)
      // Switching show drops a character selection that belonged to the old
      // one, so the voice never lags a group behind the visible cast.
      const keep = state.selectedCharacterId && getCharacter(state.selectedCharacterId).groupId === group.id
      return { ...state, groupId: group.id, selectedCharacterId: keep ? state.selectedCharacterId : null }
    }

    case 'SELECT_CHARACTER': {
      const ch = getCharacter(action.characterId)
      return { ...state, selectedCharacterId: ch.id, groupId: ch.groupId }
    }

    case 'SELECT_EPISODE': {
      const chosen = findEpisode(state, action.episodeId)
      if (!chosen || chosen.locked) return state
      return { ...state, episodeId: chosen.id, groupId: chosen.groupId, view: 'intro' }
    }

    case 'START_EPISODE': {
      const e = findEpisode(state, state.episodeId)
      if (!e) return state
      const base: GameState = {
        ...state,
        view: 'scene',
        decisionsThisEpisode: [],
        masteryAtStart: state.player.mastery,
        lastChoice: null,
        lastWager: null,
        adaptation: null,
        questionsAsked: 0,
        finalScore: null,
        creditsDelta: 0,
      }
      return enterScene(base, e, e.entrySceneId)
    }

    case 'ADVANCE_DIALOGUE': {
      if (!ep || !scene) return state
      const last = state.dialogueIndex >= scene.dialogue.length - 1
      if (!last) return { ...state, dialogueIndex: state.dialogueIndex + 1 }

      // Dialogue exhausted — move to the scene's terminal phase.
      if (scene.kind === 'decision') {
        return {
          ...state,
          phase: scene.allowWager && state.player.credits > 0 ? 'wager' : 'choices',
          decisionStartedAt: state.decisionStartedAt ?? Date.now(),
        }
      }
      if (scene.kind === 'consequence') return { ...state, phase: 'outcome' }
      if (scene.kind === 'ending') return { ...state, phase: 'ending' }
      return scene.next ? enterScene(state, ep, scene.next) : state
    }

    case 'OPEN_CHOICES':
      return { ...state, phase: 'choices', decisionStartedAt: state.decisionStartedAt ?? Date.now() }

    case 'STAGE_WAGER': {
      if (!scene || scene.kind !== 'decision') return state
      const option = wagerOptions(state.player.credits).find((o) => o.tier === action.tier)
      if (!option || option.stake <= 0 || option.stake > state.player.credits) return state
      return {
        ...state,
        // Recorded now, revealed after the world reacts.
        stagedWager: { ...option, estimate: estimateSuccess(scene, state.player.mastery).p },
        phase: 'choices',
        decisionStartedAt: Date.now(),
      }
    }

    case 'SKIP_WAGER':
      return { ...state, stagedWager: null, phase: 'choices', decisionStartedAt: Date.now() }

    case 'CHOOSE': {
      if (!ep || !scene) return state
      // The transition comes from the authored scene, never from the action.
      const choice = scene.choices?.find((c) => c.id === action.choiceId)
      if (!choice || !ep.scenes[choice.consequenceSceneId]) return state
      const ms = state.decisionStartedAt ? Date.now() - state.decisionStartedAt : 0

      let wager: WagerResult | undefined
      let credits = state.player.credits
      if (state.stagedWager) {
        const w = state.stagedWager
        const verdict = resolveWager(choice.quality)
        const payout = verdict === 'win' ? w.reward : verdict === 'push' ? w.stake : 0
        credits = credits - w.stake + payout
        wager = {
          tier: w.tier,
          staked: w.stake,
          payout,
          multiplier: w.multiplier,
          estimate: w.estimate,
          won: verdict === 'win',
        }
      }

      const record: DecisionRecord = {
        sceneId: scene.id,
        sceneTitle: scene.title ?? scene.id,
        choiceId: choice.id,
        choiceLabel: choice.text,
        ledgerLabel: choice.ledgerLabel,
        quality: choice.quality,
        concepts: choice.knowledgeConcepts,
        scoreImpact: choice.scoreImpact,
        wager,
        msToDecide: ms,
        threat: scene.threat,
      }

      const player = awardForDecision(
        { ...state.player, credits, mastery: applyDecision(state.player.mastery, choice) },
        record,
      )
      savePlayer(player)

      const mid: GameState = {
        ...state,
        player,
        lastChoice: choice,
        lastWager: wager ?? null,
        stagedWager: null,
        decisionsThisEpisode: [...state.decisionsThisEpisode, record],
        creditsDelta: state.creditsDelta + (wager ? wager.payout - wager.staked : 0),
      }
      return enterScene(mid, ep, choice.consequenceSceneId)
    }

    case 'CONTINUE': {
      if (!ep || !scene) return state
      if (scene.kind === 'ending') return finishEpisode(state, ep)
      if (!scene.next) return finishEpisode(state, ep)
      return enterScene(state, ep, scene.next)
    }

    case 'OPEN_CHAT':
      return { ...state, chat: { open: true, characterId: action.characterId } }

    case 'CLOSE_CHAT':
      return { ...state, chat: { open: false, characterId: null } }

    case 'CHAT_TURN': {
      const player = { ...state.player, transcript: [...state.player.transcript, action.turn] }
      return {
        ...state,
        player,
        questionsAsked: state.questionsAsked + (action.turn.role === 'player' ? 1 : 0),
      }
    }

    case 'PUBLISH_EPISODE': {
      const { episode } = action
      if (getAuthoredEpisode(episode.id) || !validateEpisode(episode).ok) return state
      const stamped: Episode = {
        ...episode,
        locked: false,
        provenance: episode.provenance && { ...episode.provenance, status: action.status },
      }
      const published = { ...state.published, [stamped.id]: stamped }
      savePublished(published)
      return { ...state, published }
    }

    case 'REMOVE_EPISODE': {
      if (!state.published[action.episodeId]) return state
      const { [action.episodeId]: _removed, ...published } = state.published
      savePublished(published)
      return { ...state, published }
    }

    case 'RESET_PROGRESS': {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }
      return initialState()
    }

    case 'BUY_ITEM':
    case 'EQUIP_ITEM':
    case 'UNEQUIP_ITEM': {
      const move = action.type === 'BUY_ITEM' ? purchase : action.type === 'EQUIP_ITEM' ? equip : unequip
      const player = move(state.player, action.itemId)
      if (player === state.player) return state
      savePlayer(player)
      return { ...state, player }
    }

    default:
      return state
  }
}

/* ------------------------------------------------------------------- context */

interface Store {
  state: GameState
  dispatch: React.Dispatch<Action>
  episode: Episode | undefined
  scene: Scene | undefined
  /** The roster panel currently in view on the home screen. */
  group: CharacterGroup
  /** Who the player selected on the home screen, if anyone. */
  selectedCharacter: Character | undefined
  /** Concepts live in the current moment — scopes retrieval for character chat. */
  activeConcepts: ConceptId[]
  advance: () => void
}

/*
 * One context object for the life of the page. This module exports a hook
 * next to a component, so Vite cannot Fast Refresh it: any file event on it —
 * including a sync client rewriting an unchanged file — re-runs the module, and
 * a fresh `createContext` here would leave components bound to the old copy
 * reading a context nobody provides ("useGame must be used inside
 * <GameProvider>" with GameProvider right above them). Every copy reuses the
 * first context instead. `import.meta.hot` is undefined in builds and tests.
 */
const Ctx: React.Context<Store | null> = import.meta.hot?.data.gameCtx ?? createContext<Store | null>(null)
if (import.meta.hot) import.meta.hot.data.gameCtx = Ctx

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const episode = findEpisode(state, state.episodeId)
  const scene = episode && state.sceneId ? episode.scenes[state.sceneId] : undefined
  const group = getGroup(state.groupId)
  const selectedCharacter = state.selectedCharacterId ? getCharacter(state.selectedCharacterId) : undefined

  const activeConcepts = useMemo<ConceptId[]>(() => {
    const fromChoices = scene?.choices?.flatMap((c) => c.knowledgeConcepts) ?? []
    const fromLast = state.lastChoice?.knowledgeConcepts ?? []
    const fromEpisode = episode?.concepts ?? []
    const ordered = [...fromChoices, ...fromLast, ...fromEpisode]
    return [...new Set(ordered)]
  }, [scene, state.lastChoice, episode])

  const advance = useCallback(() => dispatch({ type: 'ADVANCE_DIALOGUE' }), [])

  const value = useMemo<Store>(
    () => ({ state, dispatch, episode, scene, group, selectedCharacter, activeConcepts, advance }),
    [state, episode, scene, group, selectedCharacter, activeConcepts, advance],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useGame(): Store {
  const v = useContext(Ctx)
  if (!v) throw new Error('useGame must be used inside <GameProvider>')
  return v
}
