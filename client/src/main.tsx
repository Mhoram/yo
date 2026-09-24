import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import { App } from './App';
import './index.css';

// Gmail's API quota is tight enough that retrying a failed request is
// actively harmful, not helpful: a quota-exceeded response means "wait",
// and blind retries just compound the problem within the same minute-long
// quota window. Same reasoning for refetch-on-focus: don't re-hit Gmail
// just because the tab regained focus.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

// Production-only: registering a service worker under Vite's dev server
// makes it easy to end up debugging a stale cached build instead of your
// actual changes, for no benefit. This worker exists purely so the
// manifest + icons satisfy PWA installability, nothing it does depends on
// running in dev.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}
