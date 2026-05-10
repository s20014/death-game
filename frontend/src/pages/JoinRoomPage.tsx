import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { saveSession } from '../lib/session';

export default function JoinRoomPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [roomId, setRoomId] = useState(searchParams.get('roomId') ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!roomId.trim() || !name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.joinRoom(roomId.trim(), name.trim());
      saveSession({ roomId: res.room.id, role: 'player', playerId: res.playerId });
      navigate(`/room/${res.room.id}/waiting`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="appbar" style={{ paddingTop: 18 }}>
        <div className="brand">MINORITY<span className="dot" />MONEY</div>
      </div>

      <div style={{ padding: '0 22px', marginBottom: 20 }}>
        <div className="kicker" style={{ marginBottom: 8 }}>PLAYER · 参加</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--ink)', letterSpacing: '0.04em', lineHeight: 1.3 }}>
          ルームに<br />参加する
        </div>
      </div>

      <div className="form-card">
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label" htmlFor="room-id">ルームID</label>
            <input
              id="room-id"
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="ルームIDを入力"
              required
            />
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="player-name">プレイヤー名</label>
            <input
              id="player-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="あなたの名前を入力"
              maxLength={20}
              required
            />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" className="btn primary form-btn" disabled={loading}>
            {loading ? '参加中…' : '参加する →'}
          </button>
        </form>
      </div>

      <div className="form-link">
        <a href="/">GMとしてルームを作成する →</a>
      </div>
    </div>
  );
}
