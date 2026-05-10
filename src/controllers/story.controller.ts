import type { Context } from "hono";
import type { AppBindings } from "../bindings.js";
import { getRoom, saveRoom } from "../models/room.store.js";
import { publishRoomEvent } from "../durable/roomHub.client.js";
import { SCENARIO } from "../story/scenarios/index.js";
import type { StoryEnding, StoryTurnData, StoryTurnResult, TurnData, TurnHistoryEntry } from "../models/types.js";

type AppContext = Context<{ Bindings: AppBindings }>;

function requireParam(c: AppContext, name: string): string | null {
  return c.req.param(name) ?? null;
}

function computeEnding(
  othersSelections: Record<string, string>,
  alivePlayers: { id: string; name: string }[],
): { ending: StoryEnding; betrayerIds: string[]; betrayerNames: string[] } {
  const defectors = alivePlayers.filter((p) => othersSelections[p.id] === "defect");
  if (defectors.length === 0) {
    return { ending: "happy", betrayerIds: [], betrayerNames: [] };
  }
  if (defectors.length === 1) {
    return {
      ending: "betrayal",
      betrayerIds: [defectors[0]!.id],
      betrayerNames: [defectors[0]!.name],
    };
  }
  return {
    ending: "destruction",
    betrayerIds: defectors.map((p) => p.id),
    betrayerNames: defectors.map((p) => p.name),
  };
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
  if (["selecting", "first_selecting", "others_selecting"].includes(room.currentTurn?.phase ?? "")) {
    return c.json({ error: "a turn is already in progress" }, 409);
  }

  const progress = room.storyProgress ?? { currentTurnIndex: 0 };
  const turnDef = SCENARIO[progress.currentTurnIndex];
  if (!turnDef) return c.json({ error: "no more story turns" }, 409);

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
      payload: { playerId: body.playerId, choiceId: body.choiceId },
    });
  } catch (err) {
    console.error("failed to publish story.first.submitted", err);
  }

  return c.json({ submitted: true, choiceId: body.choiceId });
}

/**
 * POST /rooms/:roomId/turns/story/advance
 * GMが次フェーズへ進める。
 * 1位が「独り占め」を選んだ場合はそのまま resolved（独裁エンド）に確定する。
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

  const turn = room.currentTurn;
  const storyData = turn.storyData!;
  if (!storyData.firstSelection) return c.json({ error: "first player has not submitted yet" }, 409);

  // 独り占め → 即終了（独裁エンド）
  if (storyData.firstSelection === "monopolize") {
    const storyResult: StoryTurnResult = {
      firstPlayerId: storyData.firstPlayerId,
      firstChoiceId: "monopolize",
      ending: "dictator",
      betrayerIds: [storyData.firstPlayerId],
      betrayerNames: [room.players.find((p) => p.id === storyData.firstPlayerId)?.name ?? '？'],
      applied: [],
    };
    storyData.storyResult = storyResult;
    turn.phase = "resolved";
    turn.resolvedAt = new Date();

    const progress = room.storyProgress!;
    progress.currentTurnIndex += 1;
    progress.ending = "dictator";
    room.storyProgress = progress;

    const historyEntry: TurnHistoryEntry = {
      turnNumber: turn.turnNumber,
      mode: "story",
      storyResult,
    };
    room.turnHistory.push(historyEntry);

    await saveRoom(room, c.env.DB);

    try {
      await publishRoomEvent(c.env, {
        type: "story.turn.resolved",
        roomId,
        at: new Date().toISOString(),
        payload: { turnNumber: turn.turnNumber, ending: "dictator" },
      });
    } catch (err) {
      console.error("failed to publish story.turn.resolved (dictator)", err);
    }

    return c.json({ phase: "resolved", ending: "dictator" });
  }

  // 分ける → others_selecting へ
  turn.phase = "others_selecting";
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
 * GMがターンを解決する（happy / betrayal / destruction）
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

  const alivePlayers = room.players.filter((p) => p.alive && p.id !== storyData.firstPlayerId);
  const { ending, betrayerIds, betrayerNames } = computeEnding(storyData.othersSelections, alivePlayers);

  const storyResult: StoryTurnResult = {
    firstPlayerId: storyData.firstPlayerId,
    firstChoiceId: storyData.firstSelection!,
    ending,
    betrayerIds,
    betrayerNames,
    applied: [],
  };
  storyData.storyResult = storyResult;
  turn.phase = "resolved";
  turn.resolvedAt = new Date();

  progress.currentTurnIndex += 1;
  progress.ending = ending;
  if (betrayerIds.length > 0) {
    progress.betrayerIds = betrayerIds;
    progress.betrayerNames = betrayerNames;
  }
  room.storyProgress = progress;

  const historyEntry: TurnHistoryEntry = {
    turnNumber: turn.turnNumber,
    mode: "story",
    storyResult,
  };
  room.turnHistory.push(historyEntry);

  await saveRoom(room, c.env.DB);

  try {
    await publishRoomEvent(c.env, {
      type: "story.turn.resolved",
      roomId,
      at: new Date().toISOString(),
      payload: { turnNumber: turn.turnNumber, ending, betrayerNames },
    });
  } catch (err) {
    console.error("failed to publish story.turn.resolved", err);
  }

  return c.json({ storyResult, storyProgress: progress });
}
