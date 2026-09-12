import { AnimatePresence, motion } from 'framer-motion'
import { AppShell } from './components/AppShell'
import { Authoring } from './components/screens/Authoring'
import { EpisodeIntro } from './components/screens/EpisodeIntro'
import { Home } from './components/screens/Home'
import { PickShow } from './components/screens/PickShow'
import { PlayerProfile } from './components/screens/PlayerProfile'
import { Results } from './components/screens/Results'
import { ScenePlayer } from './components/screens/ScenePlayer'
import { Shop } from './components/screens/Shop'
import { SignIn } from './components/screens/SignIn'
import { GameProvider, useGame } from './engine/gameStore'

/* Adapts the presentational SignIn to the reducer, so the SCREENS map can stay
 * a plain view->component lookup and sign-in gets the same transition as every
 * other screen. */
function SignInScreen() {
  const { dispatch } = useGame()
  return <SignIn onSignIn={(role, provider) => dispatch({ type: 'SIGN_IN', role, provider })} />
}

const SCREENS = {
  signin: SignInScreen,
  pickshow: PickShow,
  home: Home,
  intro: EpisodeIntro,
  scene: ScenePlayer,
  profile: PlayerProfile,
  shop: Shop,
  authoring: Authoring,
  results: Results,
} as const

function Router() {
  const { state } = useGame()
  /* The gate is enforced here as well as in the reducer: no session, no screen
   * but sign-in, whatever `view` happens to say. */
  const view = state.session ? state.view : 'signin'
  const Screen = SCREENS[view]
  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="h-full w-full"
        >
          <Screen />
        </motion.div>
      </AnimatePresence>
    </AppShell>
  )
}

export default function App() {
  return (
    <GameProvider>
      <Router />
    </GameProvider>
  )
}
