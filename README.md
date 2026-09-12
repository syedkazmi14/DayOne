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
npm run assets   # fetch character + episode artwork into public/ (once);
                 # also derives the responsive WebP ladder (needs cwebp)
npm run dev      # http://localhost:5173 — Vite + the voice proxy
```

No API keys required. The prototype runs fully offline and says so.

To hear the real ElevenLabs voices, give the **server** the key — it is never
put in the client bundle:

```bash
echo 'ELEVENLABS_API_KEY=sk_...' >> .env.local   # gitignored
echo 'REPLICATE_API_TOKEN=r8_...' >> .env.local  # optional: scene images + Wan 2.2 video
npm run dev                                      # Vite + voice proxy + media server
```

---

## The demo path

1. **Episode lobby** — the featured episode as a full-bleed hero, the cast
   switcher in its corner, and the episode shelf underneath. The arrows move
   between rosters (Rick and Morty → South Park → Family Guy → The Simpsons);
   the hero and the shelf both follow. Clicking a portrait selects that
   character and previews their voice.
2. **Featured episode** — `FIRST DAY · Episode 01 · Cybersecurity`
3. **Episode intro** — cast, concepts, and a note saying which act has already
   been personalised for you
4. **Cinematic scenes** — full-bleed, letterboxed, subtitled dialogue
5. **Wager** — SAFE 1.2× · RISKY 2× · ALL IN 4×, virtual credits only. The
   mastery model's estimate is recorded at bet time and revealed after the
   outcome, so it never anchors the call
6. **Decision** — three defensible options, none of them flagged
7. **Consequence** — the world reacts *first*; the explanation comes after
8. **Character chat** — text or voice, grounded in the knowledge base. **Inspect**
   shows the grounding verdict (GROUNDED / REFUSED · out of scope / weak
   evidence / no match), confidence against the floor, every retrieved chunk
   with relevance and matched terms, the rules actually used, and the prompt
9. **Adaptive act three** — built around your weakest demonstrated concept
10. **Results + AI coach** — accuracy on external threats vs coworker requests,
    decision speed under authority pressure, bet calibration, the single biggest
    weakness — then **generate my next episode**, built from that weakness
11. **Profile** — mastery scores that actually drive 9 and 10
12. **Studio** — company material → topic → a generated, validated episode
    graph → clips, backgrounds and voices → two employees' act threes side by
    side → publish → play it

`npm run verify` clicks through all of it headlessly (see *Verification*).

---

## Architecture

The load-bearing decision: **AI generates and personalises the content; a
deterministic engine delivers the experience.**

```
   COMPANY CONTENT  +  TOPIC  +  PLAYER MASTERY         ── AUTHORING TIME ──
          │
          ▼
   Knowledge Agent            LLM          -> KnowledgeItem[] (validated, citable)
          │
          ▼
   Scenario Generator         code + LLM   -> Episode graph: acts · decisions ·
          │                                   consequences · citations · threat
          │                                   profiles · adaptive act · SHOT SPECS
          ▼
   validateEpisode()          code         -> refuses anything unplayable
          │
          ▼
   Asset pipeline             providers    -> requestClip(shot)   video model
          │                                   backgrounds         image model
          │                                   dialogue audio      ElevenLabs
          ▼                                   stored: company/episodes/<id>/…
   PUBLISH_EPISODE            reducer      -> re-validated, then playable
   ─────────────────────────────────────────────────────────── RUNTIME ──
   Deterministic Game         reducer · NO LLM · (state, action) => state
      │             │                 │
      ▼             ▼                 ▼
   Player choice  Character chat    Run telemetry -> Coach -> mastery
   (authored      RAG -> refusal    (measured)      (narrates)   │
    branch)       gate -> LLM ->                                 ▼
                  ElevenLabs                          next episode targets
                                                      the weakest concept
```

**No LLM output can move the player through the game.** Every state transition
is `(state, action) => state` over authored data (`src/engine/gameStore.tsx`). A
model cannot invent a branch, skip an act, or put the player in a scene that
does not exist. Actions carry ids, never payloads the engine would have to
trust: `CHOOSE` is looked up on the current scene, a wager's stake and payout
are derived from the balance, and `PUBLISH_EPISODE` refuses any graph that
fails validation. That is what makes it demoable at all.

**The generator splits authority the same way.** Code builds the structure of a
generated episode — scene ids, transitions, which option is strong, what each
branch cites, which concepts the adaptive act targets. A model, when configured,
writes the *words* (lines, choices, lessons, shot prompts), merged field by field
into that skeleton (`applyScript`). A script that breaks a graph rule is
discarded, not patched.

### Where AI is used, and why

| Component | Runs | Why an LLM earns its place |
|---|---|---|
| **Knowledge Agent** (`src/ai/knowledgeAgent.ts`) | Authoring | Arbitrary company documents → structured, citable rules. Nothing else reads legalese. |
| **Episode Generator** (`src/ai/episodeGenerator.ts`) | Authoring | Code builds a playable graph from the topic's rules and the player's mastery; the model writes the scene script in the company's voice. |
| **Asset providers** (`src/media/`) | Authoring | Short establishing clips and scene backgrounds from each shot spec; ElevenLabs for dialogue. Nobody playing waits on them. |
| **Character Conversation** (`src/ai/characterAgent.ts`) | Runtime | The player can ask anything. Hundreds of hardcoded branches cannot cover that. |
| **Adaptive Learning** (`src/engine/adaptive.ts`) | Runtime | **Not an LLM.** A number that drives branching must be stable and explainable. |
| **Run telemetry** (`src/engine/telemetry.ts`) | Runtime | **Not an LLM.** Accuracy by threat source, authority slowdown, calibration, biggest weakness — measured. |
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
- the refusal gate sits **in front of** the model, not inside its prompt: below
  the floor the live path never calls the model at all — a prompt instruction
  is a request, the gate is a guarantee
- every reply carries a grounding trace — `grounded`, `social`, or `refused`
  classified as `no_match` (nothing shares a term), `out_of_scope` (most of the
  question's vocabulary is absent from the material) or `weak_evidence`
- a generated episode's characters retrieve over **that episode's** knowledge
  snapshot, so they are grounded in the material it was built from

Confidence deliberately punishes coincidence: out-of-vocabulary query terms and
single-term matches are damped, so *"what do you think about the new espresso
machine on floor two?"* gets an honest "I don't know", not a confident answer
about the nearest security rule. It also checks **specificity**: the best rule
has to explain at least 60% of the question's idf-weighted vocabulary, and a
word the material has never seen counts as maximally specific. So *"what is the
password for the espresso machine on floor two?"* is refused too. "Password"
and "machine" match a real incident rule, but the question is about an espresso
machine, and nothing in the material covers one.

---

## What is real and what is mocked

Nothing here pretends to be an integration it is not; the UI states its tier.

| | Without keys (default) | With keys |
|---|---|---|
| **Character replies** | Deterministic in-voice composer over the same retrieval + citations. Labelled `GROUNDED LOCAL`. | Real completions. Labelled `LIVE · <model>`. |
| **AI coach** | Real analysis of the decision log (speed/accuracy correlation, threat-shape bias, wager calibration), template-realised. | Same signals, model-written prose. |
| **Knowledge extraction** | Replays pre-extracted knowledge for this corpus, staged so the pipeline is visible. | Actually extracts from the document excerpts. |
| **Text-to-speech** | Browser speech engine, shaped per character by the voice profile's `fallback` rate/pitch. Labelled `BROWSER SYNTH`. | ElevenLabs, one cast voice per character, resolved through `src/voice/voiceProfiles.ts`. Labelled `ELEVENLABS`. |
| **Speech-to-text** | **Real** mic capture and waveform via `getUserMedia`; Web Speech transcription where the browser has it, otherwise a clearly-labelled `SIMULATED` transcript. | Scribe boundary in place (`src/voice/voice.ts`); blob capture intentionally not wired — untested code on stage is worse than an honest stub. |
| **Episode scripts** | Deterministic composer writes lines, choices and lessons from the knowledge items' own fields. Labelled `script · deterministic composer`. | Model writes the words into the code-built graph; discarded if it breaks validation, with the reason shown. |
| **Video** | `requestClip()` resolves to **procedural previs**: no file, rendered live from the shot spec, badged `procedural previs · not AI-generated`. | Media server animates each clip scene's generated keyframe with Wan 2.2 I2V Fast on Replicate (~5 s, 480p), stores it, attaches `Scene.assets.video`. Badged `AI video · <model>`. |
| **Backgrounds** | Procedural backdrop from the same spec. | Text-to-image (FLUX schnell on Replicate) for backgrounds and clip keyframes, stored, attached as `Scene.assets.background`. |
| **Dialogue audio** | Not pre-rendered; browser voice at runtime, reported as `runtime voice`. | Each line voiced via the voice proxy and stored under `…/audio/`. |
| **Storage** | No media server: assets live in the session. | Local disk under an object-store key layout (`company/…`), served at `/api/media/assets/`. |

See `.env.example` to go live.

---

## Video generation

**Video is an authoring-time asset, not a runtime feature.** Nobody generates a
twenty-minute interactive film. The Studio renders four ~5 second clips for the
beats that earn one — cold open, confrontation, incident, ending — and the
player plays the stored files.

```
shot spec -> keyframe image (FLUX schnell) ─┐
shot spec -> motionPrompt() ────────────────┴-> requestClip(shot, {episode, scene, image})
          -> VideoProvider -> Wan 2.2 I2V Fast (Replicate) -> stored clip -> Scene.assets.video
SceneCanvas:  AI clip  ->  AI background/keyframe  ->  procedural previs
```

- **`ShotSpec`** (`src/types.ts`) is the instruction: environment, time, mood,
  prompt, `action`, `presentation: 'clip' | 'still'`, duration, camera.
- **Image-to-video.** Each clip scene first gets its own generated keyframe.
  `motionPrompt()` then turns the shot spec into camera movement, character
  action and expression, environmental motion and framing, and Wan 2.2
  animates that keyframe. The video model is asked for one shot of motion,
  never for what happens next.
- **`Scene.assets`** is the result: `AssetRef { kind, tier, provider, url,
  storageKey }`. The reducer never reads either.
- **`requestClip()`** (`src/media/video.ts`) is the seam. `VideoProvider` is
  `generateClip / getStatus / getClipUrl`, with two implementations:
  - `ServerVideoProvider` — a real model, via the media server, which alone
    holds `REPLICATE_API_TOKEN`.
  - `ProceduralPrevisProvider` — no model, no file.

  Switching models is a change to `server/mediaServer.mjs`.
- **Hybrid presentation.** `planEpisodeAssets()` (`src/media/assetPlan.ts`)
  budgets clips (default 4). Every other scene gets one generated background —
  shared by scenes with the same look — with the character sprite, name, line,
  voice and a speaking waveform over it. A clip per dialogue line would be
  neither affordable nor controllable.
- **Honesty.** A procedural asset has no URL and is badged as not AI-generated
  in the player, the Studio and the graph review. A failed render attaches
  nothing; a missing file falls back a tier instead of a black frame.
- **Audio is not video.** ElevenLabs voices the cast; it does not generate
  scenes.

---

## Voice

```
character  ->  voiceProfileId  ->  VoiceProfile  ->  ElevenLabs
```

`src/voice/voiceProfiles.ts` is the **only** file in the app that contains an
ElevenLabs voice id. A character carries a `voiceProfileId` and nothing else
about speech synthesis, so selecting a character is all it takes to change the
voice — in the chat panel, in a scene, or in the home-screen preview. Adding a
character is a data change in `content/characters.ts`; adding a voice is a data
change in `voiceProfiles.ts`. No component talks to ElevenLabs.

**The API key is server-side only.** `server/voiceProxy.mjs` reads
`ELEVENLABS_API_KEY` from the environment — deliberately *not* `VITE_`-prefixed,
so Vite cannot inline it — and the browser posts text to `/api/voice/tts`.
`npm run dev` starts the proxy alongside Vite and `vite.config.ts` forwards
`/api/voice` to it. If the proxy is absent the app falls back to the browser
speech engine and relabels itself; it never claims a tier it does not have.

Each profile holds two ids. `voiceId` is the **cast** voice — a community
("shared library") voice picked for its fit to the character, which the API only
serves to Creator tier and above. `fallbackVoiceId` is the nearest **premade**
voice, which every plan can use including Free. The proxy tries the cast voice
first and silently retries with the fallback when the plan rejects it, so the
same build works on either key; the response reports which voice actually spoke.

All sixteen cast voices were auditioned against the live API: each returns audio
and all sixteen are acoustically distinct.

Failures degrade rather than throw: a missing profile falls back to the narrator
voice, and no key / API error / blocked autoplay each drop to the browser voice
and surface a one-line note in the UI.

## Cast and licensing

The roster is four groups of four, defined in `content/characterGroups.ts`:
**Rick and Morty** (Rick, Morty, Summer, Jerry) · **South Park** (Cartman, Stan,
Kyle, Kenny) · **Family Guy** (Peter, Stewie, Brian, Lois) · **The Simpsons**
(Homer, Bart, Marge, Lisa).

> **These are placeholder casting, not cleared assets.** The artwork is show
> screenshots and promotional art fetched from community wikis by
> `npm run assets` (see `scripts/fetchAssets.mjs`) and served locally; the
> voices are ElevenLabs library voices cast for archetype fit, not clones of
> any performer. Fine for a prototype, **not licensed for commercial use**.
> Every character records `casting.assetSource: 'community_wiki'`, so a customer
> swaps in licensed or self-recorded portraits and voice ids at the asset layer
> without touching the episode graph.

Characters speak through one of four `speechArchetype`s (`chaotic`, `anxious`,
`pragmatic`, `authority`), which is what keeps sixteen characters from becoming
sixteen branches in `src/ai/characterAgent.ts`. Their individual colour —
greetings, refusal line, sign-offs — lives in the character data.

## Risk mechanic

Virtual credits only. No real money, no deposits, no cash-out, no external
wallet. Three bets, readable at a glance: **SAFE 1.2× · RISKY 2× · ALL IN 4×**.
The outcome is the authored quality of the choice the player makes — never
chance, never a model. The mastery model's estimate is recorded silently at bet
time and revealed with the result, so it never anchors the call. The tier chosen
implies a confidence (55 / 75 / 95%); against actual outcomes that feeds the
calibration read — overconfident, underconfident or calibrated — in the coach.

---

## Code map

```
src/
  types.ts                  the whole data model — episodes are data, not JSX
  content/
    knowledge.ts            14 citable rules (output shape of the Knowledge Agent)
    characters.ts           16 characters: persona, speech rails, art, voice ref
    characterGroups.ts      the four rosters the home carousel renders
    sourceDocs.ts           the "boring material" the Studio screen ingests
    episodes/index.ts       12 episodes, grouped, each with an image
    episodes/firstDay.ts    33-scene episode graph, 4 acts, 3 adaptive variants
  engine/
    gameStore.tsx           the reducer — every transition, incl. publish gate
    validateEpisode.ts      graph rules shared by reducer, Studio and tests
    adaptive.ts             mastery model, selectVariant, player lenses
    telemetry.ts            accuracy by threat, authority slowdown, calibration
    risk.ts                 fixed-multiplier bets, hidden mastery estimate
  ai/
    retrieval.ts            BM25 over any corpus + confidence floor + signals
    characterAgent.ts       refusal gate, grounding trace, live + offline paths
    coach.ts                telemetry-led run analysis + narration
    knowledgeAgent.ts       staged extraction pipeline
    episodeGenerator.ts     topic + knowledge + mastery → validated episode graph
    scenarioGenerator.ts    single-rule scene draft
    llm.ts                  the only provider seam
  media/
    video.ts                requestClip seam · VideoProvider · server + previs
    image.ts                background provider · server + procedural
    audio.ts                pre-rendered dialogue via the voice proxy
    assetPlan.ts            clip budget, shared backgrounds, tier of a scene
    mediaStatus.ts          media server discovery
  voice/
    voiceProfiles.ts        the only place ElevenLabs voice ids live
    voice.ts                proxy / direct / browser / simulated tiers
    useVoiceStatus.ts       React binding for async provider discovery
  components/
    CastSwitcher.tsx        compact roster control in the hero corner
    SceneCanvas.tsx         procedural cinematic previs per shot spec
    DialogueOverlay.tsx     ChoicePanel.tsx  RiskTerminal.tsx
    ConsequencePanel.tsx    CharacterChat.tsx  EpisodeProgress.tsx
    ui/                     CharacterAvatar (art + SVG fallback), EpisodeStill,
                            CharacterPortrait.tsx (SVG duotone), Grain, Bits
    GroundingInspector.tsx  RunTelemetryPanel.tsx  ui/AssetTierBadge.tsx
    studio/                 GraphReview · AssetStudio · PlayerLensPanel · StudioBits
    screens/                Home · EpisodeIntro · ScenePlayer · Results
                            PlayerProfile · Authoring (Studio)
server/voiceProxy.mjs       holds ELEVENLABS_API_KEY; POST /api/voice/tts
server/mediaServer.mjs      holds REPLICATE_API_TOKEN; keyframes, clips, audio, storage
scripts/fetchAssets.mjs     downloads + crops character and episode artwork
scripts/optimizeAssets.mjs  derives the responsive WebP ladder beside each JPEG
public/characters/*.jpg     640x640, one per character (+ -160/-320/-640.webp)
public/episodes/*.jpg       1280x720, one per episode (+ -640/-1280.webp)
public/_headers             cache policy for the artwork (Netlify / CF Pages)
```

### Artwork delivery

`npm run assets` fetches the baseline JPEGs and then runs `npm run
assets:optimize`, which writes a WebP ladder next to each one. `CharacterAvatar`
and `EpisodeStill` render a `<picture>` whose `<source>` offers that ladder with
a `sizes` hint matching the box being drawn, keeping the JPEG as the `<img src>`
fallback — so a 62px cast-switcher portrait pulls ~4kB instead of the ~52kB,
640px JPEG every surface used to share. The optimizer needs `cwebp`
(`brew install webp`); without it the step is skipped with a notice and the app
still renders from the JPEGs.

**Deployment:** the artwork lives in `public/`, so Vite copies it verbatim and
the paths are *not* content-hashed. `public/_headers` sets a one-week
`Cache-Control` with `stale-while-revalidate` (not `immutable`, which would be
wrong for unhashed paths that `npm run assets` can rewrite). Netlify and
Cloudflare Pages read that file; any other host needs the same policy configured
there. The origin/CDN must also serve `.webp` as `image/webp` and keep `Accept`
(or the URL) in its cache key.


## Verification

```bash
npm run verify             # all three suites
npm run verify:content     # graph integrity + retrieval + characters + coach
npm run verify:walkthrough # headless click-through of two full playthroughs
npm run verify:visual      # real Chrome: layout, images, carousel at 2 viewports
npm run typecheck
```

`verify:content` asserts the episode graph is sound (every branch resolves,
every scene reachable, one terminal, every decision has exactly one strong and
one poor option, every citation exists, no lesson says "correct"), that
retrieval grounds on-topic questions and refuses off-topic ones, that every
character reply is cited and speakable, and that the mastery, wager and coach
models behave across a perfect run, a worst run and a mixed run. It also checks
the roster: no character in two groups, every group fields four resolvable
characters, every character resolves to an existing voice profile with a
premade fallback id, every episode is grouped and cast from its own group, and
**every character portrait and episode still actually exists on disk**.

It also covers the architecture added around the engine:

- **Validation catches what it claims to** — dangling branches, cycles, two
  strong options, unresolvable citations, correctness wording, a missing ending.
- **Transitions are deterministic** — the same `(state, action)` gives the same
  state. A choice id from another scene, or an invented one, is ignored. Stakes
  and multipliers come from the engine. A strong RISKY call pays exactly 2×.
- **Generated episodes** — every topic produces a graph that validates offline,
  with threat profiles, knowledge refs and shot specs. Workplace safety and
  "the espresso machine" are refused, because the material does not cover them.
  The generator is deterministic. A hostile script cannot add scenes, rewire
  branches or change which option is strong. A script that leaks correctness
  fails validation. An invalid graph cannot be published, a generated graph
  cannot shadow an authored one, and the reducer routes player A and player B
  to different act threes.
- **Telemetry** — accuracy splits by threat source, the authority slowdown is
  measured, and calibration is classified. The coach opens with the measured
  sentence and names the biggest weakness.
- **Video seam** — procedural previs resolves with no file and reports itself
  as procedural. Against a fake media server, the real provider walks queued →
  rendering → ready, attaches as AI video with its storage key, times out
  instead of hanging, and treats an unknown status as failure.
- **Media server** — spawned for real without a key: it reports video and
  image unconfigured, refuses a render with 503, stores an upload under its
  object-store key and serves it back, and rejects path traversal.

`verify:walkthrough` renders the real app in jsdom and plays it twice — once
taking the strong branch through all four acts, once the failing branch —
clicking dialogue, wagering, deciding, asking the characters three questions
(including one the knowledge base cannot answer), opening the retrieval
inspector, switching to voice mode, and reading the results. It asserts the two
runs get *different* adaptive act threes. It also drives the cast switcher —
arrow buttons and arrow keys, through all four rosters and back round — and
asserts the hero and episode shelf follow the roster, and that selecting a
character marks it pressed.

It then runs the **Studio end to end**:

1. Extracts the knowledge.
2. Sees an uncovered topic refused.
3. Generates *Phishing* and checks that the graph validates.
4. Renders the visual and voice assets and asserts none of them claims to be AI without a key.
5. Checks that the two player profiles get different act threes.
6. Publishes, plays the generated episode through its first decision and consequence, and finds it on the home shelf.

After the failing run, it clicks **generate my next episode** and lands on a new adaptive episode. The inspector
assertions check that the off-topic question is classified `REFUSED` and explained against the floor.

`verify:visual` drives **real Chrome** over the DevTools protocol and asserts
the class of bug jsdom structurally cannot see — it has no layout engine and
never loads an image. Every assertion in it exists because it caught a real
regression: an `h-full` child collapsing inside a `min-h` parent; a `<button>`
inheriting `align-items: flex-start` from the UA stylesheet so its `flex-col`
children shrink-wrap to max-content and clip at 390px; and a cached image
firing `load` before React attaches `onLoad`, leaving an opacity fade-in stuck
at zero. It also checks horizontal overflow, that the absolutely-positioned
cast switcher stays inside the viewport, that the shelf follows the roster, and
that the console and network stay clean. It runs at 1440x900 and 390x844,
starts Vite and the voice proxy the way `npm run dev` does, and writes
screenshots to `scripts/.out/shots/`.

It uses `puppeteer-core`, so there is no bundled browser download: it finds the
Chrome or Chromium already installed, or `$PUPPETEER_EXECUTABLE_PATH`.

> **Note on Claude in Chrome:** the extension cannot drive Arc. Arc replaced
> Chromium's tab strip with its own model, and the extension's automation is
> built on Chrome tab groups — creating one never returns, so every page-acting
> tool times out. Install Google Chrome and run the extension there.
> `npm run verify:visual` is browser-agnostic and needs no extension.

## Stack

React 18 · TypeScript · Tailwind · Framer Motion · Lucide · Vite

## Known limits

- **Artwork and voices are placeholder casting, not licensed.** See
  *Cast and licensing*.
- The cast voices are community-library voices and need a **Creator-tier key or
  above**. On a Free key the proxy silently degrades to each profile's premade
  `fallbackVoiceId`; there are only four premade young-male voices for five
  young-male characters, so on Free, Cartman and Bart share one, separated only
  by pitch and pacing. Both have distinct cast voices.
- `FIRST DAY` is the only hand-authored graph; the other eleven shelf entries
  are stubs. Generated episodes are real graphs, but they all follow one
  structure: cold open, two decisions, adaptive act, ending.
- **The fal.ai path has not been exercised against the live API in this repo**
  — no key was available. The HTTP contract follows fal's documented queue API,
  and the client side is tested against a fake server. Treat the first real
  render as the integration test.
- The media server keeps render jobs in memory (a restart loses in-flight
  jobs) and stores to local disk. `putObject()` is the one function an S3/R2
  adapter replaces.
- Offline, the knowledge agent can only replay the shipped corpus. A newly
  uploaded document yields no rules without a language model, and the Studio
  says so.
- Progression and published episodes persist to `localStorage` only.
