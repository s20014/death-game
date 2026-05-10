import type { Context } from "hono";
import { createRoom, getRoom, joinRoom, saveRoom } from "../models/room.store.js";
import type { CreateRoomInput } from "../models/room.store.js";
import type { AppBindings } from "../bindings.js";
import { connectRoomHub, publishRoomEvent } from "../durable/roomHub.client.js";
import { toRoomDetail, toRoomSummary, toTurnResultView, toYesNoResultView } from "../views/room.view.js";
import { SCENARIO } from "../story/scenarios/index.js";

type AppContext = Context<{ Bindings: AppBindings }>;

function requireParam(c: AppContext, name: string): string | null {
  const val = c.req.param(name);
  return val ?? null;
}

/**
 * POST /rooms
 * ルームを新規作成し、GMプレイヤーIDを返す
 */
export async function handleCreateRoom(c: AppContext) {
  const body = await c.req.json<{
    gmPlayerName: string;
    settings?: { maxTurns?: number; selectionTimeoutSec?: number };
  }>();

  if (!body.gmPlayerName?.trim()) {
    return c.json({ error: "gmPlayerName is required" }, 400);
  }

  const input: CreateRoomInput = { gmPlayerName: body.gmPlayerName.trim() };
  if (body.settings !== undefined) {
    const maxTurns = body.settings.maxTurns;
    if (maxTurns !== undefined && (maxTurns < 1 || maxTurns > 10 || !Number.isInteger(maxTurns))) {
      return c.json({ error: "maxTurns must be an integer between 1 and 10" }, 400);
    }
    input.settings = body.settings;
  }

  const room = await createRoom(input, c.env.DB);
  return c.json(
    {
      room: toRoomSummary(room),
      gmPlayerId: room.gmPlayerId,
    },
    201,
  );
}

/**
 * POST /rooms/:roomId/join
 * ルームに参加し、プレイヤーIDを返す
 */
export async function handleJoinRoom(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);

  const body = await c.req.json<{ playerName: string }>();
  if (!body.playerName?.trim()) {
    return c.json({ error: "playerName is required" }, 400);
  }

  const result = await joinRoom({ roomId, playerName: body.playerName.trim() }, c.env.DB);
  if (!result) {
    return c.json({ error: "room not found or not in waiting state" }, 404);
  }

  return c.json({ room: toRoomSummary(result.room), playerId: result.player.id }, 200);
}

/**
 * GET /rooms/:roomId
 * ルームの詳細情報を返す（ランキング付きプレイヤー一覧含む）
 */
export async function handleGetRoom(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  return c.json(toRoomDetail(room));
}

/**
 * GET /rooms/:roomId/ws
 * ルーム単位のWebSocketへ接続する
 */
export async function handleRoomWs(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);

  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);

  return connectRoomHub(c.env, roomId, c.req.raw);
}

/**
 * GET /rooms/:roomId/player-state?playerId=...
 * プレイヤー向け状態を返す（GM専用情報は含めない）
 */
export async function handlePlayerState(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);

  const playerId = c.req.query("playerId");
  if (!playerId) return c.json({ error: "playerId is required" }, 400);

  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);

  const me = room.players.find((p) => p.id === playerId);
  if (!me) return c.json({ error: "player not found" }, 404);

  let currentTurn: Record<string, unknown> | null = null;
  if (room.currentTurn) {
    const turn = room.currentTurn;
    if (turn.mode === "story") {
      const storyData = turn.storyData;
      const progress = room.storyProgress;
      const isFirstPlayer = storyData?.firstPlayerId === playerId;

      let question: string | undefined;
      let choices: Array<{ id: string; text: string; moneyEffect?: { type: string; amount?: number; description: string } }> | undefined;
      let mySelection: string | undefined;

      if (turn.phase === "first_selecting" && isFirstPlayer) {
        const turnDef = progress !== undefined ? SCENARIO[progress.currentTurnIndex] : undefined;
        question = turnDef?.firstScene.question;
        choices = turnDef?.firstScene.choices.map((c) => ({ id: c.id, text: c.text }));
        mySelection = storyData?.firstSelection;
      } else if (turn.phase === "others_selecting" && !isFirstPlayer) {
        const turnDef = progress !== undefined ? SCENARIO[progress.currentTurnIndex] : undefined;
        const firstChoiceId = storyData?.firstSelection;
        const othersScene = firstChoiceId ? turnDef?.othersScenes[firstChoiceId] : undefined;
        question = othersScene?.question;
        choices = othersScene?.choices.map((c) => ({
          id: c.id,
          text: c.text,
          ...(c.moneyEffect !== undefined ? { moneyEffect: c.moneyEffect } : {}),
        }));
        mySelection = storyData?.othersSelections[playerId];
      }

      currentTurn = {
        turnNumber: turn.turnNumber,
        mode: "story",
        phase: turn.phase,
        story: turn.story,
        storyTurn: {
          isFirstPlayer,
          firstPlayerId: storyData?.firstPlayerId ?? "",
          question,
          choices,
          mySelection,
          storyResult: storyData?.storyResult ?? null,
        },
      };
    } else {
      currentTurn = {
        turnNumber: turn.turnNumber,
        mode: turn.mode,
        phase: turn.phase,
        story: turn.story,
        choices:
          turn.mode === "normal"
            ? turn.choices.map((choice) => ({
                id: choice.id,
                text: choice.text,
                amount: choice.amount ?? 0,
                ...(choice.resultStory ? { resultStory: choice.resultStory } : {}),
              }))
            : undefined,
        mySelection:
          turn.mode === "normal"
            ? turn.selections[playerId]
            : turn.yesnoSelections[playerId],
        result:
          turn.phase === "resolved"
            ? turn.mode === "normal" && turn.result
              ? toTurnResultView(turn.turnNumber, turn.result)
              : turn.mode === "yesno" && turn.yesnoResult
                ? toYesNoResultView(turn.turnNumber, turn.yesnoResult)
                : null
            : null,
      };
    }
  }

  return c.json({
    room: toRoomSummary(room),
    me,
    currentTurn,
  });
}

/**
 * GET /rooms/:roomId/gm-state?gmPlayerId=...
 * GM向け状態を返す（途中集計と未投票者を含む）
 */
export async function handleGmState(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);

  const gmPlayerId = c.req.query("gmPlayerId");
  if (!gmPlayerId) return c.json({ error: "gmPlayerId is required" }, 400);

  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  if (room.gmPlayerId !== gmPlayerId) return c.json({ error: "forbidden: gm only" }, 403);

  const activePlayerIds = room.players.filter((player) => player.alive).map((player) => player.id);

  let currentTurn: Record<string, unknown> | null = null;

  if (room.currentTurn) {
    if (room.currentTurn.mode === "normal") {
      const counts = Object.fromEntries(room.currentTurn.choices.map((choice) => [choice.id, 0])) as Record<
        string,
        number
      >;
      for (const selected of Object.values(room.currentTurn.selections)) {
        if (counts[selected] !== undefined) counts[selected] += 1;
      }

      const unsubmittedPlayerIds = activePlayerIds.filter((id) => !room.currentTurn!.selections[id]);

      currentTurn = {
        turnNumber: room.currentTurn.turnNumber,
        mode: room.currentTurn.mode,
        phase: room.currentTurn.phase,
        story: room.currentTurn.story,
        choices: room.currentTurn.choices.map((choice) => ({
          id: choice.id,
          text: choice.text,
          amount: choice.amount ?? 0,
          ...(choice.resultStory ? { resultStory: choice.resultStory } : {}),
        })),
        counts,
        unsubmittedPlayerIds,
      };
    } else if (room.currentTurn.mode === "story") {
      const storyData = room.currentTurn.storyData;
      const alivePlayers = room.players.filter((p) => p.alive);
      const othersAlive = alivePlayers.filter((p) => p.id !== storyData?.firstPlayerId);
      const othersSubmitted = othersAlive.filter((p) => !!storyData?.othersSelections[p.id]);

      currentTurn = {
        turnNumber: room.currentTurn.turnNumber,
        mode: "story",
        phase: room.currentTurn.phase,
        story: room.currentTurn.story,
        storyGm: {
          firstPlayerId: storyData?.firstPlayerId ?? "",
          firstPlayerName: room.players.find((p) => p.id === storyData?.firstPlayerId)?.name ?? "",
          firstSelectionSubmitted: !!storyData?.firstSelection,
          firstChoiceId: storyData?.firstSelection ?? null,
          othersAliveCount: othersAlive.length,
          othersSubmittedCount: othersSubmitted.length,
        },
      };
    } else {
      const counts = { yes: 0, no: 0 };
      for (const selected of Object.values(room.currentTurn.yesnoSelections)) {
        if (selected === "yes") counts.yes += 1;
        if (selected === "no") counts.no += 1;
      }

      const unsubmittedPlayerIds = activePlayerIds.filter((id) => !room.currentTurn!.yesnoSelections[id]);

      currentTurn = {
        turnNumber: room.currentTurn.turnNumber,
        mode: room.currentTurn.mode,
        phase: room.currentTurn.phase,
        story: room.currentTurn.story,
        counts,
        unsubmittedPlayerIds,
      };
    }
  }

  return c.json({
    room: toRoomDetail(room),
    currentTurn,
    storyProgress: room.storyProgress ?? null,
  });
}

/**
 * GET /rooms/:roomId/log-state
 * 観戦/ログ画面向け状態を返す（公開情報のみ）
 */
export async function handleLogState(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);

  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);

  const recentHistory = room.turnHistory.slice(-5).map((turn) =>
    turn.mode === "normal" && turn.result
      ? toTurnResultView(turn.turnNumber, turn.result)
      : turn.mode === "yesno" && turn.yesnoResult
        ? toYesNoResultView(turn.turnNumber, turn.yesnoResult)
        : null,
  );

  return c.json({
    room: toRoomDetail(room),
    currentTurn: room.currentTurn
      ? {
          turnNumber: room.currentTurn.turnNumber,
          mode: room.currentTurn.mode,
          phase: room.currentTurn.phase,
          story: room.currentTurn.story,
          result:
            room.currentTurn.phase === "resolved"
              ? room.currentTurn.mode === "normal" && room.currentTurn.result
                ? toTurnResultView(room.currentTurn.turnNumber, room.currentTurn.result)
                : room.currentTurn.mode === "yesno" && room.currentTurn.yesnoResult
                  ? toYesNoResultView(room.currentTurn.turnNumber, room.currentTurn.yesnoResult)
                  : null
              : null,
        }
      : null,
    recentHistory,
  });
}

/**
 * POST /rooms/:roomId/reset
 * GMがルームを待機状態にリセット（全員が待機画面に戻る）
 */
export async function handleResetRoom(c: AppContext) {
  const roomId = requireParam(c, "roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);

  const body = await c.req.json<{ gmPlayerId: string }>();
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  if (room.gmPlayerId !== body.gmPlayerId) return c.json({ error: "forbidden: gm only" }, 403);

  room.status = "waiting";
  delete room.currentTurn;
  room.turnHistory = [];
  delete room.storyProgress;
  room.finalizationMode = false;
  for (const p of room.players) {
    p.money = 0;
    p.alive = true;
  }

  await saveRoom(room, c.env.DB);

  try {
    await publishRoomEvent(c.env, {
      type: "room.reset",
      roomId,
      at: new Date().toISOString(),
      payload: {},
    });
  } catch (err) {
    console.error("failed to publish room.reset", err);
  }

  return c.json({ message: "room reset" });
}
