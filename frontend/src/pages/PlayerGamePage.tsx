import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type TurnView, type TurnResultView, type YesNoResultView, type PlayerView, type StoryTurnView } from '../lib/api';
import { ENDING_DATA } from '../lib/storyEndings';
import { loadSession } from '../lib/session';
import { connectRoomWs, type WsEvent } from '../lib/ws';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function fmt(n: number) {
  return '¥' + n.toLocaleString('ja-JP');
}

function AppBar({ stage, subtitle, dark = false }: { stage: string; subtitle?: string; dark?: boolean }) {
  return (
    <div className="appbar">
      {dark ? (
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, letterSpacing: '0.36em', color: '#1a1a2e' }}>
          MINORITY<span style={{ display: 'inline-block', width: 6, height: 6, background: '#1a1a2e', borderRadius: '50%', margin: '0 8px 2px', verticalAlign: 'middle' }} />MONEY
        </div>
      ) : (
        <div className="brand">MINORITY<span className="dot" />MONEY</div>
      )}
      <div className="meta" style={dark ? { color: 'rgba(26,26,46,0.65)' } : undefined}>
        {stage}{subtitle ? ` / ${subtitle}` : ''}
      </div>
    </div>
  );
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
          <div style={{ fontSize: 9, letterSpacing: '0.3em', color: isYes ? 'rgba(26,26,46,0.6)' : 'var(--ink-mute)', marginTop: 2 }}>
            LAST TURN
          </div>
        </div>
      )}
    </div>
  );
}

// ---- 1. Voting ----
function VotingScreen({
  turn, me, selected, onSelect, onConfirm, submitting,
}: {
  turn: TurnView; me: PlayerView;
  selected: string | null;
  onSelect: (id: string) => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const choices = turn.choices ?? [];

  return (
    <div className="page-content">
      <MoneyPanel money={me.money} />

      <div className="timer-row">
        <div className="kicker">残り時間</div>
        <div className="timer-track">
          <div className="timer-fill" style={{ width: '60%' }} />
        </div>
        <div className="num" style={{ fontFamily: 'var(--font-display)', color: 'var(--red)', fontSize: 16, letterSpacing: '0.05em' }}>
          —
        </div>
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
            <button
              key={c.id}
              className={`choice-card${isSel ? ' selected' : ''}`}
              onClick={() => onSelect(c.id)}
              disabled={submitting}
            >
              <div className="choice-letter">{LETTERS[idx] ?? String(idx + 1)}</div>
              <div>
                {c.text && <div className="choice-label">{c.text}</div>}
                {c.amount > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--green)', letterSpacing: '0.05em', marginTop: c.text ? 2 : 0, fontFamily: 'var(--font-display)' }}>
                    +¥{c.amount.toLocaleString('ja-JP')}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <button
        className="btn primary"
        style={{ marginTop: 10, flexShrink: 0 }}
        onClick={onConfirm}
        disabled={!selected || submitting}
      >
        投票を確定する →
      </button>
    </div>
  );
}

// ---- 2. Waiting (post-vote) ----
function WaitingScreen({ turn, me, allPlayers }: { turn: TurnView; me: PlayerView; allPlayers: PlayerView[] }) {
  const choices = turn.choices ?? [];
  const myChoice = choices.find((c) => c.id === turn.mySelection);
  const myIdx = myChoice ? choices.indexOf(myChoice) : -1;
  const myLetter = myIdx >= 0 ? (LETTERS[myIdx] ?? '?') : '?';
  const unsubmitted = (turn.unsubmittedPlayerIds as string[] | undefined) ?? [];

  return (
    <div className="page-content">
      <MoneyPanel money={me.money} />

      <div className="waiting-card">
        <div className="kicker" style={{ color: 'var(--cobalt)' }}>あなたの選択</div>
        <div style={{ marginTop: 10, fontFamily: 'var(--font-display)', fontSize: 36, color: 'var(--cobalt)', letterSpacing: '0.2em' }}>
          {myLetter}
        </div>
        {myChoice && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-mute)' }}>{myChoice.text}</div>
        )}
      </div>

      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ink)', letterSpacing: '0.3em' }}>
          他プレイヤーの投票を待っています
        </div>
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
                  <span style={{ fontSize: 9, letterSpacing: '0.2em', color: voted ? 'var(--green)' : 'var(--ink-faint)' }}>
                    {voted ? 'DONE' : '...'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- 3/4. Win/Lose result ----
function ResultScreen({ turn, result, me }: { turn: TurnView; result: TurnResultView | YesNoResultView; me: PlayerView }) {
  const myEffect = result.applied.find((a) => a.playerId === me.id);
  const isWin = myEffect?.wasMinority ?? false;
  const choices = turn.choices ?? [];
  const myChoice = choices.find((c) => c.id === turn.mySelection);
  const resultStoryText = myChoice?.resultStory
    ? (isWin ? myChoice.resultStory.minority : myChoice.resultStory.majority)
    : null;

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
    <div className="page-content">
      <MoneyPanel money={myEffect?.moneyAfter ?? me.money} delta={myEffect?.totalDelta} />

      <div className={`result-panel ${isWin ? 'win' : 'lose'}`}>
        <div className="kicker" style={{ color: isWin ? 'var(--gold)' : 'var(--red)' }}>結 果</div>
        <div
          className="result-headline"
          style={{
            color: isWin ? 'var(--gold)' : 'var(--red)',
            textShadow: isWin ? '0 0 28px rgba(240,192,64,0.5)' : '0 0 24px rgba(244,67,54,0.4)',
          }}
        >
          {isWin ? '賞金獲得' : '獲得なし'}
        </div>
        <div className="result-subline" style={{ color: isWin ? 'var(--gold-deep)' : 'rgba(244,67,54,0.85)' }}>
          {isWin ? 'MINORITY · WIN' : 'NO PAYOUT'}
        </div>
        {myEffect && (
          <div className="result-amount" style={{ color: isWin ? 'var(--gold)' : 'var(--red)' }}>
            {myEffect.totalDelta >= 0 ? '+' : '−'}¥{Math.abs(myEffect.totalDelta).toLocaleString('ja-JP')}
          </div>
        )}
      </div>

      {resultStoryText && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: isWin ? 'rgba(240,192,64,0.07)' : 'rgba(244,67,54,0.07)', border: `1px dashed ${isWin ? 'rgba(240,192,64,0.4)' : 'rgba(244,67,54,0.4)'}`, borderRadius: 4, fontSize: 12, color: isWin ? 'rgba(240,210,120,0.95)' : 'rgba(255,200,200,0.9)', lineHeight: 1.8, letterSpacing: '0.03em' }}>
          {resultStoryText}
        </div>
      )}

      {distData.length > 0 && (
        <div className="dist-card">
          <div className="kicker">投票分布</div>
          {distData.map((d) => (
            <div key={d.letter} className="dist-row">
              <span style={{ width: 18, fontFamily: 'var(--font-display)', color: d.mine ? 'var(--gold)' : 'var(--ink-mute)', fontSize: 14 }}>
                {d.letter}
              </span>
              <div className="dist-track">
                <div className="dist-fill" style={{ width: `${d.pct}%`, background: d.mine ? 'var(--gold)' : 'var(--cobalt-deep)' }} />
              </div>
              <span className="num" style={{ width: 24, textAlign: 'right', fontFamily: 'var(--font-display)', color: d.mine ? 'var(--gold)' : 'var(--ink-mute)' }}>
                {d.count}
              </span>
            </div>
          ))}
        </div>
      )}

      {myEffect?.bankrupt && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.5)', borderRadius: 4, textAlign: 'center', color: 'var(--red)', fontFamily: 'var(--font-display)', letterSpacing: '0.2em', fontSize: 13 }}>
          BANKRUPT
        </div>
      )}

      <div style={{ flex: 1 }} />
    </div>
  );
}

// ---- 5. Bankrupt ----
function BankruptScreen({ me }: { me: PlayerView }) {
  const corners = [
    { top: -1, left: -1, r: '0deg' },
    { top: -1, right: -1, r: '90deg' },
    { bottom: -1, right: -1, r: '180deg' },
    { bottom: -1, left: -1, r: '270deg' },
  ] as const;

  return (
    <div className="bankrupt-inner">
      <div className="bankrupt-box">
        {corners.map((c, i) => (
          <span
            key={i}
            style={{
              position: 'absolute', width: 14, height: 14,
              borderTop: '2px solid var(--red)', borderLeft: '2px solid var(--red)',
              transform: `rotate(${c.r})`,
              top: 'top' in c ? c.top : undefined,
              bottom: 'bottom' in c ? c.bottom : undefined,
              left: 'left' in c ? c.left : undefined,
              right: 'right' in c ? c.right : undefined,
            }}
          />
        ))}
        <div className="kicker" style={{ color: 'var(--red)' }}>STATUS</div>
        <div style={{ marginTop: 14, fontFamily: 'var(--font-display)', fontSize: 60, letterSpacing: '0.3em', color: 'var(--red)', textShadow: '0 0 30px rgba(244,67,54,0.5)', lineHeight: 1 }}>
          破 産
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,180,180,0.8)', letterSpacing: '0.4em' }}>
          BANKRUPT · ELIMINATED
        </div>
      </div>

      <div className="bankrupt-stats">
        <div className="stat-card">
          <div className="kicker">最終所持金</div>
          <div className="num" style={{ marginTop: 4, fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--red)' }}>¥0</div>
        </div>
        <div className="stat-card">
          <div className="kicker">プレイヤー</div>
          <div className="num" style={{ marginTop: 4, fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ink)' }}>{me.name}</div>
        </div>
      </div>

      <div style={{ marginTop: 18, padding: '12px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-mute)', fontFamily: 'var(--font-display)', textAlign: 'center', letterSpacing: '0.1em', lineHeight: 1.6 }}>
        所持金が尽きた者から、闇に落ちる。
      </div>

      <div style={{ flex: 1 }} />
      <button className="btn danger">観戦モードへ</button>
    </div>
  );
}

// ---- Story screens ----

function StoryFirstScreen({
  turn, me, storyTurn, onSelect, submitting,
}: {
  turn: TurnView; me: PlayerView; storyTurn: StoryTurnView;
  onSelect: (choiceId: string) => void; submitting: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const choices = storyTurn.choices ?? [];

  if (storyTurn.mySelection) {
    return (
      <div className="page-content">
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
    <div className="page-content">
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
            <div style={{ gridColumn: '1 / -1' }}><div className="choice-label">{c.text}</div></div>
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

function StoryWaitingScreen({ turn, me, message }: { turn: TurnView; me: PlayerView; message: string }) {
  return (
    <div className="page-content">
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

function StoryOthersScreen({
  turn, me, storyTurn, onSelect, submitting,
}: {
  turn: TurnView; me: PlayerView; storyTurn: StoryTurnView;
  onSelect: (choiceId: string) => void; submitting: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const choices = storyTurn.choices ?? [];

  if (storyTurn.mySelection) {
    return (
      <div className="page-content">
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
    <div className="page-content">
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
            <div style={{ gridColumn: '1 / -1' }}>
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

function StoryResolvedScreen({ me, storyTurn }: { me: PlayerView; storyTurn: StoryTurnView }) {
  const result = storyTurn.storyResult;
  const ending = result?.ending;
  const data = ending ? ENDING_DATA[ending] : null;
  const bodyText = data?.body(result?.betrayerNames ?? []) ?? '';

  return (
    <div className="page-content">
      <MoneyPanel money={me.money} />
      {data && (
        <div className="result-panel" style={{ borderColor: data.color, gap: 8 }}>
          <div className="kicker" style={{ color: data.color }}>ENDING</div>
          <div className="result-headline" style={{ color: data.color, fontSize: 18, textShadow: `0 0 24px ${data.color}88` }}>
            {data.title}
          </div>
          <div style={{ fontSize: 11, color: data.color, opacity: 0.7, letterSpacing: '0.15em' }}>{data.sub(result?.betrayerNames ?? [])}</div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.9, whiteSpace: 'pre-line', textAlign: 'left' }}>
            {bodyText}
          </div>
        </div>
      )}
      <div style={{ flex: 1 }} />
    </div>
  );
}

// ---- 6. YES/NO Event ----
function YesNoScreen({
  turn, me, onVote, submitting,
}: {
  turn: TurnView; me: PlayerView;
  onVote: (v: 'yes' | 'no') => void;
  submitting: boolean;
}) {
  const [selected, setSelected] = useState<'yes' | 'no' | null>(null);

  if (turn.mySelection) {
    return (
      <div className="page-content">
        <MoneyPanel money={me.money} isYes />
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: '#1a1a2e', letterSpacing: '0.2em' }}>
            {turn.mySelection.toUpperCase()}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(26,26,46,0.6)', letterSpacing: '0.4em' }}>
            選択済 · 結果をお待ちください
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <MoneyPanel money={me.money} isYes />

      <div style={{ marginTop: 16, padding: '16px 14px', background: 'rgba(26,26,46,0.92)', border: '2px solid #1a1a2e', borderRadius: 4, position: 'relative', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: -10, left: 12, background: '#f0c040', padding: '2px 10px', fontSize: 10, letterSpacing: '0.4em', fontWeight: 700, color: '#1a1a2e', border: '1px solid #1a1a2e' }}>
          特殊イベント発動
        </div>
        <div className="kicker" style={{ color: '#f0c040' }}>STORY · AI</div>
        <div style={{ marginTop: 8, fontFamily: 'var(--font-display)', fontSize: 15, color: '#f0c040', lineHeight: 1.65 }}>
          {turn.story || '迷ったらYESイベント発動！'}
        </div>
      </div>

      <div className="yesno-grid">
        {(['yes', 'no'] as const).map((v) => {
          const isSel = selected === v;
          return (
            <button
              key={v}
              className="yesno-card"
              style={{
                background: isSel ? '#1a1a2e' : 'rgba(26,26,46,0.15)',
                border: isSel ? '2px solid #1a1a2e' : '2px solid rgba(26,26,46,0.5)',
                color: isSel ? '#f0c040' : '#1a1a2e',
              }}
              onClick={() => setSelected(v)}
              disabled={submitting}
            >
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 44, letterSpacing: '0.1em', lineHeight: 1, fontWeight: 700 }}>
                  {v.toUpperCase()}
                </div>
                <div style={{ marginTop: 8, fontSize: 11.5, fontFamily: 'var(--font-display)', opacity: 0.8 }}>
                  {v === 'yes' ? '迷ったらYES。' : '見送る。'}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <button
        style={{
          all: 'unset', cursor: selected ? 'pointer' : 'default',
          marginTop: 12, padding: '12px 16px',
          background: '#1a1a2e', color: '#f0c040',
          textAlign: 'center', fontWeight: 700, letterSpacing: '0.2em', fontSize: 13,
          border: '2px solid #1a1a2e', flexShrink: 0,
          opacity: selected && !submitting ? 1 : 0.45,
        }}
        onClick={() => { if (selected && !submitting) onVote(selected); }}
      >
        {selected ? `${selected.toUpperCase()} を確定する →` : '選択してください'}
      </button>
    </div>
  );
}

// ---- Main ----
export default function PlayerGamePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const session = useMemo(() => loadSession(), []);

  const [me, setMe] = useState<PlayerView | null>(null);
  const [allPlayers, setAllPlayers] = useState<PlayerView[]>([]);
  const [currentTurn, setCurrentTurn] = useState<TurnView | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    if (!roomId || !session?.playerId) return;
    try {
      const [stateData, roomData] = await Promise.all([
        api.playerState(roomId, session.playerId),
        api.getRoom(roomId),
      ]);
      setMe(stateData.me);
      setCurrentTurn(stateData.currentTurn);
      setAllPlayers(roomData.players);
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
        'turn.started', 'turn.resolved', 'yesno.started', 'yesno.resolved', 'room.finished',
        'story.started', 'story.first.submitted', 'story.others.started', 'story.others.submitted', 'story.turn.resolved',
      ].includes(event.type)) {
        setSelected(null);
        void fetchState();
      }
      if (event.type === 'room.reset') {
        navigate(`/room/${roomId}/waiting`);
      }
    });
    return disconnect;
  }, [roomId, fetchState, navigate]);

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

  if (error) return (
    <div className="page">
      <AppBar stage="ERROR" />
      <div style={{ padding: '0 22px' }}><p className="error-msg">{error}</p></div>
    </div>
  );

  if (!me) return (
    <div className="page">
      <AppBar stage="LOADING" />
      <div style={{ padding: '0 22px' }}><span className="kicker">読み込み中…</span></div>
    </div>
  );

  // Bankrupt
  if (!me.alive) {
    return (
      <div className="page">
        <AppBar stage="GAME OVER" subtitle="—" />
        <BankruptScreen me={me} />
      </div>
    );
  }

  // No turn yet
  if (!currentTurn) {
    return (
      <div className="page">
        <AppBar stage="WAITING" subtitle="ROOM" />
        <div className="page-content">
          <MoneyPanel money={me.money} />
          <div className="hint-box" style={{ marginTop: 18 }}>GMがターンを開始するまでお待ちください…</div>
        </div>
      </div>
    );
  }

  const turnLabel = `TURN ${String(currentTurn.turnNumber).padStart(2, '0')}`;

  // Story mode
  if (currentTurn.mode === 'story') {
    const storyTurn = currentTurn.storyTurn;
    if (!storyTurn) return <div className="page"><AppBar stage={turnLabel} /></div>;

    if (currentTurn.phase === 'resolved') {
      return (
        <div className="page">
          <AppBar stage={turnLabel} subtitle="STORY · RESULT" />
          <StoryResolvedScreen me={me} storyTurn={storyTurn} />
        </div>
      );
    }
    if (currentTurn.phase === 'first_selecting') {
      if (storyTurn.isFirstPlayer) {
        return (
          <div className="page" style={{ background: 'radial-gradient(ellipse at 50% 15%, rgba(240,192,64,0.18), transparent 70%)' }}>
            <AppBar stage="STORY" subtitle="1位の選択" />
            <StoryFirstScreen turn={currentTurn} me={me} storyTurn={storyTurn} onSelect={handleStoryFirstSelect} submitting={submitting} />
          </div>
        );
      }
      return (
        <div className="page">
          <AppBar stage={turnLabel} subtitle="STORY" />
          <StoryWaitingScreen turn={currentTurn} me={me} message="1位が選択中です..." />
        </div>
      );
    }
    if (currentTurn.phase === 'others_selecting') {
      if (storyTurn.isFirstPlayer) {
        return (
          <div className="page">
            <AppBar stage={turnLabel} subtitle="STORY" />
            <StoryWaitingScreen turn={currentTurn} me={me} message="他のプレイヤーが選択中です..." />
          </div>
        );
      }
      return (
        <div className="page">
          <AppBar stage={turnLabel} subtitle="STORY · 選択" />
          <StoryOthersScreen turn={currentTurn} me={me} storyTurn={storyTurn} onSelect={handleStoryOthersSelect} submitting={submitting} />
        </div>
      );
    }
  }

  // YES/NO event
  if (currentTurn.mode === 'yesno') {
    if (currentTurn.phase === 'resolved' && currentTurn.result) {
      return (
        <div className="page">
          <AppBar stage={turnLabel} subtitle="RESULT" />
          <ResultScreen turn={currentTurn} result={currentTurn.result} me={me} />
        </div>
      );
    }
    return (
      <div className="page" style={{ background: 'radial-gradient(ellipse at 50% 20%, rgba(255,210,80,1), #e6b020 70%, #b8860b)' }}>
        <AppBar stage={`EVENT · 迷ったらYES`} subtitle={turnLabel} dark />
        <YesNoScreen turn={currentTurn} me={me} onVote={handleYesNo} submitting={submitting} />
      </div>
    );
  }

  // Normal resolved
  if (currentTurn.phase === 'resolved' && currentTurn.result) {
    return (
      <div className="page">
        <AppBar stage={turnLabel} subtitle="RESULT" />
        <ResultScreen turn={currentTurn} result={currentTurn.result} me={me} />
      </div>
    );
  }

  // Voting
  if (currentTurn.phase === 'selecting' && !currentTurn.mySelection) {
    return (
      <div className="page">
        <AppBar stage={turnLabel} subtitle="VOTE" />
        <VotingScreen
          turn={currentTurn}
          me={me}
          selected={selected}
          onSelect={setSelected}
          onConfirm={() => { if (selected) void handleSelect(selected); }}
          submitting={submitting}
        />
      </div>
    );
  }

  // Waiting after vote
  return (
    <div className="page">
      <AppBar stage={turnLabel} subtitle="WAIT" />
      <WaitingScreen turn={currentTurn} me={me} allPlayers={allPlayers} />
    </div>
  );
}
