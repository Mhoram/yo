import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStatus } from './hooks/useAuthStatus';
import { Login } from './pages/Login';
import { Yobox } from './pages/Yobox';

// Everything except the landing inbox loads as its own chunk, fetched on
// first navigation to it. ThreadView and Compose drag in the tiptap/
// prosemirror editor stack — statically importing them here put ~250 KB of
// editor code in the initial bundle that a list-view session may never use.
const Receipts = lazy(() => import('./pages/Receipts').then((m) => ({ default: m.Receipts })));
const Feed = lazy(() => import('./pages/Feed').then((m) => ({ default: m.Feed })));
const Sent = lazy(() => import('./pages/Sent').then((m) => ({ default: m.Sent })));
const Gatekeeper = lazy(() => import('./pages/Gatekeeper').then((m) => ({ default: m.Gatekeeper })));
const ThreadView = lazy(() => import('./pages/ThreadView').then((m) => ({ default: m.ThreadView })));
const Compose = lazy(() => import('./pages/Compose').then((m) => ({ default: m.Compose })));
const Drafts = lazy(() => import('./pages/Drafts').then((m) => ({ default: m.Drafts })));
const Search = lazy(() => import('./pages/Search').then((m) => ({ default: m.Search })));

function AuthGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useAuthStatus();

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading...</div>;
  }

  if (!data?.authenticated) {
    return <Login />;
  }

  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Suspense fallback={<div className="p-8 text-muted-foreground">Loading...</div>}>
          <Routes>
          <Route path="/" element={<Yobox />} />
          <Route path="/receipts" element={<Receipts />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/sent" element={<Sent />} />
          <Route path="/gatekeeper" element={<Gatekeeper />} />
          <Route path="/compose" element={<Compose />} />
          <Route path="/drafts" element={<Drafts />} />
          <Route path="/search" element={<Search />} />
          <Route path="/thread/:id" element={<ThreadView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthGate>
    </BrowserRouter>
  );
}
