import type {
  AppliedEffect,
  TurnInput,
  TurnResult,
  YesNoEventInput,
  YesNoEventResult,
} from "../models/types.js";

const YES_NO_RULE = {
  yesMajority: 100_000,
  yesMinority: 250_000,
  noAny: -150_000,
} as const;

function getSelectionOrThrow<T extends string>(
  selections: Record<string, T>,
  playerId: string,
): T {
  const selected = selections[playerId];
  if (!selected) throw new Error(`selection missing for player: ${playerId}`);
  return selected;
}

function assertValidTurnInput(input: TurnInput): void {
  if (input.choices.length === 0) throw new Error("choices must not be empty");
  const choiceIds = new Set(input.choices.map((c) => c.id));
  for (const p of input.players) {
    if (!p.alive) continue;
    const sel = getSelectionOrThrow(input.selections, p.id);
    if (!choiceIds.has(sel)) {
      throw new Error(`invalid selection '${sel}' for player: ${p.id}`);
    }
  }
}

// 最少得票の選択肢を選んだグループが賞金獲得。タイは全該当グループ。0票は除外。
export function resolveTurn(input: TurnInput): TurnResult {
  assertValidTurnInput(input);
  const activePlayers = input.players.filter((p) => p.alive);

  const counts: Record<string, number> = {};
  for (const c of input.choices) counts[c.id] = 0;
  for (const p of activePlayers) {
    const sel = getSelectionOrThrow(input.selections, p.id);
    counts[sel] = (counts[sel] ?? 0) + 1;
  }

  const votedEntries = Object.entries(counts).filter(([, cnt]) => cnt > 0);
  let winningChoiceIds: string[] = [];
  if (votedEntries.length > 0) {
    const minCount = Math.min(...votedEntries.map(([, cnt]) => cnt));
    winningChoiceIds = votedEntries
      .filter(([, cnt]) => cnt === minCount)
      .map(([id]) => id);
  }

  const choicesById = new Map(input.choices.map((c) => [c.id, c]));
  return {
    counts,
    minorityChoiceIds: winningChoiceIds,
    allChoicesEqualApplied: false,
    applied: activePlayers.map((p) => {
      const selectedChoiceId = getSelectionOrThrow(input.selections, p.id);
      const choice = choicesById.get(selectedChoiceId);
      if (!choice) throw new Error(`choice not found: ${selectedChoiceId}`);
      const isWinner = winningChoiceIds.includes(selectedChoiceId);
      const delta = isWinner ? (choice.amount ?? 0) : 0;
      return {
        playerId: p.id,
        playerName: p.name,
        selectedChoiceId,
        wasMinority: isWinner,
        mainDelta: delta,
        bonusDelta: 0,
        totalDelta: delta,
        multiplierApplied: 0,
        moneyBefore: p.money,
        moneyAfter: p.money + delta,
        bankrupt: false,
      } satisfies AppliedEffect;
    }),
  };
}

export function resolveYesNoEvent(input: YesNoEventInput): YesNoEventResult {
  const activePlayers = input.players.filter((p) => p.alive);
  for (const p of activePlayers) getSelectionOrThrow(input.selections, p.id);

  const yesCount = activePlayers.filter((p) => getSelectionOrThrow(input.selections, p.id) === "yes").length;
  const noCount = activePlayers.filter((p) => getSelectionOrThrow(input.selections, p.id) === "no").length;
  const minoritySide: "yes" | "no" | "both" =
    yesCount === noCount ? "both" : yesCount < noCount ? "yes" : "no";

  return {
    counts: { yes: yesCount, no: noCount },
    minoritySide,
    applied: activePlayers.map((p) => {
      const selected = getSelectionOrThrow(input.selections, p.id);
      const moneyBefore = p.money;
      const yesIsMinority = minoritySide === "yes" || minoritySide === "both";
      let delta: number;
      let wasMinority: boolean;
      if (selected === "yes") {
        wasMinority = yesIsMinority;
        delta = yesIsMinority ? YES_NO_RULE.yesMinority : YES_NO_RULE.yesMajority;
      } else {
        wasMinority = minoritySide === "no" || minoritySide === "both";
        delta = YES_NO_RULE.noAny;
      }
      return {
        playerId: p.id,
        playerName: p.name,
        selectedChoiceId: selected,
        wasMinority,
        mainDelta: delta,
        bonusDelta: 0,
        totalDelta: delta,
        multiplierApplied: 0,
        moneyBefore,
        moneyAfter: moneyBefore + delta,
        bankrupt: moneyBefore + delta <= 0,
      } satisfies AppliedEffect;
    }),
  };
}
