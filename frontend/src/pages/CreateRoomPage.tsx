import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { saveSession } from '../lib/session';

export default function CreateRoomPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [maxTurns, setMaxTurns] = useState(5);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.createRoom(name.trim(), maxTurns);
      saveSession({ roomId: res.room.id, role: 'gm', playerId: res.gmPlayerId });
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
        <div className="kicker" style={{ marginBottom: 8 }}>GM · ルーム作成</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--ink)', letterSpacing: '0.04em', lineHeight: 1.3 }}>
          少数派が<br />賞金を獲得する
        </div>
      </div>

      <div className="form-card">
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label" htmlFor="gm-name">GM名</label>
            <input
              id="gm-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="あなたの名前を入力"
              maxLength={20}
              required
            />
          </div>

          <div className="form-field" style={{ marginTop: 16 }}>
            <label className="form-label">ターン数</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {[3, 5, 7, 10].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxTurns(n)}
                  style={{
                    padding: '8px 16px',
                    fontFamily: 'var(--font-display)',
                    fontSize: 14,
                    letterSpacing: '0.1em',
                    border: maxTurns === n ? '2px solid var(--gold)' : '2px solid rgba(255,255,255,0.2)',
                    background: maxTurns === n ? 'rgba(240,192,64,0.15)' : 'transparent',
                    color: maxTurns === n ? 'var(--gold)' : 'var(--ink-mute)',
                    cursor: 'pointer',
                    borderRadius: 2,
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.2em' }}>
              {maxTurns}ターンで終了 · 最終所持金が多い人が勝利
            </div>
          </div>

          {error && <p className="error-msg">{error}</p>}
          <button type="submit" className="btn primary form-btn" disabled={loading} style={{ marginTop: 20 }}>
            {loading ? '作成中…' : 'ルームを作成 →'}
          </button>
        </form>
      </div>

      <div className="form-link">
        <a href="/join">参加者として入室する →</a>
      </div>
    </div>
  );
}
