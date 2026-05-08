import type { AppliedEffect, PlayerState, Room, TurnResult, YesNoEventResult } from "../models/types.js";

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

export type PlayerView = {
  id: string;
  name: string;
  money: number;
  moneyFormatted: string;
  alive: boolean;
  rank?: number;
};

export type RoomSummaryView = {
  id: string;
  status: string;
  gmPlayerId: string;
  playerCount: number;
  currentTurn: number | null;
  maxTurns: number;
  finalizationMode: boolean;
  createdAt: string;
};

export type RoomDetailView = RoomSummaryView & {
  players: PlayerView[];
  settings: Room["settings"];
};

function rankPlayers(players: PlayerState[]): PlayerView[] {
  const sorted = [...players]
    .filter((p) => p.alive)
    .sort((a, b) => b.money - a.money);
  const rankMap = new Map<string, number>();
  sorted.forEach((p, i) => rankMap.set(p.id, i + 1));

  return players.map((p) => {
    const view: PlayerView = {
      id: p.id,
      name: p.name,
      money: p.money,
      moneyFormatted: formatYen(p.money),
      alive: p.alive,
    };
    const rank = rankMap.get(p.id);
    if (rank !== undefined) view.rank = rank;
    return view;
  });
}

export function toRoomSummary(room: Room): RoomSummaryView {
  return {
    id: room.id,
    status: room.status,
    gmPlayerId: room.gmPlayerId,
    playerCount: room.players.length,
    currentTurn: room.currentTurn?.turnNumber ?? null,
    maxTurns: room.settings.maxTurns,
    finalizationMode: room.finalizationMode,
    createdAt: room.createdAt.toISOString(),
  };
}

export function toRoomDetail(room: Room): RoomDetailView {
  return {
    ...toRoomSummary(room),
    players: rankPlayers(room.players),
    settings: room.settings,
  };
}

export type AppliedEffectView = AppliedEffect & {
  mainDeltaFormatted: string;
  bonusDeltaFormatted: string;
  totalDeltaFormatted: string;
  moneyAfterFormatted: string;
};

export type TurnResultView = {
  turnNumber: number;
  mode: "normal";
  minorityChoiceIds: string[];
  allChoicesEqualApplied: boolean;
  counts: Record<string, number>;
  applied: AppliedEffectView[];
};

export type YesNoResultView = {
  turnNumber: number;
  mode: "yesno";
  counts: { yes: number; no: number };
  minoritySide: string;
  applied: AppliedEffectView[];
};

function enrichApplied(applied: AppliedEffect[]): AppliedEffectView[] {
  return applied.map((a) => ({
    ...a,
    mainDeltaFormatted: formatYen(a.mainDelta),
    bonusDeltaFormatted: formatYen(a.bonusDelta),
    totalDeltaFormatted: formatYen(a.totalDelta),
    moneyAfterFormatted: formatYen(a.moneyAfter),
  }));
}

export function toTurnResultView(turnNumber: number, result: TurnResult): TurnResultView {
  return {
    turnNumber,
    mode: "normal",
    minorityChoiceIds: result.minorityChoiceIds,
    allChoicesEqualApplied: result.allChoicesEqualApplied,
    counts: result.counts,
    applied: enrichApplied(result.applied),
  };
}

export function toYesNoResultView(turnNumber: number, result: YesNoEventResult): YesNoResultView {
  return {
    turnNumber,
    mode: "yesno",
    counts: result.counts,
    minoritySide: result.minoritySide,
    applied: enrichApplied(result.applied),
  };
}
