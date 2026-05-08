import type { Context } from "hono";
import type { AppBindings } from "../bindings.js";
import { getRoom, saveRoom } from "../models/room.store.js";
import { publishRoomEvent } from "../durable/roomHub.client.js";
import { SCENARIO } from "../story/scenarios/index.js";
import type { StoryScore, StoryTurnData, TurnData, TurnHistoryEntry } from "../models/types.js";

type AppContext = Context<{ Bindings: AppBindings }>;

function requireParam(c: AppContext, name: string): string | null {
  return c.req.param(name) ?? null;
}

function addScores(a: StoryScore, b: StoryScore): StoryScore {
  return { happy: a.happy + b.happy, normal: a.normal + b.normal, bad: a.bad + b.bad };
}

function computeEnding(score: StoryScore): "happy" | "normal" | "bad" {
  if (score.happy > score.normal && score.happy > score.bad) return "happy";
  if (score.bad > score.normal && score.bad > score.happy) return "bad";
  return "normal";
}

/**
 * POST /rooms/:roomId/turns/story
 * GMがストーリーターンを開始する
 */
export async function handleStartStoryTurn(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);

  const body = await c.req.json<{ gmPlayerId: string }>();
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  if (body.gmPlayerId !== room.gmPlayerId) return c.json({ error: "forbidden: gm only" }, 403);
  if (room.currentTurn?.phase === "first_selecting" || room.currentTurn?.phase === "others_selecting") {
    return c.json({ error: "a story turn is already in progress" }, 409);
  }

  const progress = room.storyProgress ?? { currentTurnIndex: 0, accumulatedScore: { happy: 0, normal: 0, bad: 0 } };
  const turnDef = SCENARIO[progress.currentTurnIndex];
  if (!turnDef) return c.json({ error: "no more story turns" }, 409);

  // 1位プレイヤーを決定（所持金最大の生存者）
  const alivePlayers = room.players.filter((p) => p.alive);
  const firstPlayer = [...alivePlayers].sort((a, b) => b.money - a.money)[0];
  if (!firstPlayer) return c.json({ error: "no alive players" }, 409);

  const turnNumber = (room.currentTurn?.turnNumber ?? 0) + 1;
  room.status = "in_progress";

  const storyData: StoryTurnData = {
    firstPlayerId: firstPlayer.id,
    othersSelections: {},
  };

  const turnData: TurnData = {
    turnNumber,
    mode: "story",
    phase: "first_selecting",
    story: turnDef.background,
    choices: [],
    selections: {},
    yesnoSelections: {},
    storyData,
    startedAt: new Date(),
  };
  room.currentTurn = turnData;
  room.storyProgress = progress;

  await saveRoom(room, c.env.DB);

  try {
    await publishRoomEvent(c.env, {
      type: "story.started",
      roomId,
      at: new Date().toISOString(),
      payload: { turnNumber, firstPlayerId: firstPlayer.id, background: turnDef.background },
    });
  } catch (err) {
    console.error("failed to publish story.started", err);
  }

  return c.json({ turnNumber, firstPlayerId: firstPlayer.id, background: turnDef.background });
}

/**
 * POST /rooms/:roomId/turns/story/first
 * 1位プレイヤーが選択を提出する
 */
export async function handleSubmitFirstSelection(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);

  const body = await c.req.json<{ playerId: string; choiceId: string }>();
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  if (!room.currentTurn || room.currentTurn.mode !== "story" || room.currentTurn.phase !== "first_selecting") {
    return c.json({ error: "not in first_selecting phase" }, 409);
  }

  const storyData = room.currentTurn.storyData!;
  if (body.playerId !== storyData.firstPlayerId) {
    return c.json({ error: "only the first player can submit here" }, 403);
  }

  const progress = room.storyProgress!;
  const turnDef = SCENARIO[progress.currentTurnIndex]!;
  const validChoice = turnDef.firstScene.choices.find((c) => c.id === body.choiceId);
  if (!validChoice) return c.json({ error: "invalid choiceId" }, 400);

  storyData.firstSelection = body.choiceId;
  await saveRoom(room, c.env.DB);

  try {
    await publishRoomEvent(c.env, {
      type: "story.first.submitted",
      roomId,
      at: new Date().toISOString(),
      payload: { playerId: body.playerId },
    });
  } catch (err) {
    console.error("failed to publish story.first.submitted", err);
  }

  return c.json({ submitted: true });
}

/**
 * POST /rooms/:roomId/turns/story/advance
 * GMが others_selecting フェーズへ進める
 */
export async function handleAdvanceToOthers(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);

  const body = await c.req.json<{ gmPlayerId: string }>();
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  if (body.gmPlayerId !== room.gmPlayerId) return c.json({ error: "forbidden: gm only" }, 403);
  if (!room.currentTurn || room.currentTurn.mode !== "story" || room.currentTurn.phase !== "first_selecting") {
    return c.json({ error: "not in first_selecting phase" }, 409);
  }

  const storyData = room.currentTurn.storyData!;
  if (!storyData.firstSelection) return c.json({ error: "first player has not submitted yet" }, 409);

  room.currentTurn.phase = "others_selecting";
  await saveRoom(room, c.env.DB);

  const progress = room.storyProgress!;
  const turnDef = SCENARIO[progress.currentTurnIndex]!;
  const othersScene = turnDef.othersScenes[storyData.firstSelection];

  try {
    await publishRoomEvent(c.env, {
      type: "story.others.started",
      roomId,
      at: new Date().toISOString(),
      payload: {
        firstChoiceId: storyData.firstSelection,
        question: othersScene?.question ?? "",
      },
    });
  } catch (err) {
    console.error("failed to publish story.others.started", err);
  }

  return c.json({ phase: "others_selecting" });
}

/**
 * POST /rooms/:roomId/turns/story/others
 * 1位以外のプレイヤーが選択を提出する
 */
export async function handleSubmitOthersSelection(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);

  const body = await c.req.json<{ playerId: string; choiceId: string }>();
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  if (!room.currentTurn || room.currentTurn.mode !== "story" || room.currentTurn.phase !== "others_selecting") {
    return c.json({ error: "not in others_selecting phase" }, 409);
  }

  const storyData = room.currentTurn.storyData!;
  if (body.playerId === storyData.firstPlayerId) {
    return c.json({ error: "first player cannot submit in others phase" }, 403);
  }

  const player = room.players.find((p) => p.id === body.playerId);
  if (!player || !player.alive) return c.json({ error: "player not found or bankrupt" }, 404);

  const progress = room.storyProgress!;
  const turnDef = SCENARIO[progress.currentTurnIndex]!;
  const othersScene = turnDef.othersScenes[storyData.firstSelection!];
  if (!othersScene) return c.json({ error: "no others scene for this first choice" }, 409);

  const validChoice = othersScene.choices.find((c) => c.id === body.choiceId);
  if (!validChoice) return c.json({ error: "invalid choiceId" }, 400);

  storyData.othersSelections[body.playerId] = body.choiceId;
  await saveRoom(room, c.env.DB);

  const alivePlayers = room.players.filter((p) => p.alive && p.id !== storyData.firstPlayerId);
  const allSubmitted = alivePlayers.every((p) => storyData.othersSelections[p.id]);

  try {
    await publishRoomEvent(c.env, {
      type: "story.others.submitted",
      roomId,
      at: new Date().toISOString(),
      payload: { playerId: body.playerId, submittedCount: Object.keys(storyData.othersSelections).length },
    });
  } catch (err) {
    console.error("failed to publish story.others.submitted", err);
  }

  return c.json({ submitted: true, allSubmitted });
}

/**
 * POST /rooms/:roomId/turns/story/resolve
 * GMがターンを解決する
 */
export async function handleResolveStoryTurn(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);

  const body = await c.req.json<{ gmPlayerId: string }>();
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  if (body.gmPlayerId !== room.gmPlayerId) return c.json({ error: "forbidden: gm only" }, 403);
  if (!room.currentTurn || room.currentTurn.mode !== "story" || room.currentTurn.phase !== "others_selecting") {
    return c.json({ error: "not in others_selecting phase" }, 409);
  }

  const turn = room.currentTurn;
  const storyData = turn.storyData!;
  const progress = room.storyProgress!;
  const turnDef = SCENARIO[progress.currentTurnIndex]!;
  const firstChoiceId = storyData.firstSelection!;
  const othersScene = turnDef.othersScenes[firstChoiceId]!;

  // お金の効果を適用
  const applied = room.players
    .filter((p) => p.alive && p.id !== storyData.firstPlayerId)
    .map((p) => {
      const choiceId = storyData.othersSelections[p.id];
      const choice = choiceId ? othersScene.choices.find((c) => c.id === choiceId) : null;
      const effect = choice?.moneyEffect;
      const moneyBefore = p.money;
      let delta = 0;
      if (effect) {
        if (effect.type === "gain") delta = effect.amount ?? 0;
        else if (effect.type === "lose") delta = -(effect.amount ?? 0);
      }
      const moneyAfter = moneyBefore + delta;
      p.money = moneyAfter;
      p.alive = moneyAfter > 0;
      return {
        playerId: p.id,
        playerName: p.name,
        selectedChoiceId: choiceId ?? "",
        wasMinority: false,
        mainDelta: delta,
        bonusDelta: 0,
        totalDelta: delta,
        multiplierApplied: 0,
        moneyBefore,
        moneyAfter,
        bankrupt: moneyAfter <= 0,
      };
    });

  // ストーリースコア集計
  const firstChoice = turnDef.firstScene.choices.find((c) => c.id === firstChoiceId);
  let addedScore: StoryScore = { happy: 0, normal: 0, bad: 0 };
  if (firstChoice) addedScore = addScores(addedScore, firstChoice.storyScore);
  for (const [pid, cid] of Object.entries(storyData.othersSelections)) {
    void pid;
    const choice = othersScene.choices.find((c) => c.id === cid);
    if (choice) addedScore = addScores(addedScore, choice.storyScore);
  }

  const newAccumulated = addScores(progress.accumulatedScore, addedScore);
  progress.accumulatedScore = newAccumulated;
  progress.currentTurnIndex += 1;

  const isLastTurn = progress.currentTurnIndex >= SCENARIO.length;
  if (isLastTurn) progress.ending = computeEnding(newAccumulated);

  storyData.storyResult = { firstPlayerId: storyData.firstPlayerId, firstChoiceId, addedScore, applied };
  turn.phase = "resolved";
  turn.resolvedAt = new Date();
  room.storyProgress = progress;

  const historyEntry: TurnHistoryEntry = {
    turnNumber: turn.turnNumber,
    mode: "story",
    storyResult: storyData.storyResult,
  };
  if (turn.story !== undefined) historyEntry.story = turn.story;
  room.turnHistory.push(historyEntry);

  await saveRoom(room, c.env.DB);

  try {
    await publishRoomEvent(c.env, {
      type: "story.turn.resolved",
      roomId,
      at: new Date().toISOString(),
      payload: {
        turnNumber: turn.turnNumber,
        ending: progress.ending ?? null,
        addedScore,
      },
    });
  } catch (err) {
    console.error("failed to publish story.turn.resolved", err);
  }

  return c.json({
    storyResult: storyData.storyResult,
    storyProgress: progress,
  });
}
