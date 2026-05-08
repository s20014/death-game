// このコードは生成AIによって生成されました。
// D1アクセスはDrizzle ORM経由に統一する。
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  playersTable,
  roomsTable,
  turnsTable,
} from "./schema.js";
import type {
  InsideJokeConfig,
  MoneyEffect,
  PlayerState,
  Room,
  RoomSettings,
  TurnData,
  TurnHistoryEntry,
  TurnMode,
  TurnPhase,
} from "./types.js";

const DEFAULT_SETTINGS: RoomSettings = {
  maxTurns: 10,
  selectionTimeoutSec: 20,
  unselectedBehavior: "random",
};

const store = new Map<string, Room>();

export type CreateRoomInput = {
  gmPlayerName: string;
  settings?: Partial<RoomSettings>;
  insideJokeConfig?: InsideJokeConfig;
  allChoicesEqualEvent?: MoneyEffect;
};

async function saveRoomToD1(room: Room, db: D1Database): Promise<void> {
  const d1 = drizzle(db);

  await d1
    .insert(roomsTable)
    .values({
      id: room.id,
      gmPlayerId: room.gmPlayerId,
      status: room.status,
      settingsJson: JSON.stringify(room.settings),
    stateJson: JSON.stringify({ storyProgress: room.storyProgress ?? null }),
      insideJokeConfigJson: room.insideJokeConfig ? JSON.stringify(room.insideJokeConfig) : null,
      finalizationMode: room.finalizationMode ? 1 : 0,
      allChoicesEqualEventJson: room.allChoicesEqualEvent ? JSON.stringify(room.allChoicesEqualEvent) : null,
      createdAt: room.createdAt.toISOString(),
    })
    .onConflictDoUpdate({
      target: roomsTable.id,
      set: {
        gmPlayerId: room.gmPlayerId,
        status: room.status,
        settingsJson: JSON.stringify(room.settings),
      stateJson: JSON.stringify({ storyProgress: room.storyProgress ?? null }),
        insideJokeConfigJson: room.insideJokeConfig ? JSON.stringify(room.insideJokeConfig) : null,
        finalizationMode: room.finalizationMode ? 1 : 0,
        allChoicesEqualEventJson: room.allChoicesEqualEvent ? JSON.stringify(room.allChoicesEqualEvent) : null,
        createdAt: room.createdAt.toISOString(),
      },
    });

  await d1.delete(playersTable).where(eq(playersTable.roomId, room.id));
  await d1.delete(turnsTable).where(eq(turnsTable.roomId, room.id));

  if (room.players.length > 0) {
    await d1.insert(playersTable).values(
      room.players.map((player) => ({
        id: player.id,
        roomId: room.id,
        name: player.name,
        money: player.money,
        alive: player.alive ? 1 : 0,
        createdAt: room.createdAt.toISOString(),
      })),
    );
  }

  const turnMap = new Map<number, Room["currentTurn"]>();
  for (const history of room.turnHistory) {
    const historyTurn: TurnData = {
      turnNumber: history.turnNumber,
      mode: history.mode,
      phase: "resolved",
      choices: [],
      selections: {},
      yesnoSelections: {},
      startedAt: room.createdAt,
      resolvedAt: room.createdAt,
    };
    if (history.story !== undefined) historyTurn.story = history.story;
    if (history.result !== undefined) historyTurn.result = history.result;
    if (history.yesnoResult !== undefined) historyTurn.yesnoResult = history.yesnoResult;
    turnMap.set(history.turnNumber, historyTurn);
  }
  if (room.currentTurn) {
    turnMap.set(room.currentTurn.turnNumber, room.currentTurn);
  }

  const turns = Array.from(turnMap.values()).filter((turn): turn is NonNullable<typeof turn> => turn !== undefined);
  if (turns.length > 0) {
    await d1.insert(turnsTable).values(
      turns.map((turn) => ({
        roomId: room.id,
        turnNumber: turn.turnNumber,
        mode: turn.mode,
        phase: turn.phase,
        story: turn.story ?? null,
        choicesJson: turn.choices.length > 0 ? JSON.stringify(turn.choices) : null,
        selectionsJson: Object.keys(turn.selections).length > 0 ? JSON.stringify(turn.selections) : null,
        yesnoSelectionsJson:
          Object.keys(turn.yesnoSelections).length > 0 ? JSON.stringify(turn.yesnoSelections) : null,
        resultJson: turn.result ? JSON.stringify(turn.result) : null,
        yesnoResultJson: turn.yesnoResult ? JSON.stringify(turn.yesnoResult) : null,
        storyDataJson: turn.storyData ? JSON.stringify(turn.storyData) : null,
        startedAt: turn.startedAt.toISOString(),
        resolvedAt: turn.resolvedAt ? turn.resolvedAt.toISOString() : null,
      })),
    );
  }
}

async function getRoomFromD1(roomId: string, db: D1Database): Promise<Room | undefined> {
  const d1 = drizzle(db);

  const roomRows = await d1.select().from(roomsTable).where(eq(roomsTable.id, roomId)).limit(1);
  const roomRow = roomRows[0];
  if (!roomRow) return undefined;

  const playerRows = await d1.select().from(playersTable).where(eq(playersTable.roomId, roomId));
  const turnRows = await d1
    .select()
    .from(turnsTable)
    .where(eq(turnsTable.roomId, roomId))
    .orderBy(asc(turnsTable.turnNumber));

  const players = playerRows.map((row) => ({
    id: row.id,
    name: row.name,
    money: row.money,
    alive: row.alive === 1,
  }));

  const turns = turnRows.map((row) => {
    const turn: TurnData = {
      turnNumber: row.turnNumber,
      mode: row.mode as TurnMode,
      phase: row.phase as TurnPhase,
      choices: row.choicesJson ? JSON.parse(row.choicesJson) : [],
      selections: row.selectionsJson ? JSON.parse(row.selectionsJson) : {},
      yesnoSelections: row.yesnoSelectionsJson ? JSON.parse(row.yesnoSelectionsJson) : {},
      startedAt: new Date(row.startedAt),
    };
    if (row.story !== null) turn.story = row.story;
    if (row.resultJson !== null) turn.result = JSON.parse(row.resultJson);
    if (row.yesnoResultJson !== null) turn.yesnoResult = JSON.parse(row.yesnoResultJson);
    if (row.storyDataJson !== null) turn.storyData = JSON.parse(row.storyDataJson);
    if (row.resolvedAt !== null) turn.resolvedAt = new Date(row.resolvedAt);
    return turn;
  });

  const currentTurn = turns.length > 0 ? turns.at(-1) : undefined;
  const turnHistory: TurnHistoryEntry[] = turns
    .filter((turn) => turn.phase === "resolved")
    .map((turn) => {
      const entry: TurnHistoryEntry = {
        turnNumber: turn.turnNumber,
        mode: turn.mode,
      };
      if (turn.story !== undefined) entry.story = turn.story;
      if (turn.result !== undefined) entry.result = turn.result;
      if (turn.yesnoResult !== undefined) entry.yesnoResult = turn.yesnoResult;
      return entry;
    });

  const room: Room = {
    id: roomRow.id,
    gmPlayerId: roomRow.gmPlayerId,
    players,
    settings: JSON.parse(roomRow.settingsJson),
    status: roomRow.status as Room["status"],
    turnHistory,
    finalizationMode: roomRow.finalizationMode === 1,
    createdAt: new Date(roomRow.createdAt),
  };

  if (roomRow.insideJokeConfigJson) {
    room.insideJokeConfig = JSON.parse(roomRow.insideJokeConfigJson);
  }
  if (currentTurn !== undefined) {
    room.currentTurn = currentTurn;
  }
  if (roomRow.allChoicesEqualEventJson) {
    room.allChoicesEqualEvent = JSON.parse(roomRow.allChoicesEqualEventJson);
  }
  const state = JSON.parse(roomRow.stateJson) as { storyProgress?: Room["storyProgress"] };
  if (state.storyProgress) {
    room.storyProgress = state.storyProgress;
  }

  return room;
}

export async function createRoom(input: CreateRoomInput, db?: D1Database): Promise<Room> {
  const roomId = crypto.randomUUID();
  const gmPlayerId = crypto.randomUUID();

  const room: Room = {
    id: roomId,
    gmPlayerId,
    players: [{ id: gmPlayerId, name: input.gmPlayerName, money: 1_000_000, alive: true }],
    settings: { ...DEFAULT_SETTINGS, ...input.settings },
    status: "waiting",
    turnHistory: [],
    finalizationMode: false,
    createdAt: new Date(),
  };
  if (input.insideJokeConfig !== undefined) room.insideJokeConfig = input.insideJokeConfig;
  if (input.allChoicesEqualEvent !== undefined) room.allChoicesEqualEvent = input.allChoicesEqualEvent;

  if (db) {
    await saveRoomToD1(room, db);
  } else {
    store.set(roomId, room);
  }

  return room;
}

export type JoinRoomInput = {
  roomId: string;
  playerName: string;
};

export async function joinRoom(
  input: JoinRoomInput,
  db?: D1Database,
): Promise<{ room: Room; player: PlayerState } | null> {
  const room = db ? await getRoomFromD1(input.roomId, db) : store.get(input.roomId);
  if (!room || room.status !== "waiting") return null;

  const player: PlayerState = {
    id: crypto.randomUUID(),
    name: input.playerName,
    money: 1_000_000,
    alive: true,
  };
  room.players.push(player);

  if (db) {
    await saveRoomToD1(room, db);
  } else {
    store.set(room.id, room);
  }

  return { room, player };
}

export async function getRoom(roomId: string, db?: D1Database): Promise<Room | undefined> {
  if (db) return getRoomFromD1(roomId, db);
  return store.get(roomId);
}

export async function saveRoom(room: Room, db?: D1Database): Promise<void> {
  if (db) {
    await saveRoomToD1(room, db);
    return;
  }

  store.set(room.id, room);
}

export async function listRooms(db?: D1Database): Promise<Room[]> {
  if (!db) return Array.from(store.values());

  const rows = await drizzle(db).select({ id: roomsTable.id }).from(roomsTable);
  const rooms = await Promise.all(rows.map((row) => getRoomFromD1(row.id, db)));
  return rooms.filter((room): room is Room => room !== undefined);
}
