import type { Context } from "hono";
import type { Choice, PlayerChoiceMap, TurnData, TurnHistoryEntry, TurnInput } from "../models/types.js";
import { getRoom, saveRoom } from "../models/room.store.js";
import type { AppBindings } from "../bindings.js";
import { publishRoomEvent } from "../durable/roomHub.client.js";
import { resolveTurn } from "../services/engine.service.js";
import { toRoomDetail, toTurnResultView } from "../views/room.view.js";

type AppContext = Context<{ Bindings: AppBindings }>;

function requireParam(c: AppContext, name: string): string | null {
  return c.req.param(name) ?? null;
}

/**
 * POST /rooms/:roomId/turns
 * 通常ターンを開始する（ストーリーと選択肢をセット）
 * GMのみ操作可能
 */
export async function handleStartTurn(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);

  const body = await c.req.json<{
    gmPlayerId: string;
    story?: string;
    choices: Choice[];
  }>();

  if (body.gmPlayerId !== room.gmPlayerId) {
    return c.json({ error: "forbidden: gm only" }, 403);
  }
  if (room.status === "finished") {
    return c.json({ error: "game already finished" }, 409);
  }
  if (room.currentTurn?.phase === "selecting" || room.currentTurn?.phase === "resolving") {
    return c.json({ error: "a turn is already in progress" }, 409);
  }
  if (!body.choices || body.choices.length !== 3) {
    return c.json({ error: "exactly 3 choices are required" }, 400);
  }

  const turnNumber = (room.currentTurn?.turnNumber ?? 0) + 1;
  room.status = "in_progress";
  const turnData: TurnData = {
    turnNumber,
    mode: "normal",
    phase: "selecting",
    choices: body.choices,
    selections: {},
    yesnoSelections: {},
    startedAt: new Date(),
  };
  if (body.story !== undefined) turnData.story = body.story;
  room.currentTurn = turnData;

  await saveRoom(room, c.env.DB);

  try {
    await publishRoomEvent(c.env, {
      type: "turn.started",
      roomId,
      at: new Date().toISOString(),
      payload: {
        turnNumber,
        mode: "normal",
      },
    });
  } catch (error) {
    console.error("failed to publish turn.started", error);
  }

  return c.json({ turnNumber, phase: "selecting", choices: body.choices }, 200);
}

/**
 * POST /rooms/:roomId/turns/select
 * プレイヤーが選択肢を投票する
 */
export async function handleSubmitSelection(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  if (!room.currentTurn || room.currentTurn.mode !== "normal" || room.currentTurn.phase !== "selecting") {
    return c.json({ error: "not in selection phase" }, 409);
  }

  const body = await c.req.json<{ playerId: string; choiceId: string }>();
  const player = room.players.find((p) => p.id === body.playerId);
  if (!player || !player.alive) return c.json({ error: "player not found or bankrupt" }, 404);

  const validChoice = room.currentTurn.choices.find((c) => c.id === body.choiceId);
  if (!validChoice) return c.json({ error: "invalid choiceId" }, 400);

  room.currentTurn.selections[body.playerId] = body.choiceId;
  await saveRoom(room, c.env.DB);

  try {
    await publishRoomEvent(c.env, {
      type: "turn.vote.submitted",
      roomId,
      at: new Date().toISOString(),
      payload: {
        turnNumber: room.currentTurn.turnNumber,
        playerId: body.playerId,
        submittedCount: Object.keys(room.currentTurn.selections).length,
      },
    });
  } catch (error) {
    console.error("failed to publish turn.vote.submitted", error);
  }

  const activePlayers = room.players.filter((p) => p.alive);
  const allSubmitted = activePlayers.every((p) => room.currentTurn!.selections[p.id]);

  return c.json({ submitted: true, allSubmitted }, 200);
}

/**
 * POST /rooms/:roomId/turns/resolve
 * GMがターンを解決する（集計・効果適用）
 */
export async function handleResolveTurn(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  if (!room.currentTurn || room.currentTurn.mode !== "normal") {
    return c.json({ error: "no active normal turn" }, 409);
  }

  const body = await c.req.json<{ gmPlayerId: string }>();
  if (body.gmPlayerId !== room.gmPlayerId) {
    return c.json({ error: "forbidden: gm only" }, 403);
  }

  const turn = room.currentTurn;

  // 未投票プレイヤーへのフォールバック処理
  const activePlayers = room.players.filter((p) => p.alive);
  const selections: PlayerChoiceMap = { ...turn.selections };
  if (room.settings.unselectedBehavior === "random") {
    for (const p of activePlayers) {
      if (!selections[p.id]) {
        const randomChoice = turn.choices[Math.floor(Math.random() * turn.choices.length)];
        if (randomChoice) selections[p.id] = randomChoice.id;
      }
    }
  }

  const turnInput: TurnInput = {
    players: activePlayers,
    choices: turn.choices,
    selections,
  };
  if (room.allChoicesEqualEvent !== undefined) turnInput.allChoicesEqualEvent = room.allChoicesEqualEvent;

  const result = resolveTurn(turnInput);

  // プレイヤー状態の更新
  for (const effect of result.applied) {
    const player = room.players.find((p) => p.id === effect.playerId);
    if (player) {
      player.money = effect.moneyAfter;
      player.alive = !effect.bankrupt;
    }
  }

  turn.result = result;
  turn.phase = "resolved";
  turn.resolvedAt = new Date();

  const historyEntry: TurnHistoryEntry = {
    turnNumber: turn.turnNumber,
    mode: "normal",
    result,
  };
  if (turn.story !== undefined) historyEntry.story = turn.story;
  room.turnHistory.push(historyEntry);

  // ゲーム終了判定
  const aliveCount = room.players.filter((p) => p.alive).length;
  const maxTurnsReached = turn.turnNumber >= room.settings.maxTurns;
  if (aliveCount <= 1 || maxTurnsReached || room.finalizationMode) {
    room.status = "finished";
  }

  await saveRoom(room, c.env.DB);

  try {
    await publishRoomEvent(c.env, {
      type: "turn.resolved",
      roomId,
      at: new Date().toISOString(),
      payload: {
        turnNumber: turn.turnNumber,
        minorityChoiceIds: result.minorityChoiceIds,
        allChoicesEqualApplied: result.allChoicesEqualApplied,
      },
    });
  } catch (error) {
    console.error("failed to publish turn.resolved", error);
  }

  if (room.status === "finished") {
    try {
      await publishRoomEvent(c.env, {
        type: "room.finished",
        roomId,
        at: new Date().toISOString(),
        payload: {
          turnNumber: turn.turnNumber,
        },
      });
    } catch (error) {
      console.error("failed to publish room.finished", error);
    }
  }

  return c.json({
    result: toTurnResultView(turn.turnNumber, result),
    room: toRoomDetail(room),
  });
}

/**
 * POST /rooms/:roomId/finalize
 * GMが決着モードをONにする（次ターン終了で即決着）
 */
export async function handleSetFinalization(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);

  const body = await c.req.json<{ gmPlayerId: string; enabled: boolean }>();
  if (body.gmPlayerId !== room.gmPlayerId) {
    return c.json({ error: "forbidden: gm only" }, 403);
  }

  room.finalizationMode = body.enabled;
  await saveRoom(room, c.env.DB);

  try {
    await publishRoomEvent(c.env, {
      type: "room.finalization.updated",
      roomId,
      at: new Date().toISOString(),
      payload: {
        enabled: room.finalizationMode,
      },
    });
  } catch (error) {
    console.error("failed to publish room.finalization.updated", error);
  }

  return c.json({ finalizationMode: room.finalizationMode });
}
