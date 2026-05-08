// ---------- 金銭効果 ----------

export type RiskLevel = "low" | "medium" | "high";
export type MoneyEffectType = "gain" | "lose" | "gamble" | "event";

export type MoneyEffect = {
  type: MoneyEffectType;
  amount?: number;
  rate?: number;
  minAmount?: number;
  maxAmount?: number;
  direction?: "gain" | "lose";
  description: string;
};

// ---------- 選択肢 ----------

export type Choice = {
  id: string;
  text: string;
  riskLevel: RiskLevel;
  mainEffect: MoneyEffect;
  minorityBonus: MoneyEffect;
  resultStory?: { majority: string; minority: string };
};

// ---------- プレイヤー ----------

export type PlayerState = {
  id: string;
  name: string;
  money: number;
  alive: boolean;
};

// ---------- ルーム ----------

export type RoomStatus = "waiting" | "in_progress" | "finished";
export type TurnPhase = "selecting" | "resolving" | "resolved" | "first_selecting" | "others_selecting";
export type TurnMode = "normal" | "yesno" | "story";

export type InsideJokeConfig = {
  playerNames: string[];
  keywords: string[];
  location: string;
  theme: string;
  tone: "comedy" | "drama" | "chaos";
};

export type RoomSettings = {
  maxTurns: number;
  selectionTimeoutSec: number;
  unselectedBehavior: "random" | "skip";
};

// ---------- ストーリーモード ----------

export type StoryScore = {
  happy: number;
  normal: number;
  bad: number;
};

export type StoryFirstChoice = {
  id: string;
  text: string;
  storyScore: StoryScore;
};

export type StoryOthersChoice = {
  id: string;
  text: string;
  moneyEffect: MoneyEffect;
  storyScore: StoryScore;
};

export type StoryTurnDefinition = {
  turnIndex: number;
  background: string;
  firstScene: {
    question: string;
    choices: StoryFirstChoice[];
  };
  othersScenes: Record<string, {
    question: string;
    choices: StoryOthersChoice[];
  }>;
};

export type StoryProgress = {
  currentTurnIndex: number;
  accumulatedScore: StoryScore;
  ending?: "happy" | "normal" | "bad";
};

export type StoryTurnResult = {
  firstPlayerId: string;
  firstChoiceId: string;
  addedScore: StoryScore;
  applied: AppliedEffect[];
};

export type StoryTurnData = {
  firstPlayerId: string;
  firstSelection?: string;
  othersSelections: PlayerChoiceMap;
  storyResult?: StoryTurnResult;
};

// ---------- ターンデータ ----------

export type TurnData = {
  turnNumber: number;
  mode: TurnMode;
  phase: TurnPhase;
  story?: string;
  // normal モード
  choices: Choice[];
  selections: PlayerChoiceMap;
  result?: TurnResult;
  // yesno モード
  yesnoSelections: YesNoSelection;
  yesnoResult?: YesNoEventResult;
  // story モード
  storyData?: StoryTurnData;
  startedAt: Date;
  resolvedAt?: Date;
};

export type TurnHistoryEntry = {
  turnNumber: number;
  mode: TurnMode;
  story?: string;
  result?: TurnResult;
  yesnoResult?: YesNoEventResult;
  storyResult?: StoryTurnResult;
};

export type Room = {
  id: string;
  gmPlayerId: string;
  players: PlayerState[];
  insideJokeConfig?: InsideJokeConfig;
  settings: RoomSettings;
  status: RoomStatus;
  currentTurn?: TurnData;
  turnHistory: TurnHistoryEntry[];
  finalizationMode: boolean;
  allChoicesEqualEvent?: MoneyEffect;
  storyProgress?: StoryProgress;
  createdAt: Date;
};

// ---------- ターン解決入力・出力 ----------

export type PlayerChoiceMap = Record<string, string>;

export type TurnInput = {
  players: PlayerState[];
  choices: Choice[];
  selections: PlayerChoiceMap;
  allChoicesEqualEvent?: MoneyEffect;
  rng?: () => number;
};

export type AppliedEffect = {
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
};

export type TurnResult = {
  counts: Record<string, number>;
  minorityChoiceIds: string[];
  allChoicesEqualApplied: boolean;
  applied: AppliedEffect[];
};

// ---------- YES/NOイベント ----------

export type YesNoSelection = Record<string, "yes" | "no">;

export type YesNoEventInput = {
  players: PlayerState[];
  selections: YesNoSelection;
};

export type YesNoEventResult = {
  counts: { yes: number; no: number };
  minoritySide: "yes" | "no" | "both";
  applied: AppliedEffect[];
};
