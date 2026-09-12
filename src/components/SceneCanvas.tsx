import { memo, useMemo } from 'react'
import type { ShotSpec } from '@/types'

/* ============================================================================
 * SCENE CANVAS — procedural cinematic previs.
 *
 * The architecture treats video as a pre-generated asset: if `shot.videoUrl`
 * exists it plays, full stop. When it does not — which is every scene in this
 * prototype — this renders a graded, layered, moving composition from the shot
 * spec instead of a grey "video placeholder" box.
 *
 * Nothing here is generated at runtime by a model. It is geometry and colour
 * derived from `env`, `time` and `mood`.
 * ========================================================================== */

interface Palette {
  skyTop: string
  skyBottom: string
  far: string
  mid: string
  near: string
  light: string
  glow: string
}

const PALETTES: Record<ShotSpec['time'], Palette> = {
  morning: { skyTop: '#5A7186', skyBottom: '#131C25', far: '#25323F', mid: '#141C25', near: '#06090C', light: '#FFE3BE', glow: '#9BBBD2' },
  midday: { skyTop: '#76828E', skyBottom: '#1B222A', far: '#2E3741', mid: '#181E25', near: '#07090D', light: '#FFFFFF', glow: '#C2CED9' },
  dusk: { skyTop: '#A85F2C', skyBottom: '#1E1116', far: '#3A2019', mid: '#1A0F12', near: '#080607', light: '#FF9E4D', glow: '#E08A3E' },
  night: { skyTop: '#0E1720', skyBottom: '#030508', far: '#121A24', mid: '#0B1018', near: '#030507', light: '#7FB4D6', glow: '#3D6580' },
}

const GRADES: Record<ShotSpec['mood'], { color: string; opacity: number; blend: React.CSSProperties['mixBlendMode'] }> = {
  neutral: { color: '#131A23', opacity: 0.26, blend: 'multiply' },
  warm: { color: '#F5A524', opacity: 0.16, blend: 'overlay' },
  tense: { color: '#0B1D26', opacity: 0.42, blend: 'multiply' },
  alarm: { color: '#FF2E2E', opacity: 0.2, blend: 'overlay' },
  calm: { color: '#6FD3D8', opacity: 0.14, blend: 'soft-light' },
}

const rand = (seed: number) => {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
}

/* ------------------------------------------------------------- environments */

function Lobby(p: Palette) {
  const panes = Array.from({ length: 11 }, (_, i) => 60 + i * 142)
  return (
    <>
      {/* daylight through the glass wall */}
      <rect x="0" y="0" width="1600" height="660" fill={p.far} opacity="0.5" />
      {panes.map((x, i) => (
        <g key={x}>
          <rect x={x} y="40" width="112" height="600" fill={p.light} opacity={0.07 + (i % 3) * 0.035} />
          <rect x={x + 112} y="40" width="30" height="600" fill={p.mid} />
        </g>
      ))}
      {/* mezzanine slab */}
      <rect x="0" y="196" width="1600" height="34" fill={p.mid} />
      <rect x="0" y="230" width="1600" height="10" fill={p.near} opacity="0.7" />
      {/* revolving door */}
      <g opacity="0.9">
        <circle cx="800" cy="520" r="122" fill="none" stroke={p.mid} strokeWidth="14" />
        <path d="M800 398v244M678 520h244M714 434l172 172M886 434 714 606" stroke={p.mid} strokeWidth="7" />
      </g>
      {/* floor + reflection */}
      <rect x="0" y="640" width="1600" height="260" fill={p.near} />
      <rect x="0" y="640" width="1600" height="120" fill={p.light} opacity="0.05" />
      {panes.map((x) => (
        <rect key={`r${x}`} x={x} y="640" width="112" height="96" fill={p.light} opacity="0.035" />
      ))}
      {/* figure */}
      <g fill={p.near} opacity="0.95">
        <ellipse cx="1090" cy="452" rx="26" ry="30" />
        <path d="M1090 484c34 0 56 26 62 62 4 22 6 48 7 74h-138c1-26 3-52 7-74 6-36 28-62 62-62Z" />
      </g>
      <rect x="1010" y="690" width="160" height="12" fill="#000" opacity="0.45" />
    </>
  )
}

function Desk(p: Palette) {
  const slats = Array.from({ length: 18 }, (_, i) => 110 + i * 27)
  return (
    <>
      <rect x="0" y="0" width="1600" height="900" fill={p.far} opacity="0.45" />
      {/* window with blinds, back wall */}
      <rect x="820" y="80" width="700" height="470" fill={p.light} opacity="0.1" />
      {slats.map((y) => (
        <rect key={y} x="820" y={y} width="700" height="11" fill={p.mid} opacity="0.85" />
      ))}
      <rect x="0" y="80" width="760" height="470" fill={p.mid} opacity="0.5" />
      {/* far desks */}
      <rect x="60" y="470" width="520" height="16" fill={p.mid} />
      <rect x="180" y="392" width="150" height="80" fill={p.near} opacity="0.8" />
      <rect x="188" y="400" width="134" height="64" fill={p.glow} opacity="0.16" />
      {/* hero monitor */}
      <g>
        <rect x="560" y="330" width="520" height="316" rx="8" fill="#05070A" />
        <rect x="576" y="346" width="488" height="272" fill={p.glow} opacity="0.2" />
        <rect x="576" y="346" width="488" height="272" fill={p.light} opacity="0.07" />
        {Array.from({ length: 7 }, (_, i) => (
          <rect key={i} x="604" y={382 + i * 32} width={i % 2 ? 300 : 402} height="9" fill={p.light} opacity="0.22" />
        ))}
        <rect x="604" y="576" width="150" height="24" fill={p.light} opacity="0.3" />
      </g>
      {/* screen spill */}
      <ellipse cx="820" cy="500" rx="560" ry="300" fill={p.glow} opacity="0.1" />
      {/* desk foreground */}
      <rect x="0" y="646" width="1600" height="254" fill={p.near} />
      <rect x="0" y="646" width="1600" height="6" fill={p.light} opacity="0.22" />
      <rect x="1180" y="574" width="86" height="76" rx="8" fill={p.near} />
      <path d="M1266 596h26a16 16 0 0 1 0 32h-26z" fill="none" stroke={p.near} strokeWidth="9" />
      {/* chair back, foreground left */}
      <path d="M-40 900V612c0-40 30-66 96-66h74c66 0 96 26 96 66v288z" fill="#030406" />
    </>
  )
}

function OpenOffice(p: Palette) {
  const r = rand(7)
  const pods = Array.from({ length: 5 }, (_, i) => ({
    x: 40 + i * 320,
    y: 430 + i * 12,
    w: 260,
  }))
  return (
    <>
      <rect x="0" y="0" width="1600" height="900" fill={p.far} opacity="0.4" />
      {/* ceiling light strips */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={200 + i * 420} y={60 + i * 8} width="340" height="14" rx="7" fill={p.light} opacity="0.55" />
          <ellipse cx={370 + i * 420} cy={120 + i * 8} rx="260" ry="70" fill={p.light} opacity="0.06" />
        </g>
      ))}
      {/* blinds stripe light on the back wall */}
      <rect x="0" y="150" width="1600" height="300" fill={p.mid} opacity="0.6" />
      {Array.from({ length: 14 }, (_, i) => (
        <rect key={i} x="0" y={160 + i * 22} width="1600" height="8" fill={p.light} opacity="0.05" />
      ))}
      {/* whiteboard */}
      <rect x="1140" y="196" width="380" height="220" fill={p.light} opacity="0.12" />
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x={1170 + (i % 2) * 40} y={226 + i * 30} width={120 + r() * 160} height="6" fill={p.light} opacity="0.2" />
      ))}
      {/* desk pods with monitor glow */}
      {pods.map((pod, i) => (
        <g key={pod.x}>
          <rect x={pod.x} y={pod.y} width={pod.w} height="150" fill={p.mid} opacity="0.9" />
          <rect x={pod.x + 30} y={pod.y - 74} width={pod.w - 60} height="78" fill="#05070A" />
          <rect x={pod.x + 40} y={pod.y - 64} width={pod.w - 80} height="58" fill={p.glow} opacity={0.16 + (i % 3) * 0.07} />
          <ellipse cx={pod.x + pod.w / 2} cy={pod.y - 20} rx="180" ry="80" fill={p.glow} opacity="0.05" />
        </g>
      ))}
      <rect x="0" y="700" width="1600" height="200" fill={p.near} />
      {/* foreground divider */}
      <rect x="-40" y="560" width="420" height="360" fill="#04060A" />
    </>
  )
}

function Corridor(p: Palette) {
  return (
    <>
      <rect x="0" y="0" width="1600" height="900" fill={p.near} />
      <path d="M0 0h1600v900H0z" fill={p.mid} opacity="0.4" />
      {/* vanishing corridor */}
      <path d="M0 0 620 330v240L0 900z" fill={p.far} opacity="0.55" />
      <path d="M1600 0 980 330v240l620 330z" fill={p.far} opacity="0.4" />
      <rect x="620" y="330" width="360" height="240" fill={p.light} opacity="0.16" />
      {/* slatted glass */}
      {Array.from({ length: 9 }, (_, i) => (
        <path key={i} d={`M${80 + i * 60} ${40 + i * 22}L${640} ${336 + i * 4}v30L${80 + i * 60} ${880 - i * 22}z`} fill={p.light} opacity="0.03" />
      ))}
      <path d="M620 570 0 900h1600L980 570z" fill={p.near} />
      <path d="M620 570 0 900h1600L980 570z" fill={p.light} opacity="0.04" />
      {/* ceiling strip */}
      <path d="M700 0 780 330h40L900 0z" fill={p.light} opacity="0.3" />
    </>
  )
}

function ServerRoom(p: Palette) {
  const racks = Array.from({ length: 6 }, (_, i) => 90 + i * 250)
  const r = rand(13)
  return (
    <>
      <rect x="0" y="0" width="1600" height="900" fill="#04060A" />
      {racks.map((x, ri) => (
        <g key={x}>
          <rect x={x} y={110 - ri * 4} width="180" height="640" fill={p.mid} />
          <rect x={x + 10} y={120 - ri * 4} width="160" height="620" fill="#06080C" />
          {Array.from({ length: 22 }, (_, i) => (
            <g key={i}>
              <rect x={x + 18} y={132 - ri * 4 + i * 27} width="144" height="18" fill={p.far} opacity="0.5" />
              <circle cx={x + 32} cy={141 - ri * 4 + i * 27} r="3" fill={r() > 0.4 ? '#54D1A0' : '#F5A524'} opacity="0.9" />
              <circle cx={x + 46} cy={141 - ri * 4 + i * 27} r="3" fill={r() > 0.8 ? '#FF4D4D' : '#2C7F85'} opacity="0.8" />
            </g>
          ))}
        </g>
      ))}
      <rect x="0" y="750" width="1600" height="150" fill="#030406" />
      <rect x="0" y="750" width="1600" height="60" fill={p.glow} opacity="0.05" />
    </>
  )
}

function Stairwell(p: Palette) {
  return (
    <>
      <rect x="0" y="0" width="1600" height="900" fill="#0A1210" />
      <rect x="0" y="0" width="1600" height="900" fill="#1B3A32" opacity="0.35" />
      {/* fluorescent tube */}
      <rect x="600" y="54" width="420" height="18" rx="9" fill="#D8F0E4" opacity="0.85" className="animate-flicker" />
      <ellipse cx="810" cy="200" rx="520" ry="220" fill="#CFEADF" opacity="0.1" />
      {/* concrete panels */}
      {Array.from({ length: 5 }, (_, i) => (
        <rect key={i} x={-20 + i * 340} y="120" width="320" height="560" fill="#16211E" stroke="#1F2E29" strokeWidth="2" />
      ))}
      {/* landing slab */}
      <path d="M0 690h1600v40H0z" fill="#0D1614" />
      <path d="M0 730h1600v170H0z" fill="#080F0D" />
      {/* railing */}
      <g stroke="#24352F" strokeWidth="9" fill="none">
        <path d="M120 660h1360" />
        <path d="M120 548v112M420 548v112M720 548v112M1020 548v112M1320 548v112" />
        <path d="M120 548h1360" />
      </g>
      {/* stair diagonal, foreground right */}
      <path d="M1180 900 1600 640V900z" fill="#050A09" />
      {/* two figures */}
      <g fill="#050908">
        <ellipse cx="600" cy="486" rx="27" ry="31" />
        <path d="M600 518c35 0 58 27 64 64 4 23 6 50 7 78H529c1-28 3-55 7-78 6-37 29-64 64-64Z" />
        <ellipse cx="890" cy="480" rx="28" ry="32" />
        <path d="M890 512c36 0 60 28 66 66 4 24 6 51 7 80H817c1-29 3-56 7-80 6-38 30-66 66-66Z" />
      </g>
    </>
  )
}

function Rooftop(p: Palette) {
  const r = rand(29)
  const towers = Array.from({ length: 9 }, (_, i) => ({
    x: 30 + i * 180,
    w: 120 + Math.floor(r() * 60),
    h: 260 + Math.floor(r() * 340),
  }))
  return (
    <>
      <rect x="0" y="0" width="1600" height="900" fill={p.skyBottom} />
      {towers.map((t, ti) => {
        const rows = Math.floor((t.h - 40) / 40)
        const cols = Math.floor((t.w - 20) / 32)
        return (
          <g key={t.x}>
            <rect x={t.x} y={900 - t.h} width={t.w} height={t.h} fill={ti % 2 ? p.mid : p.far} opacity="0.95" />
            {Array.from({ length: rows }, (_, ry) =>
              Array.from({ length: cols }, (_, cx) => {
                const on = r()
                if (on < 0.55) return null
                return (
                  <rect
                    key={`${ry}-${cx}`}
                    x={t.x + 14 + cx * 32}
                    y={920 - t.h + ry * 40}
                    width="16"
                    height="22"
                    fill={on > 0.9 ? '#F5A524' : p.glow}
                    opacity={on > 0.9 ? 0.75 : 0.3}
                  />
                )
              }),
            )}
          </g>
        )
      })}
      {/* the one lit floor */}
      <g opacity="0.42">
        <rect x="566" y="304" width="118" height="34" fill="#F5A524" opacity="0.5" />
        <rect x="700" y="304" width="86" height="34" fill="#F5A524" opacity="0.38" />
      </g>
      <ellipse cx="690" cy="322" rx="250" ry="66" fill="#F5A524" opacity="0.06" />
      {/* street */}
      <rect x="0" y="812" width="1600" height="88" fill="#04060A" />
      <rect x="0" y="812" width="1600" height="10" fill={p.glow} opacity="0.2" />
      <g fill="#04060A">
        <ellipse cx="430" cy="770" rx="25" ry="29" />
        <path d="M430 800c33 0 55 26 61 61 4 22 6 47 7 73H362c1-26 3-51 7-73 6-35 28-61 61-61Z" />
      </g>
    </>
  )
}

const ENVS: Record<ShotSpec['env'], (p: Palette) => JSX.Element> = {
  lobby: Lobby,
  desk: Desk,
  open_office: OpenOffice,
  corridor: Corridor,
  server_room: ServerRoom,
  night_office: Stairwell,
  rooftop: Rooftop,
}

/* ------------------------------------------------------------------ wrapper */

export const SceneCanvas = memo(function SceneCanvas({
  shot,
  sceneKey,
  paused = false,
}: {
  shot: ShotSpec
  sceneKey: string
  paused?: boolean
}) {
  const p = PALETTES[shot.time]
  const grade = GRADES[shot.mood]
  const Env = ENVS[shot.env]

  const dust = useMemo(() => {
    const r = rand(sceneKey.length * 97 + shot.env.length)
    return Array.from({ length: 26 }, () => ({
      x: r() * 100,
      y: r() * 100,
      s: 1 + r() * 2.4,
      d: 7 + r() * 12,
      o: 0.08 + r() * 0.22,
    }))
  }, [sceneKey, shot.env])

  // A real pre-generated clip takes precedence — the whole point of the design.
  if (shot.videoUrl) {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        <video
          key={shot.videoUrl}
          src={shot.videoUrl}
          autoPlay
          muted
          loop
          playsInline
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0" style={{ background: grade.color, opacity: grade.opacity, mixBlendMode: grade.blend }} />
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-ink-900">
      <div
        key={sceneKey}
        className={paused ? '' : 'animate-kenburns'}
        style={{ position: 'absolute', inset: '-8%', willChange: 'transform' }}
      >
        <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
          <defs>
            <linearGradient id={`sky-${sceneKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={p.skyTop} />
              <stop offset="100%" stopColor={p.skyBottom} />
            </linearGradient>
          </defs>
          <rect width="1600" height="900" fill={`url(#sky-${sceneKey})`} />
          <Env {...p} />
          {/* volumetric light shafts */}
          <g style={{ mixBlendMode: 'screen' }} opacity="0.16">
            <path d="M320 -60 620 -60 300 900 60 900z" fill={p.light} opacity="0.5" />
            <path d="M900 -60 1060 -60 800 900 640 900z" fill={p.light} opacity="0.32" />
          </g>
        </svg>
      </div>

      {/* atmosphere */}
      <div className="pointer-events-none absolute inset-0">
        {dust.map((d, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${d.x}%`,
              top: `${d.y}%`,
              width: d.s,
              height: d.s,
              background: p.light,
              opacity: d.o,
              animation: `breathe ${d.d}s ease-in-out ${i * 0.3}s infinite`,
            }}
          />
        ))}
      </div>

      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: grade.color, opacity: grade.opacity, mixBlendMode: grade.blend }}
      />
      {shot.mood === 'alarm' && (
        <div className="pointer-events-none absolute inset-0 scanlines opacity-60" />
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.68) 0%, rgba(0,0,0,.12) 24%, rgba(0,0,0,.2) 52%, rgba(0,0,0,.92) 100%)' }}
      />
    </div>
  )
})
