import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStatus } from './hooks/useAuthStatus';
import { Login } from './pages/Login';
import { Yobox } from './pages/Yobox';
import { Receipts } from './pages/Receipts';
import { Feed } from './pages/Feed';
import { Sent } from './pages/Sent';
import { Gatekeeper } from './pages/Gatekeeper';
import { ThreadView } from './pages/ThreadView';
import { Compose } from './pages/Compose';
import { Search } from './pages/Search';

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
        <Routes>
          <Route path="/" element={<Yobox />} />
          <Route path="/receipts" element={<Receipts />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/sent" element={<Sent />} />
          <Route path="/gatekeeper" element={<Gatekeeper />} />
          <Route path="/compose" element={<Compose />} />
          <Route path="/search" element={<Search />} />
          <Route path="/thread/:id" element={<ThreadView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthGate>
    </BrowserRouter>
  );
}
