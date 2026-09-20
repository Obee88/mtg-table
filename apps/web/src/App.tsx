import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { CardPreviewProvider } from './cards/CardPreview';
import { CardsPage } from './cards/CardsPage';
import { DesignPage } from './design/DesignPage';
import { CubeImportPage } from './cubes/CubeImportPage';
import { CubeListPage } from './cubes/CubeListPage';
import { CubeStatsPage } from './cubes/CubeStatsPage';
import { PlayerStatsPage } from './stats/PlayerStatsPage';
import { DraftConfigListPage } from './drafts/DraftConfigListPage';
import { DraftConfigPage } from './drafts/DraftConfigPage';
import { CubePage } from './cubes/CubePage';
import { DeckImportPage } from './decks/DeckImportPage';
import { DeckListPage } from './decks/DeckListPage';
import { DeckPage } from './decks/DeckPage';
import { RoomListPage } from './rooms/RoomListPage';
import { RoomPage } from './rooms/RoomPage';
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
        <Route path="/design" element={<DesignPage />} />
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
        <Route path="/" element={user ? <HomePage user={user} /> : <Navigate to="/login" replace />} />
        <Route path="/cards" element={user ? <CardsPage /> : <Navigate to="/login" replace />} />
        <Route path="/decks" element={user ? <DeckListPage /> : <Navigate to="/login" replace />} />
        <Route path="/decks/new" element={user ? <DeckImportPage /> : <Navigate to="/login" replace />} />
        <Route path="/decks/:id" element={user ? <DeckPage /> : <Navigate to="/login" replace />} />
        <Route path="/cubes" element={user ? <CubeListPage /> : <Navigate to="/login" replace />} />
        <Route path="/cubes/new" element={user ? <CubeImportPage /> : <Navigate to="/login" replace />} />
        <Route path="/cubes/:id" element={user ? <CubePage /> : <Navigate to="/login" replace />} />
        <Route path="/cubes/:id/stats" element={user ? <CubeStatsPage /> : <Navigate to="/login" replace />} />
        <Route path="/drafts" element={user ? <DraftConfigListPage /> : <Navigate to="/login" replace />} />
        <Route path="/drafts/new" element={user ? <DraftConfigPage /> : <Navigate to="/login" replace />} />
        <Route path="/drafts/:id" element={user ? <DraftConfigPage /> : <Navigate to="/login" replace />} />
        <Route path="/players/:id/stats" element={user ? <PlayerStatsPage /> : <Navigate to="/login" replace />} />
        <Route path="/rooms" element={user ? <RoomListPage /> : <Navigate to="/login" replace />} />
        <Route path="/rooms/:id" element={user ? <RoomPage /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </CardPreviewProvider>
    </BrowserRouter>
  );
}
