import type { AppBindings } from "../bindings.js";

export type RoomEventType =
  | "turn.started"
  | "turn.vote.submitted"
  | "turn.resolved"
  | "yesno.started"
  | "yesno.vote.submitted"
  | "yesno.resolved"
  | "room.finalization.updated"
  | "room.finished"
  | "story.started"
  | "story.first.submitted"
  | "story.others.started"
  | "story.others.submitted"
  | "story.turn.resolved";

export type RoomEvent = {
  type: RoomEventType;
  roomId: string;
  at: string;
  payload: Record<string, unknown>;
};

function getRoomHubStub(env: AppBindings, roomId: string): DurableObjectStub {
  const id = env.ROOM_HUB.idFromName(roomId);
  return env.ROOM_HUB.get(id);
}

export async function connectRoomHub(env: AppBindings, roomId: string, request: Request): Promise<Response> {
  const stub = getRoomHubStub(env, roomId);
  return stub.fetch(request);
}

export async function publishRoomEvent(env: AppBindings, event: RoomEvent): Promise<void> {
  const stub = getRoomHubStub(env, event.roomId);
  await stub.fetch("https://room.internal/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
}
