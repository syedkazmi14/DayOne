/* ============================================================================
 * THEME REGISTRY — the accent choices offered in the account menu.
 *
 * Every palette token in tailwind.config.js resolves as
 * rgb(var(--token) / <alpha-value>), so overwriting these variables on :root
 * recolours every surface in the app at once — chrome, scrims, glass, focus
 * rings, the choice buttons, the lot.
 *
 * Themes carry a name and nothing else to read: the swatch and the live app
 * behind the menu say more about a palette than a sentence describing it.
 *
 * WHY CHANNELS, NOT HEX
 * The whole palette is addressed with alpha modifiers (bg-signal/45,
 * ink-900/72, border-bone/12). Those only survive if the variable holds
 * "245 165 36" rather than "#F5A524".
 *
 * WHAT A THEME MAY TOUCH
 * Only the app's own palette. Show accents stay in characterGroups.ts and are
 * deliberately untouched: they belong to the shows, not to the theme, and the
 * point of trying a new accent is to see whether it fights them.
 * ========================================================================== */

/** Space-separated RGB channels, keyed by CSS variable name. */
export type Channels = Record<string, string>

export interface Theme {
  id: string
  name: string
  /** Overrides on top of BASE. A theme that changes nothing is the baseline. */
  vars: Channels
}

/** The shipped palette. Mirrors :root in src/index.css. */
export const BASE: Channels = {
  '--ink-900': '5 6 7',
  '--ink-850': '8 9 12',
  '--ink-800': '12 14 18',
  '--ink-700': '18 21 27',
  '--ink-600': '25 29 37',
  '--ink-500': '35 40 51',
  '--ink-400': '51 58 71',
  '--bone': '237 233 226',
  '--bone-dim': '168 163 153',
  '--bone-faint': '110 107 101',
  '--signal': '245 165 36',
  '--signal-hot': '255 122 26',
  '--signal-deep': '178 103 8',
  /* Foreground for anything filled with --signal. Derived in applyTheme, never
   * authored: a theme (or a hand-picked accent) that is darker than the text it
   * carries would otherwise render an unreadable button. */
  '--signal-ink': '5 6 7',
  '--cyan': '111 211 216',
  '--cyan-deep': '44 127 133',
  '--danger': '255 77 77',
  '--danger-deep': '122 31 31',
  '--good': '84 209 160',
  '--good-deep': '31 107 79',
}

/** A warm near-black ramp. Most dark UIs run a cool ground under a warm
 *  accent; this inverts that, and it pairs with the already-warm bone. */
const WARM_INK: Channels = {
  '--ink-900': '10 8 7',
  '--ink-850': '14 11 10',
  '--ink-800': '20 16 14',
  '--ink-700': '28 23 20',
  '--ink-600': '38 31 27',
  '--ink-500': '52 43 37',
  '--ink-400': '71 60 52',
}

/** Pulled back off pure red, so an accent in the warm half of the wheel is not
 *  competing with the colour that means "you broke something". */
const CALM_DANGER: Channels = { '--danger': '229 72 77', '--danger-deep': '110 30 32' }

export const THEMES: Theme[] = [
  {
    id: 'amber',
    name: 'Amber',
    vars: {},
  },
  {
    id: 'bone',
    name: 'Bone',
    vars: { '--signal': '237 233 226', '--signal-hot': '255 255 255', '--signal-deep': '168 163 153' },
  },
  {
    id: 'magenta',
    name: 'Magenta',
    vars: { '--signal': '255 61 138', '--signal-hot': '255 107 166', '--signal-deep': '168 35 90', ...CALM_DANGER },
  },
  {
    id: 'ice',
    name: 'Ice on warm ink',
    vars: { ...WARM_INK, '--signal': '125 205 235', '--signal-hot': '170 226 245', '--signal-deep': '52 118 145' },
  },
  {
    id: 'chartreuse',
    name: 'Chartreuse',
    vars: { '--signal': '200 230 75', '--signal-hot': '219 240 130', '--signal-deep': '118 140 28' },
  },
  {
    id: 'coral',
    name: 'Coral',
    vars: { '--signal': '255 111 97', '--signal-hot': '255 145 133', '--signal-deep': '168 61 51', ...CALM_DANGER },
  },
]

export const DEFAULT_THEME_ID = THEMES[0].id
export const getTheme = (id: string | null | undefined) => THEMES.find((t) => t.id === id) ?? THEMES[0]

/* ------------------------------------------------------------ colour maths */

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

/** WCAG relative luminance. */
const luminance = (channels: string): number => {
  const [r, g, b] = channels.split(/\s+/).map((v) => {
    const c = Number(v) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Whichever candidate reads best on `background`. */
const readableOn = (background: string, candidates: string[]): string =>
  candidates.reduce((best, c) => (contrast(background, c) > contrast(background, best) ? c : best))

export const channelsToHex = (ch: string): string => {
  const [r, g, b] = ch.split(/\s+/).map((v) => clamp(Number(v)))
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/* ------------------------------------------------------------ apply + save */

const THEME_KEY = 'onboard.theme.v1'

/**
 * Always writes the FULL merged palette, never just the overrides. Switching
 * from a theme that moved the ground to one that does not has to put the
 * ground back, and a partial write would leave the warm ink behind.
 */
export function applyTheme(id: string): void {
  const vars: Channels = { ...BASE, ...getTheme(id).vars }
  /* Pick the button foreground by measured contrast rather than assuming the
   * accent is light. A user can choose any colour here, including a near-black
   * one, and dark-on-dark is the failure that makes a theme picker unusable. */
  vars['--signal-ink'] = readableOn(vars['--signal'], [vars['--ink-900'], vars['--bone']])
  const root = document.documentElement
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
}

export function loadThemeId(): string {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    // Storage is not a trust boundary, same rule as the session and the show.
    return THEMES.some((t) => t.id === raw) ? (raw as string) : DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

export function saveThemeId(id: string): void {
  try {
    localStorage.setItem(THEME_KEY, id)
  } catch {
    /* private mode — the theme lasts for this tab only */
  }
}

/** The three dots shown against a theme in the menu. */
export const themeSwatch = (t: Theme) => {
  const vars = { ...BASE, ...t.vars }
  return {
    ground: channelsToHex(vars['--ink-800']),
    accent: channelsToHex(vars['--signal']),
    text: channelsToHex(vars['--bone']),
  }
}
