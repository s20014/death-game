import type { Context } from "hono";
import type { TurnData, TurnHistoryEntry } from "../models/types.js";
import { getRoom, saveRoom } from "../models/room.store.js";
import type { AppBindings } from "../bindings.js";
import { publishRoomEvent } from "../durable/roomHub.client.js";
import { resolveYesNoEvent } from "../services/engine.service.js";
import { toRoomDetail, toYesNoResultView } from "../views/room.view.js";

type AppContext = Context<{ Bindings: AppBindings }>;

function requireParam(c: AppContext, name: string): string | null {
  return c.req.param(name) ?? null;
}

/**
 * POST /rooms/:roomId/turns/yesno
 * GMが「迷ったらYES」特殊イベントを発動する
 */
export async function handleTriggerYesNo(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);

  const body = await c.req.json<{ gmPlayerId: string; story?: string }>();
  if (body.gmPlayerId !== room.gmPlayerId) {
    return c.json({ error: "forbidden: gm only" }, 403);
  }
  if (room.status === "finished") {
    return c.json({ error: "game already finished" }, 409);
  }
  if (["selecting", "first_selecting", "others_selecting"].includes(room.currentTurn?.phase ?? "")) {
    return c.json({ error: "a turn is already in progress" }, 409);
  }

  // 連続発動チェック（直近ターンがyesnoなら不可）
  const lastHistory = room.turnHistory.at(-1);
  if (lastHistory?.mode === "yesno") {
    return c.json({ error: "yesno event cannot be triggered consecutively" }, 409);
  }

  const turnNumber = (room.currentTurn?.turnNumber ?? 0) + 1;
  room.status = "in_progress";
  const turnData: TurnData = {
    turnNumber,
    mode: "yesno",
    phase: "selecting",
    choices: [],
    selections: {},
    yesnoSelections: {},
    startedAt: new Date(),
  };
  if (body.story !== undefined) turnData.story = body.story;
  room.currentTurn = turnData;

  await saveRoom(room, c.env.DB);

  try {
    await publishRoomEvent(c.env, {
      type: "yesno.started",
      roomId,
      at: new Date().toISOString(),
      payload: {
        turnNumber,
        mode: "yesno",
      },
    });
  } catch (error) {
    console.error("failed to publish yesno.started", error);
  }

  return c.json({ turnNumber, mode: "yesno", phase: "selecting" }, 200);
}

/**
 * POST /rooms/:roomId/turns/yesno/select
 * プレイヤーがYES/NOを投票する
 */
export async function handleSubmitYesNo(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  if (!room.currentTurn || room.currentTurn.mode !== "yesno" || room.currentTurn.phase !== "selecting") {
    return c.json({ error: "not in yesno selection phase" }, 409);
  }

  const body = await c.req.json<{ playerId: string; answer: "yes" | "no" }>();
  if (body.answer !== "yes" && body.answer !== "no") {
    return c.json({ error: "answer must be 'yes' or 'no'" }, 400);
  }
  const player = room.players.find((p) => p.id === body.playerId);
  if (!player || !player.alive) return c.json({ error: "player not found or bankrupt" }, 404);

  room.currentTurn.yesnoSelections[body.playerId] = body.answer;
  await saveRoom(room, c.env.DB);

  try {
    await publishRoomEvent(c.env, {
      type: "yesno.vote.submitted",
      roomId,
      at: new Date().toISOString(),
      payload: {
        turnNumber: room.currentTurn.turnNumber,
        playerId: body.playerId,
        submittedCount: Object.keys(room.currentTurn.yesnoSelections).length,
      },
    });
  } catch (error) {
    console.error("failed to publish yesno.vote.submitted", error);
  }

  const activePlayers = room.players.filter((p) => p.alive);
  const allSubmitted = activePlayers.every((p) => room.currentTurn!.yesnoSelections[p.id]);

  return c.json({ submitted: true, allSubmitted }, 200);
}

/**
 * POST /rooms/:roomId/turns/yesno/resolve
 * GMがYES/NOターンを解決する
 */
export async function handleResolveYesNo(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  if (!room.currentTurn || room.currentTurn.mode !== "yesno") {
    return c.json({ error: "no active yesno turn" }, 409);
  }

  const body = await c.req.json<{ gmPlayerId: string }>();
  if (body.gmPlayerId !== room.gmPlayerId) {
    return c.json({ error: "forbidden: gm only" }, 403);
  }

  const turn = room.currentTurn;
  const activePlayers = room.players.filter((p) => p.alive);

  // 未投票はデフォルトYES（仕様：社訓に従わないのは自己責任）
  const selections = { ...turn.yesnoSelections };
  for (const p of activePlayers) {
    if (!selections[p.id]) selections[p.id] = "yes";
  }

  const result = resolveYesNoEvent({ players: activePlayers, selections });

  for (const effect of result.applied) {
    const player = room.players.find((p) => p.id === effect.playerId);
    if (player) {
      player.money = effect.moneyAfter;
      player.alive = !effect.bankrupt;
    }
  }

  turn.yesnoResult = result;
  turn.phase = "resolved";
  turn.resolvedAt = new Date();

  const historyEntry: TurnHistoryEntry = {
    turnNumber: turn.turnNumber,
    mode: "yesno",
    yesnoResult: result,
  };
  room.turnHistory.push(historyEntry);

  const aliveCount = room.players.filter((p) => p.alive).length;
  const maxTurnsReached = turn.turnNumber >= room.settings.maxTurns;
  if (aliveCount <= 1 || maxTurnsReached || room.finalizationMode) {
    room.status = "finished";
  }

  await saveRoom(room, c.env.DB);

  try {
    await publishRoomEvent(c.env, {
      type: "yesno.resolved",
      roomId,
      at: new Date().toISOString(),
      payload: {
        turnNumber: turn.turnNumber,
        minoritySide: result.minoritySide,
      },
    });
  } catch (error) {
    console.error("failed to publish yesno.resolved", error);
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
    result: toYesNoResultView(turn.turnNumber, result),
    room: toRoomDetail(room),
  });
}
