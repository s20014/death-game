# death-game プロジェクトルール

## 概要

Cloudflare Workers + Hono + D1 + Durable Objects で構築するリアルタイムマルチプレイヤーゲームのバックエンド。
フロントエンドは Vite (frontend/) で別ビルド。

## 技術スタック

| 領域 | 技術 |
|---|---|
| ランタイム | Cloudflare Workers |
| フレームワーク | Hono |
| DB | Cloudflare D1 (SQLite) |
| リアルタイム | Durable Objects (`RoomHub`) |
| ORM | Drizzle ORM |
| フロントエンド | Vite |
| テスト | Vitest |
| 言語 | TypeScript |

## ディレクトリ構成

```
src/
  app.ts          # Honoアプリ定義
  worker.ts       # Cloudflare Workersエントリーポイント
  server.ts       # Node.js用ローカル開発サーバー
  bindings.ts     # Workers Bindings の型定義
  controllers/    # リクエスト処理
  models/         # DBスキーマ・クエリ
  routes/         # ルーティング定義
  services/       # ビジネスロジック
  views/          # レスポンス整形
  durable/        # Durable Objects クラス (RoomHub 等)
frontend/         # Viteフロントエンド (独立ビルド)
migrations/       # D1マイグレーションSQL
```

## よく使うコマンド

```bash
npm run dev        # ローカル開発 (wrangler dev)
npm run dev:node   # Node.jsで起動 (tsx watch)
npm run build      # TypeScriptビルド
npm run test       # Vitestでテスト実行
npm run deploy     # Cloudflare Workersにデプロイ
```

## 開発上の注意

- Cloudflare Workers 環境は Node.js と互換性がない API がある。`node:*` モジュールは使用不可の場合あり
- D1 へのアクセスは `c.env.DB` (Hono の Context 経由)
- Durable Objects のバインディングは `c.env.ROOM_HUB`
- マイグレーションは `migrations/` に SQL ファイルを追加し `wrangler d1 migrations apply` で適用
- `bindings.ts` に Workers Bindings の型を定義して Hono の型引数に渡す
