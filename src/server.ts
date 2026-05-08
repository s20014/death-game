// 【役割】Node.js サーバーの起動エントリーポイント
// `npm run dev` / `npm start` で最初に読み込まれるファイル。
// ポート設定と起動ログのみを担う。アプリロジックは app.ts に分離されているため、
// 環境を Cloudflare Workers / Bun / Deno に変える場合はこのファイルだけ修正すればよい。

import { serve } from "@hono/node-server";
import app from "./app.js";

const PORT = Number(process.env["PORT"] ?? 3000);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`🎮 death-game server started at http://localhost:${info.port}`);
});
