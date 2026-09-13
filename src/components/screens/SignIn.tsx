import { motion } from 'framer-motion'
import { useState } from 'react'
import { Eyebrow } from '../ui/Bits'

/* ============================================================================
 * SIGN-IN — the front door. Nobody has played anything yet, so there is no
 * episode art to lean on: this screen is type and one decision, nothing else.
 *
 * Auth is a stub, openly. Submitting signs you in; so does the SSO button.
 * Nothing is checked, because there is nothing behind this to check against.
 *
 * The credential fields are deliberately UNCONTROLLED and never read — no
 * state holds them, nothing persists or transmits them, and autoComplete is
 * off so a password manager never offers to save one. A field that looks like
 * a login but authenticates nothing is exactly the place someone types their
 * real work password, so the stub notice stays visible under the form.
 *
 * Employee is the default because that is who almost everyone is. The admin
 * path is a link, not a fork in the road — a company sets up their content
 * once, and then thousands of people sign in to play it.
 * ========================================================================== */

export type SessionRole = 'employee' | 'admin'

interface Props {
  onSignIn: (role: SessionRole, provider: string) => void
}

const EASE = [0.16, 1, 0.3, 1] as const

const FIELD =
  'w-full border border-bone/12 bg-ink-800 px-4 py-3 font-sans text-[13.5px] text-bone outline-none transition-colors placeholder:text-bone-faint focus:border-signal/50'

export function SignIn({ onSignIn }: Props) {
  const [admin, setAdmin] = useState(false)
  const role: SessionRole = admin ? 'admin' : 'employee'

  return (
    <div className="relative h-full overflow-y-auto bg-ink-900">
      <div className="mx-auto grid min-h-full max-w-6xl lg:grid-cols-[1.1fr_1fr]">
        {/* left: what this thing is */}
        <div className="flex flex-col justify-center px-6 py-16 sm:px-12 lg:px-16 lg:py-16">
          <Eyebrow>the onboarding deck, dramatized</Eyebrow>

          <div className="mt-3 overflow-hidden">
            <motion.h1
              initial={{ y: '100%' }}
              animate={{ y: '0%' }}
              transition={{ duration: 0.7, ease: EASE }}
              className="t-display text-[clamp(3rem,9vw,5.5rem)] text-bone"
            >
              DayOne
            </motion.h1>
          </div>

          <p className="mt-5 max-w-md font-sans text-[15.5px] font-light leading-relaxed text-bone-dim">
            Your company's onboarding material, turned into episodes where you're the one making the calls. Wrong
            calls have consequences. That's the training.
          </p>
        </div>

        {/* right: sign in and go */}
        <div className="flex flex-col justify-center px-6 py-14 sm:px-12 lg:px-16 lg:py-16">
          {/* The one eyebrow in DM Sans rather than the mono default: it labels the
            * form directly below it, and mono read as a system caption there. A
            * weight and tracking bump compensates — DM Sans at 10px uppercase is
            * noticeably lighter than JetBrains Mono at the same size. */}
          <Eyebrow className="font-sans font-medium tracking-[0.16em]">
            {admin ? 'company admin' : 'sign in'}
          </Eyebrow>

          {admin && (
            <p className="mt-3 max-w-sm font-sans text-[13px] font-light leading-relaxed text-bone-dim">
              Bring the handbook and the policy decks. You review every episode before a single employee sees it.
            </p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              onSignIn(role, 'Email')
            }}
            className="mt-4 max-w-sm space-y-2.5"
          >
            <input type="email" name="email" placeholder="Work email" autoComplete="off" className={FIELD} />
            <input type="password" name="password" placeholder="Password" autoComplete="off" className={FIELD} />
            <button
              type="submit"
              className="w-full bg-signal px-4 py-3 font-sans text-[13.5px] font-semibold text-signal-ink transition-colors hover:bg-signal-hot"
            >
              Sign in
            </button>
          </form>

          <div className="mt-6 flex max-w-sm items-center gap-4">
            <span className="h-px flex-1 bg-bone/10" />
            <span className="t-eyebrow">or</span>
            <span className="h-px flex-1 bg-bone/10" />
          </div>

          <button
            onClick={() => onSignIn(role, 'Company SSO')}
            className="choice mt-6 max-w-sm px-4 py-3 text-center font-sans text-[13.5px] font-medium text-bone"
          >
            Company SSO
          </button>

          <button
            onClick={() => setAdmin((v) => !v)}
            className="mt-8 self-start font-sans text-[13px] text-bone-dim underline decoration-bone/25 underline-offset-4 transition-colors hover:text-signal"
          >
            {admin ? 'Just here to do your training?' : 'Company admin?'}
          </button>

          <p className="mt-10 max-w-sm font-mono text-[10px] uppercase leading-relaxed tracking-[0.12em] text-bone-faint">
            auth is stubbed for this prototype. nothing is checked, nothing is stored. do not type a real password.
          </p>
        </div>
      </div>
    </div>
  )
}
