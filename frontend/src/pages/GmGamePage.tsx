import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  api,
  type ChoiceInput,
  type GeneratedTurn,
  type RoomDetail,
  type TurnView,
  type TurnResultView,
  type YesNoResultView,
  type PlayerView,
  type StoryTurnView,
} from '../lib/api';
import { loadSession } from '../lib/session';
import { connectRoomWs, type WsEvent } from '../lib/ws';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function fmt(n: number) {
  return '¥' + n.toLocaleString('ja-JP');
}

function MoneyPanel({ money, delta, isYes = false }: { money: number; delta?: number; isYes?: boolean }) {
  return (
    <div className={`money-panel${isYes ? ' yes-theme' : ''}`}>
      <div>
        <div className="kicker" style={{ color: isYes ? '#1a1a2e' : 'rgba(240,192,64,0.7)' }}>所持金</div>
        <div className={`money-amount${isYes ? ' yes-theme' : ''}`}>{fmt(money)}</div>
      </div>
      {delta !== undefined && (
        <div className="money-delta" style={{ color: delta >= 0 ? (isYes ? '#0a5d2a' : 'var(--green)') : 'var(--red)' }}>
          {delta >= 0 ? '+' : ''}{delta.toLocaleString('ja-JP')}
          <div style={{ fontSize: 9, letterSpacing: '0.3em', color: isYes ? 'rgba(26,26,46,0.6)' : 'var(--ink-mute)', marginTop: 2 }}>LAST TURN</div>
        </div>
      )}
    </div>
  );
}

function buildDefaultChoices(turnNumber: number): ChoiceInput[] {
  return [
    {
      id: `safe-${turnNumber}`,
      text: '堅実にバイトして稼ぐ',
      riskLevel: 'low',
      mainEffect: { type: 'gain', amount: 80000, description: '安定収入' },
      minorityBonus: { type: 'gain', amount: 50000, description: '少数派ボーナス' },
    },
    {
      id: `mid-${turnNumber}`,
      text: '友人の副業に乗ってみる',
      riskLevel: 'medium',
      mainEffect: { type: 'gain', amount: 120000, description: '中リターン' },
      minorityBonus: { type: 'gain', amount: 90000, description: '少数派ボーナス' },
    },
    {
      id: `high-${turnNumber}`,
      text: '一発逆転の怪しい投資に突撃',
      riskLevel: 'high',
      mainEffect: { type: 'lose', amount: 70000, description: '高リスク' },
      minorityBonus: { type: 'gain', amount: 220000, description: '少数派大当たり' },
    },
  ];
}

function buildChoicesFromPreview(preview: GeneratedTurn, turnNumber: number): ChoiceInput[] {
  const defaults = buildDefaultChoices(turnNumber);
  return preview.choices.map((c, i) => ({
    ...defaults[i]!,
    id: c.id,
    text: c.text,
    ...(c.resultStory ? { resultStory: c.resultStory } : {}),
  }));
}

// ---- Player screen components ----

function VotingScreen({ turn, me, selected, onSelect, onConfirm, submitting, pb = 0 }: {
  turn: TurnView; me: PlayerView;
  selected: string | null;
  onSelect: (id: string) => void;
  onConfirm: () => void;
  submitting: boolean;
  pb?: number;
}) {
  const choices = turn.choices ?? [];
  return (
    <div className="page-content" style={pb ? { paddingBottom: pb } : undefined}>
      <MoneyPanel money={me.money} />
      <div className="timer-row">
        <div className="kicker">残り時間</div>
        <div className="timer-track"><div className="timer-fill" style={{ width: '60%' }} /></div>
        <div className="num" style={{ fontFamily: 'var(--font-display)', color: 'var(--red)', fontSize: 16, letterSpacing: '0.05em' }}>—</div>
      </div>
      {turn.story && (
        <div className="story-card">
          <div className="kicker" style={{ color: 'var(--cobalt)' }}>STORY · AI</div>
          <div className="story-text">{turn.story}</div>
        </div>
      )}
      <div className="choices-list">
        {choices.map((c, idx) => {
          const isSel = c.id === selected;
          return (
            <button key={c.id} className={`choice-card${isSel ? ' selected' : ''}`} onClick={() => onSelect(c.id)} disabled={submitting}>
              <div className="choice-letter">{LETTERS[idx] ?? String(idx + 1)}</div>
              <div>
                <div className="choice-label">{c.text}</div>
              </div>
            </button>
          );
        })}
      </div>
      <button className="btn primary" style={{ marginTop: 10, flexShrink: 0 }} onClick={onConfirm} disabled={!selected || submitting}>
        投票を確定する →
      </button>
    </div>
  );
}

function WaitingScreen({ turn, me, allPlayers, pb = 0 }: { turn: TurnView; me: PlayerView; allPlayers: PlayerView[]; pb?: number }) {
  const choices = turn.choices ?? [];
  const myChoice = choices.find((c) => c.id === turn.mySelection);
  const myIdx = myChoice ? choices.indexOf(myChoice) : -1;
  const myLetter = myIdx >= 0 ? (LETTERS[myIdx] ?? '?') : '?';
  const unsubmitted = (turn.unsubmittedPlayerIds as string[] | undefined) ?? [];
  return (
    <div className="page-content" style={pb ? { paddingBottom: pb } : undefined}>
      <MoneyPanel money={me.money} />
      <div className="waiting-card">
        <div className="kicker" style={{ color: 'var(--cobalt)' }}>あなたの選択</div>
        <div style={{ marginTop: 10, fontFamily: 'var(--font-display)', fontSize: 36, color: 'var(--cobalt)', letterSpacing: '0.2em' }}>{myLetter}</div>
        {myChoice && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-mute)' }}>{myChoice.text}</div>}
      </div>
      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ink)', letterSpacing: '0.3em' }}>他プレイヤーの投票を待っています</div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.4em' }}>WAITING …</div>
      </div>
      {allPlayers.length > 0 && (
        <div style={{ marginTop: 16, flex: 1 }}>
          <div className="kicker">投票状況</div>
          <div className="player-vote-grid">
            {allPlayers.filter((p) => p.alive && p.id !== me.id).map((p) => {
              const voted = !unsubmitted.includes(p.id);
              return (
                <div key={p.id} className="player-vote-item" style={{ opacity: voted ? 1 : 0.55 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: voted ? 'var(--green)' : 'var(--ink-faint)', boxShadow: voted ? '0 0 6px var(--green)' : 'none', flexShrink: 0 }} />
                  <span style={{ fontSize: 11.5, flex: 1 }}>{p.name}</span>
                  <span style={{ fontSize: 9, letterSpacing: '0.2em', color: voted ? 'var(--green)' : 'var(--ink-faint)' }}>{voted ? 'DONE' : '...'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultScreen({ turn, result, me, pb = 0 }: { turn: TurnView; result: TurnResultView | YesNoResultView; me: PlayerView; pb?: number }) {
  const myEffect = result.applied.find((a) => a.playerId === me.id);
  const isWin = myEffect?.wasMinority ?? false;
  const choices = turn.choices ?? [];

  type DistItem = { letter: string; count: number; pct: number; mine: boolean };
  let distData: DistItem[] = [];
  if (result.mode === 'normal') {
    const r = result as TurnResultView;
    const total = choices.reduce((s, c) => s + (r.counts[c.id] ?? 0), 0);
    distData = choices.map((c, idx) => ({
      letter: LETTERS[idx] ?? String(idx + 1),
      count: r.counts[c.id] ?? 0,
      pct: total > 0 ? ((r.counts[c.id] ?? 0) / total) * 100 : 0,
      mine: c.id === turn.mySelection,
    }));
  }

  return (
    <div className="page-content" style={pb ? { paddingBottom: pb } : undefined}>
      <MoneyPanel money={myEffect?.moneyAfter ?? me.money} delta={myEffect?.totalDelta} />
      <div className={`result-panel ${isWin ? 'win' : 'lose'}`}>
        <div className="kicker" style={{ color: isWin ? 'var(--gold)' : 'var(--red)' }}>結 果</div>
        <div className="result-headline" style={{ color: isWin ? 'var(--gold)' : 'var(--red)', textShadow: isWin ? '0 0 28px rgba(240,192,64,0.5)' : '0 0 24px rgba(244,67,54,0.4)' }}>
          {isWin ? '少数派' : '多数派'}
        </div>
        <div className="result-subline" style={{ color: isWin ? 'var(--gold-deep)' : 'rgba(244,67,54,0.85)' }}>
          {isWin ? 'MINORITY · BONUS' : 'MAJORITY · PENALTY'}
        </div>
        {myEffect && (
          <div className="result-amount" style={{ color: isWin ? 'var(--gold)' : 'var(--red)' }}>
            {myEffect.totalDelta >= 0 ? '+' : '−'}¥{Math.abs(myEffect.totalDelta).toLocaleString('ja-JP')}
          </div>
        )}
      </div>
      {(() => {
        const myChoice = choices.find((c) => c.id === turn.mySelection);
        const story = myChoice?.resultStory
          ? (isWin ? myChoice.resultStory.minority : myChoice.resultStory.majority)
          : (!isWin ? '群れに紛れた者に、勝者の席は無い。' : null);
        if (!story) return null;
        return (
          <div style={{ marginTop: 10, padding: '10px 12px', background: isWin ? 'rgba(240,192,64,0.06)' : 'rgba(244,67,54,0.06)', border: `1px dashed ${isWin ? 'rgba(240,192,64,0.4)' : 'rgba(244,67,54,0.4)'}`, borderRadius: 4, fontSize: 11.5, color: isWin ? 'rgba(240,210,120,0.9)' : 'rgba(255,200,200,0.9)', letterSpacing: '0.05em', fontFamily: 'var(--font-display)', lineHeight: 1.7, textAlign: 'center' }}>
            {story}
          </div>
        );
      })()}
      {distData.length > 0 && (
        <div className="dist-card">
          <div className="kicker">投票分布</div>
          {distData.map((d) => (
            <div key={d.letter} className="dist-row">
              <span style={{ width: 18, fontFamily: 'var(--font-display)', color: d.mine ? 'var(--gold)' : 'var(--ink-mute)', fontSize: 14 }}>{d.letter}</span>
              <div className="dist-track"><div className="dist-fill" style={{ width: `${d.pct}%`, background: d.mine ? 'var(--gold)' : 'var(--cobalt-deep)' }} /></div>
              <span className="num" style={{ width: 24, textAlign: 'right', fontFamily: 'var(--font-display)', color: d.mine ? 'var(--gold)' : 'var(--ink-mute)' }}>{d.count}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1 }} />
    </div>
  );
}

function BankruptScreen({ me }: { me: PlayerView }) {
  return (
    <div className="bankrupt-inner">
      <div className="bankrupt-box">
        <div className="kicker" style={{ color: 'var(--red)' }}>STATUS</div>
        <div style={{ marginTop: 14, fontFamily: 'var(--font-display)', fontSize: 60, letterSpacing: '0.3em', color: 'var(--red)', textShadow: '0 0 30px rgba(244,67,54,0.5)', lineHeight: 1 }}>破 産</div>
        <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,180,180,0.8)', letterSpacing: '0.4em' }}>BANKRUPT · ELIMINATED</div>
      </div>
      <div className="bankrupt-stats">
        <div className="stat-card">
          <div className="kicker">プレイヤー</div>
          <div className="num" style={{ marginTop: 4, fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ink)' }}>{me.name}</div>
        </div>
      </div>
      <div style={{ flex: 1 }} />
    </div>
  );
}

function YesNoScreen({ turn, me, onVote, submitting, pb = 0 }: {
  turn: TurnView; me: PlayerView;
  onVote: (v: 'yes' | 'no') => void;
  submitting: boolean;
  pb?: number;
}) {
  const [selected, setSelected] = useState<'yes' | 'no' | null>(null);

  if (turn.mySelection) {
    return (
      <div className="page-content" style={pb ? { paddingBottom: pb } : undefined}>
        <MoneyPanel money={me.money} isYes />
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: '#1a1a2e', letterSpacing: '0.2em' }}>{turn.mySelection.toUpperCase()}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(26,26,46,0.6)', letterSpacing: '0.4em' }}>選択済 · 結果をお待ちください</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content" style={pb ? { paddingBottom: pb } : undefined}>
      <MoneyPanel money={me.money} isYes />
      <div style={{ marginTop: 16, padding: '16px 14px', background: 'rgba(26,26,46,0.92)', border: '2px solid #1a1a2e', borderRadius: 4, position: 'relative', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: -10, left: 12, background: '#f0c040', padding: '2px 10px', fontSize: 10, letterSpacing: '0.4em', fontWeight: 700, color: '#1a1a2e', border: '1px solid #1a1a2e' }}>特殊イベント発動</div>
        <div className="kicker" style={{ color: '#f0c040' }}>STORY · AI</div>
        <div style={{ marginTop: 8, fontFamily: 'var(--font-display)', fontSize: 15, color: '#f0c040', lineHeight: 1.65 }}>{turn.story || '迷ったらYESイベント発動！'}</div>
      </div>
      <div className="yesno-grid">
        {(['yes', 'no'] as const).map((v) => {
          const isSel = selected === v;
          return (
            <button
              key={v}
              className="yesno-card"
              style={{ background: isSel ? '#1a1a2e' : 'rgba(26,26,46,0.15)', border: isSel ? '2px solid #1a1a2e' : '2px solid rgba(26,26,46,0.5)', color: isSel ? '#f0c040' : '#1a1a2e' }}
              onClick={() => setSelected(v)}
              disabled={submitting}
            >
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 44, letterSpacing: '0.1em', lineHeight: 1, fontWeight: 700 }}>{v.toUpperCase()}</div>
                <div style={{ marginTop: 8, fontSize: 11.5, fontFamily: 'var(--font-display)', opacity: 0.8 }}>{v === 'yes' ? '迷ったらYES。' : '見送る。'}</div>
              </div>
            </button>
          );
        })}
      </div>
      <button
        style={{ all: 'unset', cursor: selected ? 'pointer' : 'default', marginTop: 12, padding: '12px 16px', background: '#1a1a2e', color: '#f0c040', textAlign: 'center', fontWeight: 700, letterSpacing: '0.2em', fontSize: 13, border: '2px solid #1a1a2e', flexShrink: 0, opacity: selected && !submitting ? 1 : 0.45 }}
        onClick={() => { if (selected && !submitting) onVote(selected); }}
      >
        {selected ? `${selected.toUpperCase()} を確定する →` : '選択してください'}
      </button>
    </div>
  );
}

// ---- Story screens (GM, with pb support) ----

function StoryFirstScreen({ turn, me, storyTurn, onSelect, submitting, pb = 0 }: {
  turn: TurnView; me: PlayerView; storyTurn: StoryTurnView;
  onSelect: (choiceId: string) => void; submitting: boolean; pb?: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const choices = storyTurn.choices ?? [];

  if (storyTurn.mySelection) {
    return (
      <div className="page-content" style={pb ? { paddingBottom: pb } : undefined}>
        <MoneyPanel money={me.money} />
        <div className="waiting-card">
          <div className="kicker" style={{ color: 'var(--gold)' }}>あなたの選択</div>
          <div style={{ marginTop: 10, fontSize: 14, color: 'var(--ink)', lineHeight: 1.65 }}>
            {choices.find((c) => c.id === storyTurn.mySelection)?.text ?? storyTurn.mySelection}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.4em' }}>
            GMが次のフェーズへ進むまでお待ちください
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content" style={pb ? { paddingBottom: pb } : undefined}>
      <MoneyPanel money={me.money} />
      {turn.story && (
        <div className="story-card">
          <div className="kicker" style={{ color: 'var(--gold)' }}>STORY</div>
          <div className="story-text">{turn.story}</div>
        </div>
      )}
      <div className="story-card" style={{ marginTop: 12, background: 'rgba(240,192,64,0.08)', border: '1px solid rgba(240,192,64,0.35)', flexShrink: 0 }}>
        <div className="kicker" style={{ color: 'var(--gold)' }}>1位の選択</div>
        <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.65 }}>{storyTurn.question}</div>
      </div>
      <div className="choices-list">
        {choices.map((c) => (
          <button
            key={c.id}
            className={`choice-card${selected === c.id ? ' selected' : ''}`}
            onClick={() => setSelected(c.id)}
            disabled={submitting}
          >
            <div style={{ flex: 1 }}><div className="choice-label">{c.text}</div></div>
          </button>
        ))}
      </div>
      <button
        className="btn primary"
        style={{ marginTop: 10, flexShrink: 0 }}
        onClick={() => { if (selected) onSelect(selected); }}
        disabled={!selected || submitting}
      >
        選択を確定する →
      </button>
    </div>
  );
}

function StoryWaitingScreen({ turn, me, message, pb = 0 }: { turn: TurnView; me: PlayerView; message: string; pb?: number }) {
  return (
    <div className="page-content" style={pb ? { paddingBottom: pb } : undefined}>
      <MoneyPanel money={me.money} />
      {turn.story && (
        <div className="story-card">
          <div className="kicker" style={{ color: 'var(--gold)' }}>STORY</div>
          <div className="story-text">{turn.story}</div>
        </div>
      )}
      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--ink)', letterSpacing: '0.2em' }}>{message}</div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.4em' }}>WAITING …</div>
      </div>
    </div>
  );
}

function StoryOthersScreen({ turn, me, storyTurn, onSelect, submitting, pb = 0 }: {
  turn: TurnView; me: PlayerView; storyTurn: StoryTurnView;
  onSelect: (choiceId: string) => void; submitting: boolean; pb?: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const choices = storyTurn.choices ?? [];

  if (storyTurn.mySelection) {
    return (
      <div className="page-content" style={pb ? { paddingBottom: pb } : undefined}>
        <MoneyPanel money={me.money} />
        <div className="waiting-card">
          <div className="kicker" style={{ color: 'var(--cobalt)' }}>あなたの選択</div>
          <div style={{ marginTop: 10, fontSize: 14, color: 'var(--ink)', lineHeight: 1.65 }}>
            {choices.find((c) => c.id === storyTurn.mySelection)?.text ?? storyTurn.mySelection}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.4em' }}>
            GMが結果を確定するまでお待ちください
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content" style={pb ? { paddingBottom: pb } : undefined}>
      <MoneyPanel money={me.money} />
      {turn.story && (
        <div className="story-card">
          <div className="kicker" style={{ color: 'var(--gold)' }}>STORY</div>
          <div className="story-text">{turn.story}</div>
        </div>
      )}
      <div className="story-card" style={{ marginTop: 12, background: 'rgba(100,140,220,0.08)', border: '1px solid rgba(100,140,220,0.35)', flexShrink: 0 }}>
        <div className="kicker" style={{ color: 'var(--cobalt)' }}>あなたの選択</div>
        <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.65 }}>{storyTurn.question}</div>
      </div>
      <div className="choices-list">
        {choices.map((c) => (
          <button
            key={c.id}
            className={`choice-card${selected === c.id ? ' selected' : ''}`}
            onClick={() => setSelected(c.id)}
            disabled={submitting}
          >
            <div style={{ flex: 1 }}>
              <div className="choice-label">{c.text}</div>
              {c.moneyEffect && (
                <div className="choice-effects">
                  <span className="choice-tag" style={{ color: c.moneyEffect.type === 'gain' ? 'var(--green)' : 'var(--red)' }}>
                    {c.moneyEffect.type === 'gain' ? '+' : '−'}¥{(c.moneyEffect.amount ?? 0).toLocaleString('ja-JP')}
                  </span>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
      <button
        className="btn primary"
        style={{ marginTop: 10, flexShrink: 0 }}
        onClick={() => { if (selected) onSelect(selected); }}
        disabled={!selected || submitting}
      >
        選択を確定する →
      </button>
    </div>
  );
}

function StoryResolvedScreen({ me, storyTurn, pb = 0 }: { me: PlayerView; storyTurn: StoryTurnView; pb?: number }) {
  const result = storyTurn.storyResult;
  const myEffect = result?.applied.find((a) => a.playerId === me.id);

  return (
    <div className="page-content" style={pb ? { paddingBottom: pb } : undefined}>
      <MoneyPanel money={myEffect?.moneyAfter ?? me.money} delta={myEffect?.totalDelta} />
      <div className="result-panel" style={{ borderColor: 'rgba(240,192,64,0.4)' }}>
        <div className="kicker" style={{ color: 'var(--gold)' }}>ストーリー結果</div>
        {myEffect && (
          <div className="result-amount" style={{ color: myEffect.totalDelta >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {myEffect.totalDelta >= 0 ? '+' : '−'}¥{Math.abs(myEffect.totalDelta).toLocaleString('ja-JP')}
          </div>
        )}
        {!myEffect && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-mute)' }}>影響なし</div>}
        {myEffect?.bankrupt && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)', letterSpacing: '0.2em' }}>BANKRUPT</div>
        )}
      </div>
      <div style={{ flex: 1 }} />
    </div>
  );
}

// ---- GM Panel (fixed bottom) ----

function GmPanel({
  room,
  turn,
  working,
  onAct,
  navigate,
  roomId,
  preview,
  generating,
  onGenerate,
  onStartWithPreview,
  onStartStoryTurn,
}: {
  room: RoomDetail;
  turn: TurnView | null;
  working: boolean;
  onAct: (fn: () => Promise<unknown>) => void;
  navigate: (path: string) => void;
  roomId: string;
  preview: GeneratedTurn | null;
  generating: boolean;
  onGenerate: () => void;
  onStartWithPreview: () => void;
  onStartStoryTurn: () => void;
}) {
  const phase = turn?.phase;
  const mode = turn?.mode;
  const alivePlayers = room.players.filter((p) => p.alive);
  const unsubmitted = (turn?.unsubmittedPlayerIds as string[] | undefined) ?? [];
  const votedCount = alivePlayers.length - unsubmitted.length;

  return (
    <div className="gm-panel">
      <div className="gm-panel-inner">
        {/* header row */}
        <div className="gm-panel-meta">
          <span>
            <span style={{ color: 'var(--gold)', fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.3em' }}>GM</span>
            {turn && (
              <> · T<span style={{ fontFamily: 'var(--font-display)', color: 'var(--cobalt)' }}>{String(turn.turnNumber).padStart(2, '0')}</span>/{room.maxTurns}</>
            )}
            {room.finalizationMode && <> · <span style={{ color: 'var(--red)' }}>決着</span></>}
          </span>
          {phase === 'selecting' && (
            <span>
              投票 <span style={{ fontFamily: 'var(--font-display)', color: 'var(--cobalt)' }}>{votedCount}/{alivePlayers.length}</span>
              {unsubmitted.length > 0 && (
                <span style={{ marginLeft: 8, color: 'var(--red)', fontSize: 9 }}>
                  未: {unsubmitted.map((id) => room.players.find((p) => p.id === id)?.name ?? '?').join(' · ')}
                </span>
              )}
            </span>
          )}
        </div>

        {/* primary action */}
        <div className="gm-panel-actions">
          {(!turn || phase === 'resolved') && room.status !== 'finished' && !preview && (
            <>
              <button
                className="btn primary"
                style={{ fontSize: 12, padding: '10px 8px' }}
                disabled={working || generating}
                onClick={onGenerate}
              >
                {generating ? 'AI生成中...' : 'AI問題生成'}
              </button>
              <button
                className="btn"
                style={{ fontSize: 12, padding: '10px 8px' }}
                disabled={working}
                onClick={onStartStoryTurn}
              >
                ストーリー
              </button>
            </>
          )}
          {(!turn || phase === 'resolved') && room.status !== 'finished' && preview && (
            <>
              <div style={{ gridColumn: '1 / -1', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, fontSize: 12, lineHeight: 1.6, color: 'var(--ink)' }}>
                <div style={{ fontSize: 10, color: 'var(--gold)', letterSpacing: '0.3em', marginBottom: 6 }}>STORY · AI</div>
                <div style={{ marginBottom: 8 }}>{preview.story}</div>
                {preview.choices.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                    <span style={{ fontFamily: 'var(--font-display)', color: 'var(--cobalt)', width: 14, flexShrink: 0 }}>{LETTERS[i]}</span>
                    <span style={{ color: 'var(--ink-mute)' }}>{c.text}</span>
                  </div>
                ))}
              </div>
              <button
                className="btn primary"
                style={{ fontSize: 11, padding: '9px 4px' }}
                disabled={working}
                onClick={onStartWithPreview}
              >
                このターンを開始 →
              </button>
              <button
                className="btn"
                style={{ fontSize: 11, padding: '9px 4px' }}
                disabled={working || generating}
                onClick={onGenerate}
              >
                再生成
              </button>
            </>
          )}
          {phase === 'selecting' && mode === 'normal' && (
            <button
              className="btn primary"
              style={{ gridColumn: '1 / -1', fontSize: 12, padding: '10px 8px' }}
              disabled={working}
              onClick={() => onAct(() => api.resolveTurn(room.id, room.gmPlayerId))}
            >
              結果確定 / 公開
            </button>
          )}
          {phase === 'selecting' && mode === 'yesno' && (
            <button
              className="btn primary"
              style={{ gridColumn: '1 / -1', fontSize: 12, padding: '10px 8px' }}
              disabled={working}
              onClick={() => onAct(() => api.resolveYesNo(room.id, room.gmPlayerId))}
            >
              結果確定 / 公開
            </button>
          )}
          {phase === 'first_selecting' && mode === 'story' && (
            <>
              <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--ink-mute)', padding: '4px 0', letterSpacing: '0.05em' }}>
                1位: <span style={{ color: 'var(--gold)' }}>{turn?.storyGm?.firstPlayerName ?? '?'}</span>
                {' · '}{turn?.storyGm?.firstSelectionSubmitted ? '選択済' : '選択待ち'}
              </div>
              <button
                className="btn primary"
                style={{ gridColumn: '1 / -1', fontSize: 12, padding: '10px 8px' }}
                disabled={working || !turn?.storyGm?.firstSelectionSubmitted}
                onClick={() => onAct(() => api.advanceToOthers(room.id, room.gmPlayerId))}
              >
                次のフェーズへ進む →
              </button>
            </>
          )}
          {phase === 'others_selecting' && mode === 'story' && (
            <>
              <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--ink-mute)', padding: '4px 0', letterSpacing: '0.05em' }}>
                選択: <span style={{ fontFamily: 'var(--font-display)', color: 'var(--cobalt)' }}>{turn?.storyGm?.othersSubmittedCount}/{turn?.storyGm?.othersAliveCount}</span>人
              </div>
              <button
                className="btn primary"
                style={{ gridColumn: '1 / -1', fontSize: 12, padding: '10px 8px' }}
                disabled={working}
                onClick={() => onAct(() => api.resolveStoryTurn(room.id, room.gmPlayerId))}
              >
                結果確定 / 公開
              </button>
            </>
          )}
        </div>

        {/* secondary actions */}
        <div className="gm-panel-secondary">
          <button
            className="btn green-out"
            style={{ fontSize: 11, padding: '8px 4px' }}
            disabled={working}
            onClick={() => onAct(() => api.triggerYesNo(room.id, room.gmPlayerId, '迷ったらYES'))}
          >
            YESイベント
          </button>
          <button
            className="btn danger"
            style={{ fontSize: 11, padding: '8px 4px' }}
            onClick={() => navigate(`/room/${roomId}/log`)}
          >
            ログ画面
          </button>
          <button
            className="btn gold"
            style={{ fontSize: 11, padding: '8px 4px' }}
            disabled={working}
            onClick={() => onAct(() => api.setFinalization(room.id, room.gmPlayerId, !room.finalizationMode))}
          >
            決着 {room.finalizationMode ? 'OFF' : 'ON'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Main ----

export default function GmGamePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const session = useMemo(() => loadSession(), []);

  const [me, setMe] = useState<PlayerView | null>(null);
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [currentTurn, setCurrentTurn] = useState<TurnView | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [working, setWorking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<GeneratedTurn | null>(null);
  const [generating, setGenerating] = useState(false);

  const fetchState = useCallback(async () => {
    if (!roomId || !session?.playerId) return;
    try {
      const [playerData, gmData] = await Promise.all([
        api.playerState(roomId, session.playerId),
        api.gmState(roomId, session.playerId),
      ]);
      setMe(playerData.me);
      setRoom(gmData.room);
      // merge: playerState has mySelection+result; gmState has counts+unsubmittedPlayerIds
      const merged: TurnView | null = playerData.currentTurn
        ? {
            ...playerData.currentTurn,
            counts: gmData.currentTurn?.counts,
            unsubmittedPlayerIds: gmData.currentTurn?.unsubmittedPlayerIds,
            storyGm: gmData.currentTurn?.storyGm,
          }
        : null;
      setCurrentTurn(merged);
      if (playerData.room.status === 'finished') navigate(`/room/${roomId}/log`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    }
  }, [roomId, session?.playerId, navigate]);

  useEffect(() => {
    const t = setTimeout(() => { void fetchState(); }, 0);
    return () => clearTimeout(t);
  }, [fetchState]);

  useEffect(() => {
    if (!roomId) return;
    const disconnect = connectRoomWs(roomId, (event: WsEvent) => {
      if ([
        'turn.vote.submitted', 'yesno.vote.submitted', 'turn.started',
        'turn.resolved', 'yesno.started', 'yesno.resolved',
        'room.finalization.updated', 'room.finished',
        'story.started', 'story.first.submitted', 'story.others.started', 'story.others.submitted', 'story.turn.resolved',
      ].includes(event.type)) {
        setSelected(null);
        void fetchState();
      }
    });
    return disconnect;
  }, [roomId, fetchState]);

  async function act(fn: () => Promise<unknown>) {
    if (working) return;
    setWorking(true);
    try {
      await fn();
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setWorking(false);
    }
  }

  async function generateTurn() {
    if (!roomId || !session?.playerId || generating) return;
    setGenerating(true);
    try {
      const result = await api.generateTurn(roomId, session.playerId);
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI生成に失敗しました');
    } finally {
      setGenerating(false);
    }
  }

  async function startStoryTurn() {
    if (!roomId || !session?.playerId) return;
    await act(() => api.startStoryTurn(roomId, session!.playerId));
  }

  async function handleStoryFirstSelect(choiceId: string) {
    if (!roomId || !session?.playerId || submitting) return;
    setSubmitting(true);
    try {
      await api.submitFirstSelection(roomId, session.playerId, choiceId);
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStoryOthersSelect(choiceId: string) {
    if (!roomId || !session?.playerId || submitting) return;
    setSubmitting(true);
    try {
      await api.submitOthersSelection(roomId, session.playerId, choiceId);
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  }

  async function startWithPreview() {
    if (!preview || !roomId || !session?.playerId) return;
    const nextTurnNumber = (currentTurn?.turnNumber ?? 0) + 1;
    const choices = buildChoicesFromPreview(preview, nextTurnNumber);
    await act(() => api.startTurn(roomId, session!.playerId, choices, preview.story));
    setPreview(null);
  }

  async function handleSelect(choiceId: string) {
    if (!roomId || !session?.playerId || submitting) return;
    setSubmitting(true);
    try {
      await api.submitSelection(roomId, session.playerId, choiceId);
      setSelected(null);
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleYesNo(vote: 'yes' | 'no') {
    if (!roomId || !session?.playerId || submitting) return;
    setSubmitting(true);
    try {
      await api.submitYesNo(roomId, session.playerId, vote);
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  }

  // GM panel is always rendered at the bottom of the viewport
  const gmPanel = room && roomId ? (
    <GmPanel
      room={room}
      turn={currentTurn}
      working={working}
      onAct={act}
      navigate={navigate}
      roomId={roomId}
      preview={preview}
      generating={generating}
      onGenerate={() => { void generateTurn(); }}
      onStartWithPreview={() => { void startWithPreview(); }}
      onStartStoryTurn={() => { void startStoryTurn(); }}
    />
  ) : null;

  const GM_PB = 160;

  if (error) return (
    <div className="page">
      <div className="appbar" style={{ paddingTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="brand">DEATH<span className="dot" />GAME</div>
          <span className="tag gold" style={{ fontSize: 9, padding: '2px 6px' }}>GM</span>
        </div>
      </div>
      <div style={{ padding: '0 22px' }}><p className="error-msg">{error}</p></div>
      {gmPanel}
    </div>
  );

  if (!me || !room) return (
    <div className="page">
      <div className="appbar" style={{ paddingTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="brand">DEATH<span className="dot" />GAME</div>
          <span className="tag gold" style={{ fontSize: 9, padding: '2px 6px' }}>GM</span>
        </div>
      </div>
      <div style={{ padding: '0 22px' }}><span className="kicker">読み込み中…</span></div>
    </div>
  );

  const allPlayers = room.players;
  const turnLabel = currentTurn ? `TURN ${String(currentTurn.turnNumber).padStart(2, '0')}` : 'WAIT';

  const gmBar = (label: string) => (
    <div className="appbar" style={{ paddingTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="brand">DEATH<span className="dot" />GAME</div>
        <span className="tag gold" style={{ fontSize: 9, padding: '2px 6px' }}>GM</span>
      </div>
      <div className="meta">{label}</div>
    </div>
  );

  // Bankrupt
  if (!me.alive) {
    return (
      <div className="page">
        {gmBar('GAME OVER')}
        <BankruptScreen me={me} />
        {gmPanel}
      </div>
    );
  }

  // No turn yet
  if (!currentTurn) {
    return (
      <div className="page">
        {gmBar('WAITING')}
        <div className="page-content" style={{ paddingBottom: GM_PB }}>
          <MoneyPanel money={me.money} />
          <div className="hint-box" style={{ marginTop: 18 }}>ターンを開始してください</div>
        </div>
        {gmPanel}
      </div>
    );
  }

  // YES/NO event
  if (currentTurn.mode === 'yesno') {
    if (currentTurn.phase === 'resolved' && currentTurn.result) {
      return (
        <div className="page">
          {gmBar(`${turnLabel} / RESULT`)}
          <ResultScreen turn={currentTurn} result={currentTurn.result} me={me} pb={GM_PB} />
          {gmPanel}
        </div>
      );
    }
    return (
      <div className="page" style={{ background: 'radial-gradient(ellipse at 50% 20%, rgba(255,210,80,1), #e6b020 70%, #b8860b)' }}>
        <div className="appbar" style={{ paddingTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-display)', fontSize: 17, letterSpacing: '0.36em', color: '#1a1a2e' }}>
            DEATH<span style={{ display: 'inline-block', width: 6, height: 6, background: '#1a1a2e', borderRadius: '50%', margin: '0 8px 2px', verticalAlign: 'middle' }} />GAME
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 9, letterSpacing: '0.2em', background: '#1a1a2e', color: '#f0c040', padding: '2px 6px', marginLeft: 4 }}>GM</span>
          </div>
          <div className="meta" style={{ color: 'rgba(26,26,46,0.65)' }}>EVENT · {turnLabel}</div>
        </div>
        <YesNoScreen turn={currentTurn} me={me} onVote={handleYesNo} submitting={submitting} pb={GM_PB} />
        {gmPanel}
      </div>
    );
  }

  // Story mode
  if (currentTurn.mode === 'story') {
    const storyTurn = currentTurn.storyTurn;
    const storyGm = currentTurn.storyGm;

    if (currentTurn.phase === 'resolved') {
      return (
        <div className="page">
          {gmBar(`${turnLabel} / STORY · RESULT`)}
          {storyTurn && <StoryResolvedScreen me={me} storyTurn={storyTurn} pb={GM_PB} />}
          {gmPanel}
        </div>
      );
    }
    if (currentTurn.phase === 'first_selecting') {
      if (storyTurn?.isFirstPlayer) {
        return (
          <div className="page" style={{ background: 'radial-gradient(ellipse at 50% 15%, rgba(240,192,64,0.18), transparent 70%)' }}>
            {gmBar('STORY / 1位の選択')}
            <StoryFirstScreen turn={currentTurn} me={me} storyTurn={storyTurn} onSelect={handleStoryFirstSelect} submitting={submitting} pb={GM_PB} />
            {gmPanel}
          </div>
        );
      }
      return (
        <div className="page">
          {gmBar(`${turnLabel} / STORY`)}
          <StoryWaitingScreen turn={currentTurn} me={me} message={`1位 (${storyGm?.firstPlayerName ?? '?'}) が選択中です...`} pb={GM_PB} />
          {gmPanel}
        </div>
      );
    }
    if (currentTurn.phase === 'others_selecting') {
      if (storyTurn?.isFirstPlayer) {
        return (
          <div className="page">
            {gmBar(`${turnLabel} / STORY`)}
            <StoryWaitingScreen turn={currentTurn} me={me} message="他のプレイヤーが選択中です..." pb={GM_PB} />
            {gmPanel}
          </div>
        );
      }
      return (
        <div className="page">
          {gmBar(`${turnLabel} / STORY · 選択`)}
          {storyTurn && <StoryOthersScreen turn={currentTurn} me={me} storyTurn={storyTurn} onSelect={handleStoryOthersSelect} submitting={submitting} pb={GM_PB} />}
          {gmPanel}
        </div>
      );
    }
  }

  // Normal resolved
  if (currentTurn.phase === 'resolved' && currentTurn.result) {
    return (
      <div className="page">
        {gmBar(`${turnLabel} / RESULT`)}
        <ResultScreen turn={currentTurn} result={currentTurn.result} me={me} pb={GM_PB} />
        {gmPanel}
      </div>
    );
  }

  // Voting
  if (currentTurn.phase === 'selecting' && !currentTurn.mySelection) {
    return (
      <div className="page">
        {gmBar(`${turnLabel} / VOTE`)}
        <VotingScreen
          turn={currentTurn}
          me={me}
          selected={selected}
          onSelect={setSelected}
          onConfirm={() => { if (selected) void handleSelect(selected); }}
          submitting={submitting}
          pb={GM_PB}
        />
        {gmPanel}
      </div>
    );
  }

  // Waiting after vote
  return (
    <div className="page">
      {gmBar(`${turnLabel} / WAIT`)}
      <WaitingScreen turn={currentTurn} me={me} allPlayers={allPlayers} pb={GM_PB} />
      {gmPanel}
    </div>
  );
}
