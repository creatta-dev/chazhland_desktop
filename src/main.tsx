import React from 'react'
import { createRoot } from 'react-dom/client'
import './theme/global.css'
import { ThemeProvider } from './theme/ThemeProvider'
import { AuthProvider } from './store/auth'
import { ErrorBoundary } from './components/ErrorBoundary'
import App from './App'

// Внешняя граница — последний рубеж (падение провайдеров/шапки). Стоит ВНУТРИ ThemeProvider,
// чтобы у фолбэка были переменные темы. Ближе к контенту есть своя граница — см. App.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>,
)
