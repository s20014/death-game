import type {
  AppliedEffect,
  MoneyEffect,
  PlayerState,
  TurnInput,
  TurnResult,
  YesNoEventInput,
  YesNoEventResult,
} from "../models/types.js";

const DEFAULT_ALL_EQUAL_EVENT: MoneyEffect = {
  type: "lose",
  amount: 50_000,
  description: "全選択肢同数イベント",
};

const YES_NO_RULE = {
  yesMajority: 100_000,
  yesMinority: 250_000,
  noAny: -150_000,
} as const;

function roundYen(value: number): number {
  return Math.round(value);
}

export function getMinorityMultiplier(money: number): number {
  if (money >= 500_000) return 1.0;
  if (money >= 200_000) return 1.3;
  return 1.6;
}

function scaleEffect(effect: MoneyEffect, multiplier: number): MoneyEffect {
  const scaled: MoneyEffect = {
    type: effect.type,
    description: effect.description,
  };
  if (effect.direction !== undefined) scaled.direction = effect.direction;
  if (effect.amount !== undefined) scaled.amount = roundYen(effect.amount * multiplier);
  if (effect.rate !== undefined) scaled.rate = effect.rate * multiplier;
  if (effect.minAmount !== undefined) scaled.minAmount = roundYen(effect.minAmount * multiplier);
  if (effect.maxAmount !== undefined) scaled.maxAmount = roundYen(effect.maxAmount * multiplier);
  return scaled;
}

function applyMoneyEffect(currentMoney: number, effect: MoneyEffect, rng: () => number): number {
  switch (effect.type) {
    case "gain":
      return roundYen(effect.amount ?? 0);
    case "lose":
      return roundYen(-(effect.amount ?? 0));
    case "event": {
      const direction = effect.direction ?? "lose";
      if (effect.amount !== undefined) {
        return roundYen(direction === "gain" ? effect.amount : -effect.amount);
      }
      const raw = roundYen(currentMoney * (effect.rate ?? 0));
      return direction === "gain" ? raw : -raw;
    }
    case "gamble": {
      const min = effect.minAmount ?? effect.amount ?? 0;
      const max = effect.maxAmount ?? effect.amount ?? min;
      const lower = Math.min(min, max);
      const upper = Math.max(min, max);
      return roundYen(lower + (upper - lower) * rng());
    }
    default:
      return 0;
  }
}

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

function applyToPlayer(
  player: PlayerState,
  selectedChoiceId: string,
  mainEffect: MoneyEffect,
  minorityBonus: MoneyEffect,
  isMinority: boolean,
  uniqueMinorityDouble: boolean,
  rng: () => number,
): AppliedEffect {
  const moneyBefore = player.money;
  const mainDelta = applyMoneyEffect(moneyBefore, mainEffect, rng);
  let bonusDelta = 0;
  let multiplierApplied = 0;
  if (isMinority) {
    multiplierApplied = getMinorityMultiplier(moneyBefore) * (uniqueMinorityDouble ? 2 : 1);
    bonusDelta = applyMoneyEffect(
      moneyBefore + mainDelta,
      scaleEffect(minorityBonus, multiplierApplied),
      rng,
    );
  }
  const totalDelta = mainDelta + bonusDelta;
  const moneyAfter = roundYen(moneyBefore + totalDelta);
  return {
    playerId: player.id,
    playerName: player.name,
    selectedChoiceId,
    wasMinority: isMinority,
    mainDelta,
    bonusDelta,
    totalDelta,
    multiplierApplied,
    moneyBefore,
    moneyAfter,
    bankrupt: moneyAfter <= 0,
  };
}

export function resolveTurn(input: TurnInput): TurnResult {
  assertValidTurnInput(input);
  const rng = input.rng ?? Math.random;
  const activePlayers = input.players.filter((p) => p.alive);

  const counts: Record<string, number> = {};
  for (const c of input.choices) counts[c.id] = 0;
  for (const p of activePlayers) {
    const sel = getSelectionOrThrow(input.selections, p.id);
    counts[sel] = (counts[sel] ?? 0) + 1;
  }

  const countValues = Object.values(counts);
  const allEqual = countValues.every((v) => v === countValues[0]);

  if (allEqual) {
    const ev = input.allChoicesEqualEvent ?? DEFAULT_ALL_EQUAL_EVENT;
    return {
      counts,
      minorityChoiceIds: [],
      allChoicesEqualApplied: true,
      applied: activePlayers.map((p) => {
        const moneyBefore = p.money;
        const delta = applyMoneyEffect(moneyBefore, ev, rng);
        const moneyAfter = roundYen(moneyBefore + delta);
        return {
          playerId: p.id,
          playerName: p.name,
          selectedChoiceId: getSelectionOrThrow(input.selections, p.id),
          wasMinority: false,
          mainDelta: delta,
          bonusDelta: 0,
          totalDelta: delta,
          multiplierApplied: 0,
          moneyBefore,
          moneyAfter,
          bankrupt: moneyAfter <= 0,
        } satisfies AppliedEffect;
      }),
    };
  }

  const minCount = Math.min(...countValues);
  const minorityChoiceIds = Object.entries(counts)
    .filter(([, cnt]) => cnt === minCount)
    .map(([id]) => id);

  const choicesById = new Map(input.choices.map((c) => [c.id, c]));
  return {
    counts,
    minorityChoiceIds,
    allChoicesEqualApplied: false,
    applied: activePlayers.map((p) => {
      const selectedChoiceId = getSelectionOrThrow(input.selections, p.id);
      const choice = choicesById.get(selectedChoiceId);
      if (!choice) throw new Error(`choice not found: ${selectedChoiceId}`);
      const isMinority = minorityChoiceIds.includes(selectedChoiceId);
      const uniqueDouble = isMinority && counts[selectedChoiceId] === 1;
      return applyToPlayer(p, selectedChoiceId, choice.mainEffect, choice.minorityBonus, isMinority, uniqueDouble, rng);
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
