import { TitleBar } from './components/TitleBar'
import { ConnectionBanner } from './components/ConnectionBanner'
import { Toaster } from './components/Toaster'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAuth } from './store/auth'
import { AuthScreen } from './features/auth/AuthScreen'
import { MainWindow } from './features/main/MainWindow'

export default function App() {
  const { session } = useAuth()
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <TitleBar />
      {session && <ConnectionBanner />}
      {/* граница вокруг контента: шапка окна (перетаскивание, закрыть) переживает падение экрана */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* key: смена экрана (логин/выход) пересоздаёт границу — иначе она осталась бы в ошибке */}
        <ErrorBoundary key={session ? 'main' : 'auth'}>
          {session ? <MainWindow /> : <AuthScreen />}
        </ErrorBoundary>
      </div>
      <Toaster />
    </div>
  )
}
