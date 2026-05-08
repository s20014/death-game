export class RoomHub {
  constructor(private readonly state: DurableObjectState) {}

  private broadcast(raw: string | ArrayBuffer): void {
    for (const socket of this.state.getWebSockets()) {
      socket.send(raw);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/publish") {
      const body = await request.text();
      this.broadcast(body);
      return new Response(null, { status: 204 });
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    for (const socket of this.state.getWebSockets()) {
      if (socket !== ws) {
        socket.send(message);
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    ws.close(1000, "closed");
  }
}
