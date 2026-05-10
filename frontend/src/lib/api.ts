// バックエンドAPIクライアント
// Viteのプロキシが使えない場合でも直結できるようにフォールバックする。
const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ---- 型定義 ----

export type RoomSummary = {
  id: string;
  status: string;
  gmPlayerId: string;
  playerCount: number;
  currentTurn: number | null;
  maxTurns: number;
  finalizationMode: boolean;
  createdAt: string;
};

export type PlayerView = {
  id: string;
  name: string;
  money: number;
  moneyFormatted: string;
  alive: boolean;
  rank?: number;
};

export type RoomDetail = RoomSummary & {
  players: PlayerView[];
  settings: { maxTurns: number; selectionTimeoutSec: number };
};

export type ChoiceView = {
  id: string;
  text: string;
  amount: number;
  resultStory?: { majority: string; minority: string };
};

export type ChoiceInput = {
  id: string;
  text: string;
  amount: number;
  resultStory?: { majority: string; minority: string };
};

export type AppliedEffectView = {
  playerId: string;
  playerName: string;
  selectedChoiceId: string;
  wasMinority: boolean;
  mainDelta: number;
  bonusDelta: number;
  totalDelta: number;
  multiplierApplied: number;
  moneyBefore: number;
  moneyAfter: number;
  bankrupt: boolean;
  mainDeltaFormatted: string;
  bonusDeltaFormatted: string;
  totalDeltaFormatted: string;
  moneyAfterFormatted: string;
};

export type TurnResultView = {
  turnNumber: number;
  mode: 'normal';
  minorityChoiceIds: string[];
  allChoicesEqualApplied: boolean;
  counts: Record<string, number>;
  applied: AppliedEffectView[];
};

export type YesNoResultView = {
  turnNumber: number;
  mode: 'yesno';
  counts: { yes: number; no: number };
  minoritySide: string;
  applied: AppliedEffectView[];
};

export type TurnView = {
  turnNumber: number;
  mode: string;
  phase: string;
  story?: string;
  choices?: ChoiceView[];
  mySelection?: string;
  result?: TurnResultView | YesNoResultView | null;
  counts?: Record<string, number> | { yes: number; no: number };
  unsubmittedPlayerIds?: string[];
  storyTurn?: StoryTurnView;
  storyGm?: StoryGmView;
};

export type GeneratedTurn = {
  story: string;
  choices: { id: string; text: string; resultStory?: { majority: string; minority: string } }[];
};

export type StoryChoiceView = {
  id: string;
  text: string;
  moneyEffect?: { type: string; amount?: number; description: string };
};

export type StoryEnding = 'happy' | 'betrayal' | 'destruction' | 'dictator';

export type StoryTurnView = {
  isFirstPlayer: boolean;
  firstPlayerId: string;
  question?: string;
  choices?: StoryChoiceView[];
  mySelection?: string;
  storyResult?: {
    firstPlayerId: string;
    firstChoiceId: string;
    ending: StoryEnding;
    betrayerIds: string[];
    betrayerNames: string[];
    applied: Array<{
      playerId: string;
      playerName: string;
      selectedChoiceId: string;
      mainDelta: number;
      totalDelta: number;
      moneyBefore: number;
      moneyAfter: number;
      bankrupt: boolean;
    }>;
  } | null;
};

export type StoryGmView = {
  firstPlayerId: string;
  firstPlayerName: string;
  firstSelectionSubmitted: boolean;
  firstChoiceId: string | null;
  othersAliveCount: number;
  othersSubmittedCount: number;
};

// ---- API ----

export const api = {
  createRoom: (gmPlayerName: string, maxTurns: number) =>
    request<{ room: RoomSummary; gmPlayerId: string }>('POST', '/rooms', { gmPlayerName, settings: { maxTurns } }),

  joinRoom: (roomId: string, playerName: string) =>
    request<{ room: RoomSummary; playerId: string }>('POST', `/rooms/${roomId}/join`, { playerName }),

  getRoom: (roomId: string) =>
    request<RoomDetail>('GET', `/rooms/${roomId}`),

  playerState: (roomId: string, playerId: string) =>
    request<{ room: RoomSummary; me: PlayerView; currentTurn: TurnView | null }>(
      'GET',
      `/rooms/${roomId}/player-state?playerId=${encodeURIComponent(playerId)}`,
    ),

  gmState: (roomId: string, gmPlayerId: string) =>
    request<{ room: RoomDetail; currentTurn: TurnView | null; storyProgress?: { currentTurnIndex: number; accumulatedScore: { happy: number; normal: number; bad: number }; ending?: string } | null }>(
      'GET',
      `/rooms/${roomId}/gm-state?gmPlayerId=${encodeURIComponent(gmPlayerId)}`,
    ),

  logState: (roomId: string) =>
    request<{ room: RoomDetail; currentTurn: TurnView | null; recentHistory: (TurnResultView | YesNoResultView | null)[] }>(
      'GET',
      `/rooms/${roomId}/log-state`,
    ),

  startTurn: (roomId: string, gmPlayerId: string, choices: ChoiceInput[], story?: string) =>
    request<{ message: string }>('POST', `/rooms/${roomId}/turns`, {
      gmPlayerId,
      choices,
      story,
    }),

  submitSelection: (roomId: string, playerId: string, choiceId: string) =>
    request<{ message: string }>('POST', `/rooms/${roomId}/turns/select`, { playerId, choiceId }),

  resolveTurn: (roomId: string, gmPlayerId: string) =>
    request<TurnResultView>('POST', `/rooms/${roomId}/turns/resolve`, { gmPlayerId }),

  triggerYesNo: (roomId: string, gmPlayerId: string, story?: string) =>
    request<{ message: string }>('POST', `/rooms/${roomId}/turns/yesno`, { gmPlayerId, story }),

  submitYesNo: (roomId: string, playerId: string, vote: 'yes' | 'no') =>
    request<{ message: string }>('POST', `/rooms/${roomId}/turns/yesno/select`, {
      playerId,
      answer: vote,
    }),

  resolveYesNo: (roomId: string, gmPlayerId: string) =>
    request<YesNoResultView>('POST', `/rooms/${roomId}/turns/yesno/resolve`, { gmPlayerId }),

  setFinalization: (roomId: string, gmPlayerId: string, enabled: boolean) =>
    request<{ message: string }>('POST', `/rooms/${roomId}/finalize`, { gmPlayerId, enabled }),

  generateTurn: (roomId: string, gmPlayerId: string) =>
    request<GeneratedTurn>('POST', `/rooms/${roomId}/turns/generate`, { gmPlayerId }),

  startStoryTurn: (roomId: string, gmPlayerId: string) =>
    request<{ turnNumber: number; firstPlayerId: string; background: string }>('POST', `/rooms/${roomId}/turns/story`, { gmPlayerId }),

  submitFirstSelection: (roomId: string, playerId: string, choiceId: string) =>
    request<{ submitted: boolean }>('POST', `/rooms/${roomId}/turns/story/first`, { playerId, choiceId }),

  advanceToOthers: (roomId: string, gmPlayerId: string) =>
    request<{ phase: string }>('POST', `/rooms/${roomId}/turns/story/advance`, { gmPlayerId }),

  submitOthersSelection: (roomId: string, playerId: string, choiceId: string) =>
    request<{ submitted: boolean; allSubmitted: boolean }>('POST', `/rooms/${roomId}/turns/story/others`, { playerId, choiceId }),

  resolveStoryTurn: (roomId: string, gmPlayerId: string) =>
    request<{ storyResult: unknown; storyProgress: unknown }>('POST', `/rooms/${roomId}/turns/story/resolve`, { gmPlayerId }),

  resetRoom: (roomId: string, gmPlayerId: string) =>
    request<{ message: string }>('POST', `/rooms/${roomId}/reset`, { gmPlayerId }),
};
