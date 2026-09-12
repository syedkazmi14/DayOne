import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { Eyebrow } from '../ui/Bits'

/* ============================================================================
 * SIGN-IN — the front door. Nobody has played anything yet, so there is no
 * episode art to lean on: this screen is type and one decision, nothing else.
 *
 * It is a fake SSO picker, on purpose and openly. Pick a provider and you're
 * in — no password field exists because nothing here checks one. Say that out
 * loud rather than let the chrome imply otherwise; this codebase doesn't
 * pretend to integrations it doesn't have.
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

const PROVIDERS = [
  { id: 'okta', mark: 'OK', name: 'Okta', blurb: 'Workforce identity, the popular one.' },
  { id: 'entra', mark: 'ME', name: 'Microsoft Entra', blurb: 'Formerly Azure AD. Still is, really.' },
  { id: 'workspace', mark: 'GW', name: 'Google Workspace', blurb: "Whatever's on your company email." },
]

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

        {/* right: pick a provider and go */}
        <div className="flex flex-col justify-center px-6 py-14 sm:px-12 lg:px-16 lg:py-16">
          <Eyebrow>{admin ? 'company admin' : 'sign in'}</Eyebrow>

          {admin && (
            <p className="mt-3 max-w-sm font-sans text-[13px] font-light leading-relaxed text-bone-dim">
              Bring the handbook and the policy decks. You review every episode before a single employee sees it.
            </p>
          )}

          <div className="mt-4 space-y-2.5">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => onSignIn(role, p.name)}
                className="choice group flex w-full items-center gap-4 p-4"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-bone/15 bg-ink-700 font-mono text-[11px] font-bold uppercase tracking-wide text-bone-dim">
                  {p.mark}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-sans text-[13.5px] font-medium text-bone">{p.name}</span>
                  <span className="block font-sans text-[12px] font-light text-bone-faint">{p.blurb}</span>
                </span>
                <ArrowRight
                  size={15}
                  className="shrink-0 text-bone-faint transition-transform duration-300 group-hover:translate-x-1 group-hover:text-signal"
                />
              </button>
            ))}
          </div>

          <button
            onClick={() => setAdmin((v) => !v)}
            className="mt-6 self-start font-sans text-[13px] text-bone-dim underline decoration-bone/25 underline-offset-4 transition-colors hover:text-signal"
          >
            {admin ? 'Just here to do your training?' : 'Company admin?'}
          </button>

          <p className="mt-10 font-mono text-[10px] uppercase leading-relaxed tracking-[0.12em] text-bone-faint">
            auth is stubbed for this prototype — picking a provider signs you in. nothing is verified.
          </p>
        </div>
      </div>
    </div>
  )
}
