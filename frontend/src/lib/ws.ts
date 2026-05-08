// WebSocketクライアント

export type WsEvent = {
  type: string;
  roomId: string;
  [key: string]: unknown;
};

export type WsHandler = (event: WsEvent) => void;

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
function wsBase(): string {
  return API_BASE.replace(/^http/, 'ws');
}

export function connectRoomWs(
  roomId: string,
  onEvent: WsHandler,
  onClose?: () => void,
): () => void {
  let ws: WebSocket;
  let closed = false;

  function connect() {
    if (closed) return;
    ws = new WebSocket(`${wsBase()}/rooms/${roomId}/ws`);

    ws.addEventListener('message', (e) => {
      try {
        const data = JSON.parse(e.data as string) as WsEvent;
        onEvent(data);
      } catch {
        // ignore parse errors
      }
    });

    ws.addEventListener('close', () => onClose?.());
  }

  connect();

  return () => {
    closed = true;
    ws?.close();
  };
}
