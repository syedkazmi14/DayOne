import React, { createContext, useCallback, useContext, useMemo, useReducer } from 'react'
import { getEpisode } from '@/content/episodes'
import { DEFAULT_GROUP_ID, getGroup } from '@/content/characterGroups'
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
import { adaptationRationale, applyDecision, baselineMastery, episodeScore, levelFromXp, weakestConcept } from './adaptive'
import { awardForDecision, awardForEpisode, equip, freshCosmetics, purchase, unequip } from './cosmetics'
import { resolveWager, type WagerOption } from './risk'

/* ============================================================================
 * GAME ENGINE
 *
 * A reducer. That is the point: every state transition in the player's
 * experience is a pure function of (state, action) over authored data. No
 * model output can move the player to a scene that does not exist, skip an
 * act, or invent a branch. LLMs live strictly at the edges — conversation,
 * coaching, and authoring.
 * ========================================================================== */

export type View = 'home' | 'intro' | 'scene' | 'profile' | 'shop' | 'authoring' | 'results'
export type Phase = 'dialogue' | 'wager' | 'choices' | 'outcome' | 'ending'

export interface Adaptation {
  focus: ConceptId
  rationale: string
  sceneId: string
}

export interface GameState {
  view: View
  player: PlayerState
  /** Which roster panel the home carousel is resting on. */
  groupId: string
  /**
   * Who the player last selected on the home screen. Voice playback resolves
   * this character's voice profile, so selection alone changes the voice.
   */
  selectedCharacterId: string | null
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

const initialState = (): GameState => ({
  view: 'home',
  player: loadPlayer(),
  groupId: DEFAULT_GROUP_ID,
  selectedCharacterId: null,
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
})

type Action =
  | { type: 'GOTO'; view: View }
  | { type: 'SELECT_GROUP'; groupId: string }
  | { type: 'SELECT_CHARACTER'; characterId: string }
  | { type: 'SELECT_EPISODE'; episodeId: string }
  | { type: 'START_EPISODE' }
  | { type: 'ADVANCE_DIALOGUE' }
  | { type: 'OPEN_CHOICES' }
  | { type: 'STAGE_WAGER'; option: WagerOption; estimate: number }
  | { type: 'SKIP_WAGER' }
  | { type: 'CHOOSE'; choice: Choice }
  | { type: 'CONTINUE' }
  | { type: 'OPEN_CHAT'; characterId: string }
  | { type: 'CLOSE_CHAT' }
  | { type: 'CHAT_TURN'; turn: ChatTurn }
  | { type: 'RESET_PROGRESS' }
  | { type: 'BUY_ITEM'; itemId: string }
  | { type: 'EQUIP_ITEM'; itemId: string }
  | { type: 'UNEQUIP_ITEM'; itemId: string }

/** Enter a scene, resolving adaptive variant slots deterministically. */
function enterScene(state: GameState, ep: Episode, sceneId: string): GameState {
  let scene = ep.scenes[sceneId]
  let adaptation = state.adaptation

  if (scene?.variants?.length) {
    const candidates = scene.variants.map((v) => v.conceptFocus)
    const focus = weakestConcept(state.player.mastery, candidates)
    const chosen = scene.variants.find((v) => v.conceptFocus === focus) ?? scene.variants[0]
    adaptation = {
      focus,
      rationale: adaptationRationale(state.player.mastery, focus),
      sceneId: chosen.sceneId,
    }
    scene = ep.scenes[chosen.sceneId]
    sceneId = chosen.sceneId
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

function reducer(state: GameState, action: Action): GameState {
  const ep = state.episodeId ? getEpisode(state.episodeId) : undefined
  const scene: Scene | undefined = ep && state.sceneId ? ep.scenes[state.sceneId] : undefined

  switch (action.type) {
    case 'GOTO':
      return { ...state, view: action.view }

    case 'SELECT_GROUP': {
      const group = getGroup(action.groupId)
      if (group.id === state.groupId) return state
      // Sliding to another roster drops a selection that belonged to the old
      // one, so the voice never lags a group behind the visible cast.
      const keep = state.selectedCharacterId && getCharacter(state.selectedCharacterId).groupId === group.id
      return { ...state, groupId: group.id, selectedCharacterId: keep ? state.selectedCharacterId : null }
    }

    case 'SELECT_CHARACTER': {
      const ch = getCharacter(action.characterId)
      return { ...state, selectedCharacterId: ch.id, groupId: ch.groupId }
    }

    case 'SELECT_EPISODE': {
      const chosen = getEpisode(action.episodeId)
      if (!chosen) return state
      return { ...state, episodeId: chosen.id, groupId: chosen.groupId, view: 'intro' }
    }

    case 'START_EPISODE': {
      const e = getEpisode(state.episodeId ?? '')
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

    case 'STAGE_WAGER':
      return {
        ...state,
        stagedWager: { ...action.option, estimate: action.estimate },
        phase: 'choices',
        decisionStartedAt: Date.now(),
      }

    case 'SKIP_WAGER':
      return { ...state, stagedWager: null, phase: 'choices', decisionStartedAt: Date.now() }

    case 'CHOOSE': {
      if (!ep || !scene) return state
      const { choice } = action
      const ms = state.decisionStartedAt ? Date.now() - state.decisionStartedAt : 0

      let wager: WagerResult | undefined
      let credits = state.player.credits
      if (state.stagedWager) {
        const verdict = resolveWager(choice.quality)
        const payout = verdict === 'win' ? state.stagedWager.reward : verdict === 'push' ? state.stagedWager.stake : 0
        credits = credits - state.stagedWager.stake + payout
        wager = {
          tier: state.stagedWager.tier,
          staked: state.stagedWager.stake,
          payout,
          estimate: state.stagedWager.estimate,
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
  const episode = state.episodeId ? getEpisode(state.episodeId) : undefined
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
