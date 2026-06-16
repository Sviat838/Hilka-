import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import analytics from './lib/analytics'
import './index.css'

// Boot product analytics before React mounts (no-op without VITE_MIXPANEL_TOKEN).
analytics.init()
analytics.track('App Loaded')

// Correctness is preserved by invalidateQueries on every mutation (useForest /
// usePats onSettled), which refetches regardless of staleTime — these defaults
// only drop the redundant refetch on every window refocus.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
