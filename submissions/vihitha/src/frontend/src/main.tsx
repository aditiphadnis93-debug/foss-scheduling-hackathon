import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { ApiError } from './api/client'
import { AppProvider } from './lib/app'
import { Shell } from './components/Shell'
import Calendar from './pages/Calendar'
import WhatIf from './pages/WhatIf'
import Cases from './pages/Cases'
import Metrics from './pages/Metrics'
import Settings from './pages/Settings'
import PublicSlot from './pages/PublicSlot'

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry once on network trouble; never retry a real 4xx answer.
      retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status >= 400 && e.status < 500),
      refetchOnWindowFocus: true,
      staleTime: 30_000,  // mutations refresh immediately (refreshAll); this only limits focus refetches
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/public/*" element={<PublicSlot />} />
          <Route element={<AppProvider><Shell /></AppProvider>}>
            <Route index element={<Calendar />} />
            <Route path="whatif" element={<WhatIf />} />
            <Route path="cases" element={<Cases />} />
            <Route path="metrics" element={<Metrics />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
