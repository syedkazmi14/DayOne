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
npm run dev
```

---

## The demo path

1. **Episode lobby** — the roster carousel: swipe or drag horizontally between
   character groups (Rick and Morty → South Park → Family Guy → The Simpsons).
   Tap a character to select them and hear their voice; the hero and the episode
   shelf follow the group you land on.
2. **Featured episode** — `FIRST DAY · Episode 01 · Cybersecurity`
3. **Episode intro** — cast, concepts, and a note saying which act has already
   been personalised for you
4. **Cinematic scenes** — full-bleed, letterboxed, subtitled dialogue
5. **Risk terminal** — wager virtual credits against the system's estimate of
   whether you'll get this one right
6. **Decision** — three defensible options, none of them flagged
7. **Consequence** — the world reacts *first*; the explanation comes after
8. **Character chat** — text or voice, grounded in the knowledge base, with a
   retrieval inspector that shows the evidence
9. **Adaptive act three** — built around your weakest demonstrated concept
10. **Results + AI coach** — what your decisions revealed, and what changes next
11. **Profile** — mastery scores that actually drive 9 and 10
12. **Studio** — watch company documents become an episode

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
| **Text-to-speech** | Browser speech engine, shaped per character by the voice profile's `fallback` rate/pitch. Labelled `BROWSER SYNTH`. | ElevenLabs, one cast voice per character, resolved through `src/voice/voiceProfiles.ts`. Labelled `ELEVENLABS`. |
| **Speech-to-text** | **Real** mic capture and waveform via `getUserMedia`; Web Speech transcription where the browser has it, otherwise a clearly-labelled `SIMULATED` transcript. | Scribe boundary in place (`src/voice/voice.ts`); blob capture intentionally not wired — untested code on stage is worse than an honest stub. |
| **Video** | Procedural cinematic previs rendered from each scene's `shot` spec (env / time-of-day / mood), plus the text-to-video prompt the authoring pipeline would send. | `Scene.shot.videoUrl` is played directly if present. |

**Video is an authoring feature by design.** Every scene carries a shot prompt;
`requestClip()` in `src/ai/scenarioGenerator.ts` is where a text-to-video API
would be called ahead of time, writing back to `Scene.shot.videoUrl`. The player
never waits for a render. `SceneCanvas` already prefers a real clip when one
exists, so connecting a provider changes no game code.

See `.env.example` to go live.

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
    characters.ts           16 characters: persona, speech rails, art, voice ref
    characterGroups.ts      the four rosters the home carousel renders
    sourceDocs.ts           the "boring material" the Studio screen ingests
    episodes/index.ts       12 episodes, grouped, each with an image
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
  voice/
    voiceProfiles.ts        the only place ElevenLabs voice ids live
    voice.ts                proxy / direct / browser / simulated tiers
    useVoiceStatus.ts       React binding for async provider discovery
  components/
    CharacterCarousel.tsx   the roster carousel (native scroll-snap + drag)
    SceneCanvas.tsx         procedural cinematic previs per shot spec
    DialogueOverlay.tsx     ChoicePanel.tsx  RiskTerminal.tsx
    ConsequencePanel.tsx    CharacterChat.tsx  EpisodeProgress.tsx
    ui/                     CharacterAvatar (art + SVG fallback), EpisodeStill,
                            CharacterPortrait.tsx (SVG duotone), Grain, Bits
    screens/                Home · EpisodeIntro · ScenePlayer · Results
                            PlayerProfile · Authoring (Studio)
server/voiceProxy.mjs       holds ELEVENLABS_API_KEY; POST /api/voice/tts
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
a `sizes` hint matching the box being drawn, and keep the JPEG as the `<img
src>` fallback — so a 58px intro avatar pulls ~4kB instead of the ~52kB, 640px
JPEG every surface used to share. The optimizer needs `cwebp`
(`brew install webp`); without it the step is skipped with a notice and the app
still renders from the JPEGs.

**Deployment:** the artwork lives in `public/`, so Vite copies it verbatim and
the paths are *not* content-hashed. `public/_headers` sets a one-week
`Cache-Control` with `stale-while-revalidate` (not `immutable`, which would be
wrong for unhashed paths that `npm run assets` can rewrite). That file is read
by Netlify and Cloudflare Pages; on any other host the same policy has to be
configured there — see the comments in `public/_headers`. Serving the WebP
derivatives also requires the origin/CDN to send `image/webp` and to include
`Accept` or the URL in its cache key.


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
models behave across a perfect run, a worst run and a mixed run. It also checks
the roster: no character in two groups, every group fields four resolvable
characters, every character resolves to an existing voice profile with a
premade fallback id, every episode is grouped and cast from its own group, and
**every character portrait and episode still actually exists on disk**.

`verify:walkthrough` renders the real app in jsdom and plays it twice — once
taking the strong branch through all four acts, once the failing branch —
clicking dialogue, wagering, deciding, asking the characters three questions
(including one the knowledge base cannot answer), opening the retrieval
inspector, switching to voice mode, and reading the results. It asserts the two
runs get *different* adaptive act threes. It also drives the roster carousel —
arrow keys, arrow buttons and dots — and asserts the hero and episode shelf
follow the group, that off-screen panels are hidden from assistive tech, and
that selecting a character marks it pressed.

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
- `FIRST DAY` is the only episode with a scene graph. The other eleven are
  authored stubs — shelf metadata and card art, no graph yet.
- One episode graph is hand-authored as the reference output of the pipeline;
  the Studio screen generates scene fragments, not whole graphs.
- Progression persists to `localStorage` only.
