/** Resolve a palette token through its channel variable, alpha modifiers intact. */
const channels = (name) => `rgb(var(${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Tailwind's default opacity scale is in steps of 5, so modifiers like
      // /12 and /94 are silently dropped — which had quietly removed several
      // scrims and hairline borders. Allow every integer.
      opacity: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [i, String(i / 100)])),
      /* Every palette token resolves through a CSS variable holding SPACE-
       * SEPARATED RGB CHANNELS, not a hex string, so `<alpha-value>` keeps
       * working: the codebase leans on modifiers like bg-signal/45 and
       * ink-900/72 in well over a hundred places, and a var holding `#F5A524`
       * would silently drop every one of them.
       *
       * The channel values live in src/index.css (:root) and the theme picker
       * overwrites them at runtime — see src/theme/themes.ts. */
      colors: {
        ink: {
          900: channels('--ink-900'),
          850: channels('--ink-850'),
          800: channels('--ink-800'),
          700: channels('--ink-700'),
          600: channels('--ink-600'),
          500: channels('--ink-500'),
          400: channels('--ink-400'),
        },
        bone: { DEFAULT: channels('--bone'), dim: channels('--bone-dim'), faint: channels('--bone-faint') },
        signal: {
          DEFAULT: channels('--signal'),
          hot: channels('--signal-hot'),
          deep: channels('--signal-deep'),
          /* Text/icon colour for anything sitting ON a signal fill. */
          ink: channels('--signal-ink'),
        },
        cyan: { DEFAULT: channels('--cyan'), deep: channels('--cyan-deep') },
        danger: { DEFAULT: channels('--danger'), deep: channels('--danger-deep') },
        good: { DEFAULT: channels('--good'), deep: channels('--good-deep') },
      },
      fontFamily: {
        sans: ['DM Sans', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: { ultra: '0.15em', mega: '0.24em' },
      // `rounded` is the only radius in the app. See --radius in index.css.
      borderRadius: { DEFAULT: 'var(--radius)' },
      keyframes: {
        grain: {
          '0%,100%': { transform: 'translate(0,0)' },
          '10%': { transform: 'translate(-5%,-5%)' },
          '20%': { transform: 'translate(-10%,5%)' },
          '30%': { transform: 'translate(5%,-10%)' },
          '40%': { transform: 'translate(-5%,15%)' },
          '50%': { transform: 'translate(-10%,5%)' },
          '60%': { transform: 'translate(15%,0)' },
          '70%': { transform: 'translate(0,10%)' },
          '80%': { transform: 'translate(-15%,0)' },
          '90%': { transform: 'translate(10%,5%)' },
        },
        kenburns: {
          '0%': { transform: 'scale(1.04) translate3d(0,0,0)' },
          '100%': { transform: 'scale(1.16) translate3d(-1.5%,-1%,0)' },
        },
        flicker: { '0%,100%': { opacity: '0.85' }, '48%': { opacity: '0.9' }, '50%': { opacity: '0.55' }, '52%': { opacity: '0.88' } },
        sweep: { '0%': { transform: 'translateX(-120%)' }, '100%': { transform: 'translateX(220%)' } },
        breathe: { '0%,100%': { opacity: '0.35' }, '50%': { opacity: '0.75' } },
      },
      animation: {
        grain: 'grain 1.2s steps(4) infinite',
        kenburns: 'kenburns 24s ease-out forwards',
        flicker: 'flicker 6s linear infinite',
        sweep: 'sweep 2.4s cubic-bezier(.4,0,.2,1) infinite',
        breathe: 'breathe 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
