import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, type RoomDetail } from '../lib/api';
import { loadSession } from '../lib/session';
import { connectRoomWs, type WsEvent } from '../lib/ws';

type Tab = 'code' | 'qr' | 'url';

function QRImage({ url }: { url: string }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#0a0b1a', light: '#f0c040' },
    }).then(setDataUrl).catch(console.error);
  }, [url]);

  if (!dataUrl) return <div style={{ width: '100%', aspectRatio: '1', background: 'rgba(240,192,64,0.1)' }} />;
  return <img src={dataUrl} alt="QR Code" style={{ width: '100%', height: '100%', display: 'block' }} />;
}

export default function WaitingRoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const session = useMemo(() => loadSession(), []);

  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('code');

  const redirectToGame = useCallback((rid: string) => {
    if (!session) return;
    navigate(session.role === 'gm' ? `/room/${rid}/gm` : `/room/${rid}/player`);
  }, [navigate, session]);

  const fetchRoom = useCallback(async () => {
    if (!roomId) return;
    try {
      const data = await api.getRoom(roomId);
      setRoom(data);
      if (data.status === 'in_progress' || data.status === 'finished') redirectToGame(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    }
  }, [redirectToGame, roomId]);

  useEffect(() => {
    const t = setTimeout(() => { void fetchRoom(); }, 0);
    return () => clearTimeout(t);
  }, [fetchRoom]);

  useEffect(() => {
    if (!roomId) return;
    const disconnect = connectRoomWs(roomId, (event: WsEvent) => {
      if (event.type === 'room.player.joined') {
        void fetchRoom();
      } else if (event.type === 'turn.started') {
        navigate(session?.role === 'gm' ? `/room/${roomId}/gm` : `/room/${roomId}/player`);
      }
    });
    return disconnect;
  }, [roomId, navigate, session, fetchRoom]);

  const isGm = session?.role === 'gm';

  if (error) return (
    <div className="waiting-page">
      <div className="appbar" style={{ paddingTop: 18 }}>
        <div className="brand">MINORITY<span className="dot" />MONEY</div>
      </div>
      <div style={{ padding: '0 22px' }}><p className="error-msg">{error}</p></div>
    </div>
  );

  if (!room) return (
    <div className="waiting-page">
      <div className="appbar" style={{ paddingTop: 18 }}>
        <div className="brand">MINORITY<span className="dot" />MONEY</div>
        <div className="meta">WAITING ROOM</div>
      </div>
      <div style={{ padding: '0 22px' }}><span className="kicker">読み込み中…</span></div>
    </div>
  );

  const joinUrl = `${window.location.origin}/join?roomId=${room.id}`;

  return (
    <div className="waiting-page">
      <div className="appbar" style={{ paddingTop: 18 }}>
        <div className="brand">MINORITY<span className="dot" />MONEY</div>
        <div className="meta">ROOM / OPEN · {room.players.length} IN</div>
      </div>

      <div className="waiting-content">
        <div className="kicker" style={{ marginTop: 4 }}>JOIN VIA</div>

        <div className="tab-bar">
          {(['code', 'qr', 'url'] as Tab[]).map((k) => (
            <button key={k} className={`tab-btn${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
              {k === 'code' ? 'コード' : k === 'qr' ? 'QR' : 'URL'}
            </button>
          ))}
        </div>

        <div className="join-panel">
          {tab === 'code' && (
            <>
              <div className="kicker">ROOM CODE</div>
              <div className="room-code-display">{room.id}</div>
              <div style={{ marginTop: 8, fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.3em' }}>
                大文字小文字を区別しません
              </div>
            </>
          )}
          {tab === 'qr' && (
            <>
              <div className="kicker">SCAN TO JOIN</div>
              <div className="qr-wrapper"><QRImage url={joinUrl} /></div>
              <div style={{ marginTop: 8, fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.3em' }}>
                カメラで読み取り
              </div>
            </>
          )}
          {tab === 'url' && (
            <>
              <div className="kicker">ROOM URL</div>
              <div className="url-box" style={{ wordBreak: 'break-all', fontSize: 11 }}>{joinUrl}</div>
              <div style={{ marginTop: 8, fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.3em' }}>
                タップで開く
              </div>
            </>
          )}
        </div>

        <div className="action-row">
          <button
            className="btn"
            style={{ fontSize: 11, padding: '10px 8px' }}
            onClick={() => { void navigator.clipboard.writeText(room.id); }}
          >
            ⧉ コピー
          </button>
          {isGm && room.players.length >= 2 ? (
            <button
              className="btn gold"
              style={{ fontSize: 11, padding: '10px 8px' }}
              onClick={() => navigate(`/room/${room.id}/gm`)}
            >
              GMへ →
            </button>
          ) : (
            <button
              className="btn"
              style={{ fontSize: 11, padding: '10px 8px' }}
              onClick={() => void fetchRoom()}
            >
              更新
            </button>
          )}
        </div>

        <div className="hint-box">
          {isGm
            ? room.players.length >= 2
              ? 'GMコントロール画面からゲームを開始できます'
              : `あと${2 - room.players.length}人以上の参加が必要です`
            : 'GMがゲームを開始するまでお待ちください'}
        </div>

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexShrink: 0 }}>
          <div className="kicker">参加者</div>
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', letterSpacing: '0.2em' }}>
            <span style={{ color: 'var(--gold)', fontFamily: 'var(--font-display)' }}>
              {String(room.players.length).padStart(2, '0')}
            </span>
          </div>
        </div>

        <div className="player-list">
          {room.players.map((p, i) => {
            const isYou = p.id === session?.playerId;
            const isGmPlayer = p.id === room.gmPlayerId;
            return (
              <div key={p.id} className={`player-list-item${isYou ? ' you' : ''}`}>
                <span className="num" style={{ fontFamily: 'var(--font-display)', color: 'var(--ink-mute)', width: 22, fontSize: 13, flexShrink: 0 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="online-dot" />
                <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, color: isYou ? 'var(--cobalt)' : 'var(--ink)' }}>
                  {p.name}
                </span>
                {isGmPlayer && <span className="tag gold">GM</span>}
                {isYou && <span className="tag">YOU</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
