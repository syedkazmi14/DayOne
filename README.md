# ONBOARD

**Turn boring onboarding videos into interactive AI episodes.**

A 30-minute training video and a quiz teach almost nothing. ONBOARD takes the
same company material — handbooks, policy PDFs, decks, briefing-video
transcripts — and turns it into a short interactive episode where the employee
is the protagonist: they watch cinematic scenes, hit realistic workplace
situations, make decisions, live with the consequences, and can then argue with
the characters about what just happened.

```bash
npm install
npm run dev      # http://localhost:5173
```

No API keys required. The prototype runs fully offline and says so.

---

## The demo path

1. **Episode lobby** — `FIRST DAY · Episode 01 · Cybersecurity`
2. **Episode intro** — cast, concepts, and a note saying which act has already
   been personalised for you
3. **Cinematic scenes** — full-bleed, letterboxed, subtitled dialogue
4. **Risk terminal** — wager virtual credits against the system's estimate of
   whether you'll get this one right
5. **Decision** — three defensible options, none of them flagged
6. **Consequence** — the world reacts *first*; the explanation comes after
7. **Character chat** — text or voice, grounded in the knowledge base, with a
   retrieval inspector that shows the evidence
8. **Adaptive act three** — built around your weakest demonstrated concept
9. **Results + AI coach** — what your decisions revealed, and what changes next
10. **Profile** — mastery scores that actually drive 8 and 9
11. **Studio** — watch company documents become an episode

`npm run verify` clicks through all of it headlessly (see *Verification*).

---

## Architecture

The load-bearing decision: **AI generates and personalises the content; a
deterministic engine delivers the experience.**

```
              COMPANY CONTENT              pdf · video · slides · handbook
                     │
                     ▼
          ┌──────────────────────┐
          │   Knowledge Agent    │         LLM · authoring time
          └──────────┬───────────┘
                     ▼
               KnowledgeItem[]             atomic, citable, severity-tagged
                     │
                     ▼
          ┌──────────────────────┐
          │  Scenario Generator  │         LLM · authoring time
          └──────────┬───────────┘
                     ▼
              Episode Graph (JSON)         scenes · choices · shot prompts
                     │
                     ▼
          ┌──────────────────────┐
          │  Deterministic Game  │         reducer · NO LLM
          └───────┬──────────────┘
                  │
        ┌─────────┴──────────┐
        ▼                    ▼
   Player Choice        Character Chat     LLM + RAG · runtime
   (authored branch)         │
                             ▼
                        ElevenLabs
```

**No LLM output can move the player through the game.** Every state transition
is `(state, action) => state` over authored data (`src/engine/gameStore.tsx`). A
model cannot invent a branch, skip an act, or put the player in a scene that
does not exist. That is what makes it demoable at all.

### Where AI is used, and why

| Component | Runs | Why an LLM earns its place |
|---|---|---|
| **Knowledge Agent** (`src/ai/knowledgeAgent.ts`) | Authoring | Arbitrary company documents → structured, citable rules. Nothing else reads legalese. |
| **Scenario Generator** (`src/ai/scenarioGenerator.ts`) | Authoring | Turning a rule into a situation that tests *application* under social pressure. |
| **Character Conversation** (`src/ai/characterAgent.ts`) | Runtime | The player can ask anything. Hundreds of hardcoded branches cannot cover that. |
| **Adaptive Learning** (`src/engine/adaptive.ts`) | Runtime | **Not an LLM.** A number that drives branching must be stable and explainable. |
| **AI Coach** (`src/ai/coach.ts`) | Runtime | The *analysis* is deterministic; the model only narrates it. |
| **Game state** (`src/engine/gameStore.tsx`) | Runtime | **Never an LLM.** |

### Grounding

Characters are personalities with a knowledge boundary, not autonomous agents.
Every reply goes through retrieval first (`src/ai/retrieval.ts` — a
field-weighted BM25 over the knowledge base, scoped by the concepts live in the
current scene):

- retrieval decides what a character is **allowed** to say
- every answer carries the rule ids it used; the UI renders them
- below the confidence floor the character **declines** rather than guessing —
  and the refusal is labelled in the transcript
- the **inspect** panel in the chat shows the retrieved chunks with scores and
  the exact system prompt, so "grounded" is verifiable rather than claimed

Confidence deliberately punishes coincidence: out-of-vocabulary query terms and
single-term matches are damped, so *"what do you think about the new espresso
machine on floor two?"* gets an honest "I don't know", not a confident answer
about the nearest security rule.

---

## What is real and what is mocked

Nothing here pretends to be an integration it is not; the UI states its tier.

| | Without keys (default) | With keys |
|---|---|---|
| **Character replies** | Deterministic in-voice composer over the same retrieval + citations. Labelled `GROUNDED LOCAL`. | Real completions. Labelled `LIVE · <model>`. |
| **AI coach** | Real analysis of the decision log (speed/accuracy correlation, threat-shape bias, wager calibration), template-realised. | Same signals, model-written prose. |
| **Knowledge extraction** | Replays pre-extracted knowledge for this corpus, staged so the pipeline is visible. | Actually extracts from the document excerpts. |
| **Text-to-speech** | Browser speech engine. Labelled `BROWSER SYNTH`. | ElevenLabs per-character voice ids. |
| **Speech-to-text** | **Real** mic capture and waveform via `getUserMedia`; Web Speech transcription where the browser has it, otherwise a clearly-labelled `SIMULATED` transcript. | Scribe boundary in place (`src/voice/voice.ts`); blob capture intentionally not wired — untested code on stage is worse than an honest stub. |
| **Video** | Procedural cinematic previs rendered from each scene's `shot` spec (env / time-of-day / mood), plus the text-to-video prompt the authoring pipeline would send. | `Scene.shot.videoUrl` is played directly if present. |

**Video is an authoring feature by design.** Every scene carries a shot prompt;
`requestClip()` in `src/ai/scenarioGenerator.ts` is where a text-to-video API
would be called ahead of time, writing back to `Scene.shot.videoUrl`. The player
never waits for a render. `SceneCanvas` already prefers a real clip when one
exists, so connecting a provider changes no game code.

See `.env.example` to go live.

---

## Cast and licensing

The cast — **Dex Koval, Milo Park, Noor Abasi, Vera Okonjo** — are original
characters written for this prototype. No real person, celebrity, or licensed
property is represented and no voice is cloned. Each character records its
archetype and `casting.assetSource: 'placeholder_original'`, so a customer can
swap in licensed or self-recorded portraits and voice ids at the asset layer
without touching the episode graph.

## Risk mechanic

Virtual credits only. No real money, no deposits, no cash-out, no external
wallet. The odds are not random: the house estimate comes from the player's own
mastery scores, and the *model inputs* panel shows the working. The point is to
make the player price their own confidence before answering — a bad bet is
information, not a loss.

---

## Code map

```
src/
  types.ts                  the whole data model — episodes are data, not JSX
  content/
    knowledge.ts            14 citable rules (output shape of the Knowledge Agent)
    characters.ts           cast: persona, speech rails, voice ids, casting notes
    sourceDocs.ts           the "boring material" the Studio screen ingests
    episodes/firstDay.ts    33-scene episode graph, 4 acts, 3 adaptive variants
  engine/
    gameStore.tsx           the reducer — every transition in the experience
    adaptive.ts             mastery model, variant selection, progression
    risk.ts                 wager odds derived from mastery
  ai/
    retrieval.ts            BM25 + scene scoping + confidence floor
    characterAgent.ts       prompt assembly, live path, grounded offline composer
    coach.ts                run analysis + narration
    knowledgeAgent.ts       staged extraction pipeline
    scenarioGenerator.ts    rule → playable scene + shot prompts
    llm.ts                  the only provider seam
  voice/voice.ts            ElevenLabs / browser / simulated tiers
  components/
    SceneCanvas.tsx         procedural cinematic previs per shot spec
    DialogueOverlay.tsx     ChoicePanel.tsx  RiskTerminal.tsx
    ConsequencePanel.tsx    CharacterChat.tsx  EpisodeProgress.tsx
    ui/                     CharacterPortrait.tsx (SVG duotone), Grain, Bits
    screens/                Home · EpisodeIntro · ScenePlayer · Results
                            PlayerProfile · Authoring (Studio)
```

## Verification

```bash
npm run verify            # both suites
npm run verify:content    # graph integrity + retrieval + characters + coach
npm run verify:walkthrough # headless click-through of two full playthroughs
npm run typecheck
```

`verify:content` asserts the episode graph is sound (every branch resolves,
every scene reachable, one terminal, every decision has exactly one strong and
one poor option, every citation exists, no lesson says "correct"), that
retrieval grounds on-topic questions and refuses off-topic ones, that every
character reply is cited and speakable, and that the mastery, wager and coach
models behave across a perfect run, a worst run and a mixed run.

`verify:walkthrough` renders the real app in jsdom and plays it twice — once
taking the strong branch through all four acts, once the failing branch —
clicking dialogue, wagering, deciding, asking the characters three questions
(including one the knowledge base cannot answer), opening the retrieval
inspector, switching to voice mode, and reading the results. It asserts the two
runs get *different* adaptive act threes.

## Stack

React 18 · TypeScript · Tailwind · Framer Motion · Lucide · Vite

## Known limits

- Episodes 02 and 03 are authored stubs — shelf metadata, no graph yet.
- One episode graph is hand-authored as the reference output of the pipeline;
  the Studio screen generates scene fragments, not whole graphs.
- Progression persists to `localStorage` only.
