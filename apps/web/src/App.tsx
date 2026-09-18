import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { CardPreviewProvider } from './cards/CardPreview';
import { CardsPage } from './cards/CardsPage';
import { useMe } from './lib/auth';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

export function App() {
  const me = useMe();
  if (me.isPending) return <div className="p-6 text-text-muted">Loading…</div>;
  if (me.isError) return <div className="p-6 text-danger">Cannot reach the server: {me.error.message}</div>;
  const user = me.data;

  return (
    <BrowserRouter>
      <CardPreviewProvider>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
        <Route path="/" element={user ? <HomePage user={user} /> : <Navigate to="/login" replace />} />
        <Route path="/cards" element={user ? <CardsPage /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </CardPreviewProvider>
    </BrowserRouter>
  );
}
