// 【役割】Hono アプリの組み立て
// ミドルウェア（CORS・ロガー）の登録、ルートのマウント、エラーハンドリングを一箇所で管理する。
// server.ts からは `app.fetch` だけを受け取るため、HTTP の関心事がここに集約される。

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { roomRouter } from "./routes/room.routes.js";
import type { AppBindings } from "./bindings.js";

const app = new Hono<{ Bindings: AppBindings }>();

app.use("*", logger());
app.use("*", cors({ origin: "*" }));

app.get("/", (c) =>
  c.json({
    name: "death-game-api",
    status: "ok",
    docs: {
      health: "/health",
      rooms: "/rooms",
    },
  }),
);

app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

app.route("/rooms", roomRouter);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal server error" }, 500);
});

export default app;
