import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import { CardPreviewProvider } from './cards/CardPreview';
import { CardsPage } from './cards/CardsPage';
import { DesignPage } from './design/DesignPage';
import { CubeImportPage } from './cubes/CubeImportPage';
import { CubeListPage } from './cubes/CubeListPage';
import { CubeStatsPage } from './cubes/CubeStatsPage';
import { PlayerStatsPage } from './stats/PlayerStatsPage';
import { DraftConfigListPage } from './drafts/DraftConfigListPage';
import { DraftConfigPage } from './drafts/DraftConfigPage';
import { DraftHistoryDeckPage } from './drafts/DraftHistoryDeckPage';
import { DraftHistoryPage } from './drafts/DraftHistoryPage';
import { CubePage } from './cubes/CubePage';
import { DeckImportPage } from './decks/DeckImportPage';
import { DeckListPage } from './decks/DeckListPage';
import { DeckPage } from './decks/DeckPage';
import { NewWizard } from './play/NewWizard';
import { RoomPage } from './rooms/RoomPage';
import { useMe } from './lib/auth';
import { InvitesPage } from './play/InvitesPage';
import { PlayPage } from './play/PlayPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { Shell } from './shell/Shell';

export function App() {
  const me = useMe();
  if (me.isPending) return <div className="p-6 text-text-muted">Loading…</div>;
  if (me.isError) return <div className="p-6 text-danger">Cannot reach the server: {me.error.message}</div>;
  const user = me.data;
  /** Signed-in only; everything else bounces to the login page. */
  const Guard = () => (user ? <Outlet /> : <Navigate to="/login" replace />);

  return (
    <BrowserRouter>
      <CardPreviewProvider>
      <Routes>
        <Route path="/design" element={<DesignPage />} />
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
        <Route element={<Guard />}>
          {/* Pages live in the shell (top bar); the room itself is full-viewport. */}
          <Route element={<Shell />}>
            <Route path="/" element={<PlayPage />} />
            <Route path="/play/new" element={<NewWizard />} />
            <Route path="/invites" element={user?.isAdmin ? <InvitesPage /> : <Navigate to="/" replace />} />
            <Route path="/cards" element={<CardsPage />} />
            <Route path="/decks" element={<DeckListPage />} />
            <Route path="/decks/new" element={<DeckImportPage />} />
            <Route path="/decks/:id" element={<DeckPage />} />
            <Route path="/cubes" element={<CubeListPage />} />
            <Route path="/cubes/new" element={<CubeImportPage />} />
            <Route path="/cubes/:id" element={<CubePage />} />
            <Route path="/cubes/:id/stats" element={<CubeStatsPage />} />
            <Route path="/drafts" element={<DraftConfigListPage />} />
            <Route path="/drafts/new" element={<DraftConfigPage />} />
            <Route path="/drafts/history" element={<DraftHistoryPage />} />
            <Route path="/drafts/history/:roomId" element={<DraftHistoryDeckPage />} />
            <Route path="/drafts/:id" element={<DraftConfigPage />} />
            <Route path="/players/:id/stats" element={<PlayerStatsPage />} />
          </Route>
          {/* Old entry points keep working. */}
          <Route path="/rooms" element={<Navigate to="/" replace />} />
          <Route path="/rooms/new" element={<Navigate to="/play/new" replace />} />
          <Route path="/rooms/:id" element={<RoomPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </CardPreviewProvider>
    </BrowserRouter>
  );
}
