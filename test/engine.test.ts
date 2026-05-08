// このコードは生成AIによって生成されました。

import { describe, expect, it } from "vitest";
import { resolveTurn, resolveYesNoEvent } from "../src/services/engine.service.js";
import type { Choice, PlayerState } from "../src/models/types.js";

const players: PlayerState[] = [
  { id: "p1", name: "A", money: 1_000_000, alive: true },
  { id: "p2", name: "B", money: 1_000_000, alive: true },
  { id: "p3", name: "C", money: 1_000_000, alive: true },
  { id: "p4", name: "D", money: 1_000_000, alive: true },
];

const choices: Choice[] = [
  {
    id: "c1",
    text: "low",
    riskLevel: "low",
    mainEffect: { type: "gain", amount: 50_000, description: "main" },
    minorityBonus: { type: "gain", amount: 100_000, description: "bonus" },
  },
  {
    id: "c2",
    text: "mid",
    riskLevel: "medium",
    mainEffect: { type: "lose", amount: 100_000, description: "main" },
    minorityBonus: { type: "gain", amount: 200_000, description: "bonus" },
  },
  {
    id: "c3",
    text: "high",
    riskLevel: "high",
    mainEffect: { type: "event", rate: 0.1, direction: "lose", description: "main" },
    minorityBonus: { type: "gain", amount: 300_000, description: "bonus" },
  },
];

describe("resolveTurn", () => {
  it("最少同数の選択肢を少数派として判定する", () => {
    const result = resolveTurn({
      players,
      choices,
      selections: {
        p1: "c1",
        p2: "c1",
        p3: "c2",
        p4: "c3",
      },
    });

    expect(result.minorityChoiceIds.sort()).toEqual(["c2", "c3"]);
    expect(result.allChoicesEqualApplied).toBe(false);
  });

  it("少数派ボーナスに所持金補正を適用する", () => {
    const lowMoneyPlayers: PlayerState[] = [
      { id: "p1", name: "A", money: 180_000, alive: true },
      { id: "p2", name: "B", money: 1_000_000, alive: true },
      { id: "p3", name: "C", money: 1_000_000, alive: true },
      { id: "p4", name: "D", money: 1_000_000, alive: true },
    ];

    const result = resolveTurn({
      players: lowMoneyPlayers,
      choices,
      selections: {
        p1: "c2",
        p2: "c1",
        p3: "c1",
        p4: "c3",
      },
    });

    const p1 = result.applied.find((a) => a.playerId === "p1");
    expect(p1).toBeTruthy();
    expect(p1?.wasMinority).toBe(true);
    expect(p1?.multiplierApplied).toBe(3.2);
  });

  it("全選択肢同数時は場イベントを全員に適用する", () => {
    const tiePlayers: PlayerState[] = [
      { id: "p1", name: "A", money: 1_000_000, alive: true },
      { id: "p2", name: "B", money: 1_000_000, alive: true },
      { id: "p3", name: "C", money: 1_000_000, alive: true },
    ];

    const result = resolveTurn({
      players: tiePlayers,
      choices,
      selections: {
        p1: "c1",
        p2: "c2",
        p3: "c3",
      },
      allChoicesEqualEvent: { type: "lose", amount: 50_000, description: "tie" },
    });

    expect(result.allChoicesEqualApplied).toBe(true);
    expect(result.minorityChoiceIds).toHaveLength(0);
    expect(result.applied.every((a) => a.totalDelta === -50_000)).toBe(true);
  });
});

describe("resolveYesNoEvent", () => {
  it("NO側は少数派でもボーナスなしで-150000", () => {
    const result = resolveYesNoEvent({
      players,
      selections: {
        p1: "no",
        p2: "yes",
        p3: "yes",
        p4: "yes",
      },
    });

    const p1 = result.applied.find((a) => a.playerId === "p1");
    expect(result.minoritySide).toBe("no");
    expect(p1?.totalDelta).toBe(-150_000);
  });
});
