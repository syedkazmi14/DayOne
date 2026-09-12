/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Tailwind's default opacity scale is in steps of 5, so modifiers like
      // /12 and /94 are silently dropped — which had quietly removed several
      // scrims and hairline borders. Allow every integer.
      opacity: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [i, String(i / 100)])),
      colors: {
        ink: {
          900: '#050607',
          850: '#08090C',
          800: '#0C0E12',
          700: '#12151B',
          600: '#191D25',
          500: '#232833',
          400: '#333A47',
        },
        bone: { DEFAULT: '#EDE9E2', dim: '#A8A399', faint: '#6E6B65' },
        signal: { DEFAULT: '#F5A524', hot: '#FF7A1A', deep: '#B26708' },
        cyan: { DEFAULT: '#6FD3D8', deep: '#2C7F85' },
        danger: { DEFAULT: '#FF4D4D', deep: '#7A1F1F' },
        good: { DEFAULT: '#54D1A0', deep: '#1F6B4F' },
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
