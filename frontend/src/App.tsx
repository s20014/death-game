import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import CreateRoomPage from './pages/CreateRoomPage';
import JoinRoomPage from './pages/JoinRoomPage';
import WaitingRoomPage from './pages/WaitingRoomPage';
import PlayerGamePage from './pages/PlayerGamePage';
import GmGamePage from './pages/GmGamePage';
import LogPage from './pages/LogPage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CreateRoomPage />} />
        <Route path="/join" element={<JoinRoomPage />} />
        <Route path="/room/:roomId/waiting" element={<WaitingRoomPage />} />
        <Route path="/room/:roomId/player" element={<PlayerGamePage />} />
        <Route path="/room/:roomId/gm" element={<GmGamePage />} />
        <Route path="/room/:roomId/log" element={<LogPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
