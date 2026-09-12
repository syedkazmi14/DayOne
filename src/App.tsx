import { AnimatePresence, motion } from 'framer-motion'
import { AppShell } from './components/AppShell'
import { Authoring } from './components/screens/Authoring'
import { EpisodeIntro } from './components/screens/EpisodeIntro'
import { Home } from './components/screens/Home'
import { PlayerProfile } from './components/screens/PlayerProfile'
import { Results } from './components/screens/Results'
import { ScenePlayer } from './components/screens/ScenePlayer'
import { Shop } from './components/screens/Shop'
import { GameProvider, useGame } from './engine/gameStore'

const SCREENS = {
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
  const Screen = SCREENS[state.view]
  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <motion.div
          key={state.view}
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
