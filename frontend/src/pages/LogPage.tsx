import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type RoomDetail, type TurnView, type TurnResultView, type YesNoResultView } from '../lib/api';
import { connectRoomWs, type WsEvent } from '../lib/ws';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function fmt(n: number) {
  return '¥' + n.toLocaleString('ja-JP');
}

// ---- In-game log (voting or revealed) ----
function LogInGame({
  room, turn, revealed,
}: {
  room: RoomDetail;
  turn: TurnView;
  revealed: boolean;
}) {
  const choices = turn.choices ?? [];
  const result = revealed ? (turn.result as TurnResultView | null) : null;
  const alivePlayers = room.players.filter((p) => p.alive);
  const unsubmitted = (turn.unsubmittedPlayerIds as string[] | undefined) ?? [];
  const votedCount = alivePlayers.length - unsubmitted.length;

  // Build per-choice voter info from result
  type ChoiceInfo = { letter: string; text: string; count: number; pct: number; mino: boolean; voterNames: string[] };
  const choiceInfos: ChoiceInfo[] = choices.map((c, idx) => {
    if (!result || result.mode !== 'normal') {
      return { letter: LETTERS[idx] ?? String(idx), text: c.text, count: 0, pct: 0, mino: false, voterNames: [] };
    }
    const r = result as TurnResultView;
    const count = r.counts[c.id] ?? 0;
    const total = choices.reduce((s, ch) => s + (r.counts[ch.id] ?? 0), 0);
    const voterNames = r.applied
      .filter((a) => a.selectedChoiceId === c.id)
      .map((a) => a.playerName);
    return {
      letter: LETTERS[idx] ?? String(idx),
      text: c.text,
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
      mino: r.minorityChoiceIds.includes(c.id),
      voterNames,
    };
  });

  // Per-player choice letter for ranking table
  const playerChoiceLetter = (playerId: string): string => {
    if (!result) return '';
    const applied = result.applied.find((a) => a.playerId === playerId);
    if (!applied) return '—';
    const idx = choices.findIndex((c) => c.id === applied.selectedChoiceId);
    return idx >= 0 ? (LETTERS[idx] ?? '?') : '?';
  };

  const playerDelta = (playerId: string): number | undefined => {
    return result?.applied.find((a) => a.playerId === playerId)?.totalDelta;
  };

  const minorityLetters = choiceInfos.filter((c) => c.mino).map((c) => c.letter).join(', ');

  return (
    <div className="log-page">
      <div className="log-overlay" />
      <div className="log-inner">
        {/* Header */}
        <div className="log-header">
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.36em', color: 'var(--cobalt)', textShadow: '0 0 14px rgba(160,196,255,0.35)' }}>
              少数派<span style={{ display: 'inline-block', width: 6, height: 6, background: 'var(--red)', borderRadius: '50%', margin: '0 8px 2px', verticalAlign: 'middle', boxShadow: '0 0 10px var(--red)' }} />デスストーリー
            </div>
            <div style={{ marginTop: 6, fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--ink-mute)', letterSpacing: '0.2em' }}>
              ROOM {room.id.slice(0, 16)} · LIVE
            </div>
          </div>
          <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)' }}>
            <div className="kicker" style={{ color: 'var(--ink-mute)' }}>CURRENT TURN</div>
            <div style={{ fontSize: 56, lineHeight: 1, color: 'var(--gold)', letterSpacing: '0.05em', fontVariantNumeric: 'tabular-nums', textShadow: '0 0 24px rgba(240,192,64,0.3)' }}>
              {String(turn.turnNumber).padStart(2, '0')}
            </div>
          </div>
        </div>

        {/* Story banner */}
        <div className="log-story-banner">
          <div>
            <div className="kicker" style={{ color: 'var(--cobalt)' }}>STORY</div>
            <div style={{ marginTop: 4, fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink)', letterSpacing: '0.04em' }}>
              {turn.story ?? '—'}
            </div>
          </div>
          {revealed ? (
            <div style={{ padding: '8px 14px', background: 'rgba(240,192,64,0.12)', border: '1px solid rgba(240,192,64,0.4)', color: 'var(--gold)', fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.3em', whiteSpace: 'nowrap', flexShrink: 0 }}>
              少数派 → {minorityLetters || '—'}
            </div>
          ) : (
            <div style={{ padding: '8px 14px', background: 'rgba(160,196,255,0.08)', border: '1px dashed rgba(160,196,255,0.4)', color: 'var(--cobalt)', fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.3em', whiteSpace: 'nowrap', flexShrink: 0 }}>
              投票受付中…
            </div>
          )}
        </div>

        {/* Main grid: ranking + choices */}
        <div className="log-main-grid">
          {/* Ranking */}
          <div className="log-ranking">
            <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexShrink: 0 }}>
              <div className="kicker" style={{ color: 'var(--gold)' }}>RANKING · 資産順位</div>
              <div style={{ fontSize: 11, color: 'var(--ink-mute)', letterSpacing: '0.2em' }}>
                生存 {alivePlayers.length} / {room.players.length}
              </div>
            </div>
            <div className="log-ranking-grid">
              {/* header row */}
              {(['順位', 'プレイヤー', revealed ? '選択' : '状態', '所持金', '増減'] as const).map((h, i) => (
                <div key={i} style={{ padding: '6px 8px', fontSize: 10, letterSpacing: '0.2em', color: 'var(--ink-faint)', textTransform: 'uppercase', borderBottom: '1px solid var(--line)', textAlign: i >= 3 ? 'right' : i === 2 ? 'center' : 'left' }}>
                  {h}
                </div>
              ))}
              {/* player rows */}
              {room.players.map((p, i) => {
                const delta = playerDelta(p.id);
                const choiceLetter = revealed ? playerChoiceLetter(p.id) : (p.alive && !unsubmitted.includes(p.id) ? 'DONE' : 'WAIT');
                const choiceMino = revealed && result?.mode === 'normal'
                  ? (result as TurnResultView).minorityChoiceIds.includes(
                      (result as TurnResultView).applied.find((a) => a.playerId === p.id)?.selectedChoiceId ?? ''
                    )
                  : false;
                return [
                  <div key={`r${i}`} style={{ padding: '8px 8px', fontFamily: 'var(--font-display)', color: p.rank === 1 ? 'var(--gold)' : 'var(--ink-mute)', fontSize: 16, opacity: p.alive ? 1 : 0.4, background: p.rank === 1 ? 'rgba(240,192,64,0.05)' : undefined }}>
                    {String(p.rank ?? i + 1).padStart(2, '0')}
                  </div>,
                  <div key={`n${i}`} style={{ padding: '8px 8px', fontWeight: 600, opacity: p.alive ? 1 : 0.4, display: 'flex', alignItems: 'center', gap: 6, color: p.alive ? 'var(--ink)' : 'var(--ink-faint)', textDecoration: p.alive ? 'none' : 'line-through', background: p.rank === 1 ? 'rgba(240,192,64,0.05)' : undefined, fontSize: 13 }}>
                    {p.name}
                    {p.id === room.gmPlayerId && <span className="tag gold" style={{ fontSize: 9 }}>GM</span>}
                  </div>,
                  <div key={`c${i}`} style={{ padding: '8px 0', textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: revealed ? 16 : 10, color: revealed ? (choiceMino ? 'var(--gold)' : 'var(--ink-mute)') : (p.alive && !unsubmitted.includes(p.id) ? 'var(--green)' : 'var(--red)'), letterSpacing: revealed ? 0 : '0.15em', opacity: p.alive ? 1 : 0.5, background: p.rank === 1 ? 'rgba(240,192,64,0.05)' : undefined }}>
                    {p.alive ? choiceLetter : '—'}
                  </div>,
                  <div key={`m${i}`} style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--font-display)', fontSize: 16, color: p.money === 0 ? 'var(--red)' : 'var(--gold)', fontVariantNumeric: 'tabular-nums', opacity: p.alive ? 1 : 0.5, background: p.rank === 1 ? 'rgba(240,192,64,0.05)' : undefined }}>
                    {fmt(p.money)}
                  </div>,
                  <div key={`d${i}`} style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'var(--font-display)', fontSize: 13, color: revealed && delta !== undefined ? (delta >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--ink-faint)', fontVariantNumeric: 'tabular-nums', opacity: p.alive ? 1 : 0.4, background: p.rank === 1 ? 'rgba(240,192,64,0.05)' : undefined }}>
                    {revealed && delta !== undefined ? `${delta >= 0 ? '+' : ''}${delta.toLocaleString('ja-JP')}` : '—'}
                  </div>,
                ];
              })}
            </div>
          </div>

          {/* Choices / Voting panel */}
          <div className="log-choices-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, flexShrink: 0 }}>
              <div className="kicker" style={{ color: revealed ? 'var(--cobalt)' : 'var(--ink-mute)' }}>
                {revealed ? 'CHOICES · 投票結果' : 'VOTING · 投票進捗'}
              </div>
              {!revealed && (
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--cobalt)', letterSpacing: '0.2em' }}>
                  {votedCount} / {alivePlayers.length}
                </div>
              )}
            </div>

            {revealed ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflow: 'hidden' }}>
                {choiceInfos.map((c) => (
                  <div key={c.letter} style={{ padding: '8px 10px', background: c.mino ? 'rgba(240,192,64,0.08)' : 'rgba(160,196,255,0.04)', border: c.mino ? '1px solid rgba(240,192,64,0.4)' : '1px solid var(--line)', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: c.mino ? 'var(--gold)' : 'var(--cobalt)', width: 28 }}>{c.letter}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{c.text}</span>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontVariantNumeric: 'tabular-nums', color: c.mino ? 'var(--gold)' : 'var(--ink)' }}>{c.count}</span>
                      <span style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.2em' }}>票</span>
                    </div>
                    <div style={{ marginTop: 6, height: 4, background: 'rgba(255,255,255,0.05)' }}>
                      <div style={{ width: `${c.pct}%`, height: '100%', background: c.mino ? 'var(--gold)' : 'var(--cobalt-deep)' }} />
                    </div>
                    {c.voterNames.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {c.voterNames.map((name) => (
                          <span key={name} style={{ padding: '2px 8px', border: '1px solid var(--line)', background: 'rgba(0,0,0,0.2)', fontSize: 10, color: 'var(--ink-mute)' }}>
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '20px 14px', textAlign: 'center', border: '1px dashed rgba(160,196,255,0.3)', background: 'rgba(160,196,255,0.04)' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 56, color: 'var(--cobalt)', lineHeight: 1, letterSpacing: '0.05em', fontVariantNumeric: 'tabular-nums', textShadow: '0 0 20px rgba(160,196,255,0.3)' }}>
                    {votedCount}<span style={{ color: 'var(--ink-faint)' }}> / {alivePlayers.length}</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, letterSpacing: '0.4em', color: 'var(--ink-mute)' }}>VOTES IN</div>
                </div>
                {unsubmitted.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div className="kicker" style={{ marginBottom: 8 }}>未投票</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {unsubmitted.map((id) => {
                        const p = room.players.find((pl) => pl.id === id);
                        return (
                          <span key={id} style={{ padding: '4px 10px', border: '1px solid rgba(244,67,54,0.5)', background: 'rgba(244,67,54,0.08)', color: 'var(--red)', fontSize: 12 }}>
                            {p?.name ?? id}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 12, padding: '8px 12px', fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.2em', textAlign: 'center', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--line)' }}>
                  GMが結果確定を押すまで非公開
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Final standings ----
function LogFinal({ room }: { room: RoomDetail }) {
  const sorted = [...room.players].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const winner = sorted[0];
  const podium = sorted.slice(1, 3);
  const rest = sorted.slice(3);

  const corners = [
    { top: -1, left: -1, r: '0deg' },
    { top: -1, right: -1, r: '90deg' },
    { bottom: -1, right: -1, r: '180deg' },
    { bottom: -1, left: -1, r: '270deg' },
  ] as const;

  return (
    <div className="log-page">
      <div className="log-overlay" />
      <div className="log-final-inner">
        {/* Title */}
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div className="kicker" style={{ color: 'var(--ink-mute)', letterSpacing: '0.6em' }}>FINAL · GAME OVER</div>
          <div style={{ marginTop: 8, fontFamily: 'var(--font-display)', fontSize: 48, letterSpacing: '0.4em', color: 'var(--gold)', textShadow: '0 0 36px rgba(240,192,64,0.45)' }}>
            最 終 順 位
          </div>
        </div>

        {/* Main */}
        <div className="log-final-grid">
          {/* Winner column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
            {winner && (
              <div style={{ flex: 1, padding: '24px 24px 20px', background: 'radial-gradient(ellipse at 50% 0%, rgba(240,192,64,0.18), transparent 70%), var(--bg-elev)', border: '1px solid rgba(240,192,64,0.5)', position: 'relative' }}>
                {corners.map((c, i) => (
                  <span key={i} style={{
                    position: 'absolute', width: 20, height: 20,
                    borderTop: '2px solid var(--gold)', borderLeft: '2px solid var(--gold)',
                    transform: `rotate(${c.r})`,
                    top: 'top' in c ? c.top : undefined,
                    bottom: 'bottom' in c ? c.bottom : undefined,
                    left: 'left' in c ? c.left : undefined,
                    right: 'right' in c ? c.right : undefined,
                  }} />
                ))}
                <div className="kicker" style={{ color: 'var(--gold)' }}>CHAMPION · 1ST</div>
                <div style={{ marginTop: 14, fontFamily: 'var(--font-display)', fontSize: 52, lineHeight: 1.05, color: 'var(--ink)', letterSpacing: '0.08em' }}>
                  {winner.name}
                </div>
                {winner.id === room.gmPlayerId && (
                  <div style={{ marginTop: 6 }}><span className="tag gold">GM</span></div>
                )}
                <div style={{ marginTop: 24, fontFamily: 'var(--font-display)', fontSize: 72, color: 'var(--gold)', lineHeight: 1, fontVariantNumeric: 'tabular-nums', textShadow: '0 0 30px rgba(240,192,64,0.4)' }}>
                  {fmt(winner.money)}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--gold-deep)', letterSpacing: '0.4em' }}>FINAL ASSETS</div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {podium.map((p) => (
                <div key={p.id} style={{ padding: '14px 14px', background: 'var(--bg-elev)', border: '1px solid var(--line)' }}>
                  <div className="kicker" style={{ color: 'var(--cobalt)' }}>{p.rank === 2 ? 'RUNNER-UP · 2ND' : 'THIRD · 3RD'}</div>
                  <div style={{ marginTop: 6, fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink)' }}>{p.name}</div>
                  <div style={{ marginTop: 4, fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--gold)', fontVariantNumeric: 'tabular-nums' }}>{fmt(p.money)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Full standings */}
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
              <div className="kicker" style={{ color: 'var(--ink-mute)' }}>ALL STANDINGS · 全プレイヤー</div>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {sorted.map((p, i) => (
                <div key={p.id} style={{
                  display: 'grid', gridTemplateColumns: '52px 1fr auto auto',
                  gap: 12, padding: '12px 20px', alignItems: 'center',
                  borderBottom: i === sorted.length - 1 ? 'none' : '1px solid var(--line)',
                  opacity: p.alive ? 1 : 0.4,
                  background: p.rank === 1 ? 'rgba(240,192,64,0.05)' : undefined,
                }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: p.rank === 1 ? 'var(--gold)' : (p.rank && p.rank <= 3 ? 'var(--cobalt)' : 'var(--ink-mute)') }}>
                    {String(p.rank ?? i + 1).padStart(2, '0')}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, textDecoration: p.alive ? 'none' : 'line-through', color: p.alive ? 'var(--ink)' : 'var(--ink-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {p.name}
                    {p.id === room.gmPlayerId && <span className="tag gold" style={{ fontSize: 9 }}>GM</span>}
                  </span>
                  {p.alive ? (
                    <span style={{ fontSize: 10, letterSpacing: '0.2em', color: p.rank === 1 ? 'var(--gold)' : 'var(--green)', border: `1px solid ${p.rank === 1 ? 'var(--gold)' : 'rgba(74,222,128,0.4)'}`, padding: '2px 6px', background: p.rank === 1 ? 'rgba(240,192,64,0.08)' : undefined }}>
                      {p.rank === 1 ? 'WIN' : 'SURVIVED'}
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--red)', border: '1px solid rgba(244,67,54,0.5)', padding: '2px 6px' }}>
                      破産
                    </span>
                  )}
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, minWidth: 90, textAlign: 'right', color: p.money === 0 ? 'var(--red)' : 'var(--gold)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(p.money)}
                  </span>
                </div>
              ))}
              {rest.length > 0 && (
                <div style={{ padding: '8px 20px', fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.2em' }}>
                  …他 {rest.length} 名（破産）
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 20px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--ink-mute)', letterSpacing: '0.2em' }}>
            ROOM {room.id.slice(0, 16)} · 残存 {room.players.filter((p) => p.alive).length} 名
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.4em', color: 'var(--gold)' }}>
            少数派 ・ デスストーリー
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- History row ----
function HistoryRow({ history }: { history: (TurnResultView | YesNoResultView | null)[] }) {
  const items = history.filter(Boolean) as (TurnResultView | YesNoResultView)[];
  if (items.length === 0) return null;

  return (
    <div className="log-history">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
        <span className="kicker" style={{ color: 'var(--ink-mute)', flexShrink: 0 }}>HISTORY</span>
        {items.slice(-4).map((h, i, arr) => (
          <div key={h.turnNumber} style={{ display: 'flex', alignItems: 'baseline', gap: 8, opacity: i === arr.length - 1 ? 1 : 0.6, paddingLeft: i ? 12 : 0, borderLeft: i ? '1px solid var(--line)' : 'none', flex: 1 }}>
            <span style={{ fontFamily: 'var(--font-display)', color: i === arr.length - 1 ? 'var(--cobalt)' : 'var(--ink-mute)', fontSize: 13, letterSpacing: '0.1em' }}>
              T{String(h.turnNumber).padStart(2, '0')}
            </span>
            <span style={{ fontSize: 10, letterSpacing: '0.2em', padding: '1px 6px', background: 'rgba(240,192,64,0.12)', color: 'var(--gold)', border: '1px solid rgba(240,192,64,0.3)', fontFamily: 'var(--font-display)', flexShrink: 0 }}>
              {h.mode === 'yesno'
                ? `EVENT · ${h.minoritySide?.toUpperCase() ?? '?'}`
                : `少数派`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Main ----
export default function LogPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [currentTurn, setCurrentTurn] = useState<TurnView | null>(null);
  const [recentHistory, setRecentHistory] = useState<(TurnResultView | YesNoResultView | null)[]>([]);
  const [error, setError] = useState('');

  const fetchState = useCallback(async () => {
    if (!roomId) return;
    try {
      const data = await api.logState(roomId);
      setRoom(data.room);
      setCurrentTurn(data.currentTurn);
      setRecentHistory(data.recentHistory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    }
  }, [roomId]);

  useEffect(() => {
    const t = setTimeout(() => { void fetchState(); }, 0);
    return () => clearTimeout(t);
  }, [fetchState]);

  useEffect(() => {
    if (!roomId) return;
    const disconnect = connectRoomWs(roomId, (event: WsEvent) => {
      if (['turn.started', 'turn.resolved', 'yesno.started', 'yesno.resolved', 'room.finished'].includes(event.type)) {
        void fetchState();
      }
      if (event.type === 'room.reset') {
        navigate(`/room/${roomId}/waiting`);
      }
    });
    return disconnect;
  }, [roomId, fetchState, navigate]);

  if (error) return (
    <div className="log-page" style={{ padding: 32 }}>
      <div className="log-overlay" />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div className="brand">MINORITY<span className="dot" />MONEY</div>
        <p className="error-msg">{error}</p>
      </div>
    </div>
  );

  if (!room) return (
    <div className="log-page" style={{ padding: 32 }}>
      <div className="log-overlay" />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div className="brand">MINORITY<span className="dot" />MONEY</div>
        <p className="kicker" style={{ marginTop: 16 }}>読み込み中…</p>
      </div>
    </div>
  );

  if (room.status === 'finished') {
    return <LogFinal room={room} />;
  }

  if (!currentTurn) {
    return (
      <div className="log-page">
        <div className="log-overlay" />
        <div className="log-inner">
          <div className="log-header">
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.36em', color: 'var(--cobalt)' }}>
              少数派<span style={{ display: 'inline-block', width: 6, height: 6, background: 'var(--red)', borderRadius: '50%', margin: '0 8px 2px', verticalAlign: 'middle', boxShadow: '0 0 10px var(--red)' }} />デスストーリー
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <div className="kicker">ROOM {room.id}</div>
            <div style={{ marginTop: 16, fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--ink-mute)', letterSpacing: '0.3em' }}>
              GMがターンを開始するまでお待ちください
            </div>
          </div>
        </div>
      </div>
    );
  }

  const revealed = currentTurn.phase === 'resolved';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <LogInGame room={room} turn={currentTurn} revealed={revealed} />
      </div>
      <HistoryRow history={recentHistory} />
    </div>
  );
}
