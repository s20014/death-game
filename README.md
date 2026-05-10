# 少数派デスストーリー

AIが生成する身内ネタストーリーに対して、プレイヤーが3択を選ぶ心理戦パーティゲーム。  
**少数派を選んだプレイヤーがボーナスを得て、最終的に最も多くのお金を持ったプレイヤーが勝利。**

---

## ゲーム概要

| 項目       | 内容                     |
| ---------- | ------------------------ |
| プレイ人数 | 3〜20人（推奨 8〜15人）  |
| 初期所持金 | ¥1,000,000               |
| ターン数   | 8〜15ターン（GM設定）    |
| 勝利条件   | ターン終了時の最高所持金 |

ルールの詳細は [docs/rule.md](docs/rule.md) を参照。

---

## 技術スタック

| 用途               | 採用技術                                       |
| ------------------ | ---------------------------------------------- |
| ランタイム         | Cloudflare Workers                             |
| HTTPフレームワーク | [Hono](https://hono.dev/)                      |
| DB                 | Cloudflare D1 (SQLite) + Drizzle ORM           |
| リアルタイム通信   | Durable Objects (`RoomHub`) + WebSocket        |
| AI生成             | Workers AI (`llama-3.3-70b-instruct-fp8-fast`) |
| フロントエンド     | Vite + React + TypeScript                      |
| テスト             | Vitest                                         |

---

## セットアップ

```bash
# 依存パッケージのインストール
npm install
cd frontend && npm install && cd ..

# ローカル開発（Wrangler）
npm run dev

# フロントエンド開発サーバー
cd frontend && npm run dev

# ビルド
npm run build

# テスト
npm run test
```

### D1 マイグレーション（初回・ローカル）

```bash
npx wrangler d1 migrations apply DB --local
```

---

## デプロイ

```bash
npm run deploy
```

---

## プロジェクト構成

```
src/
├── worker.ts              Cloudflare Workers エントリーポイント
├── app.ts                 Hono アプリ組み立て
├── bindings.ts            Workers Bindings 型定義
│
├── models/
│   ├── types.ts            全ドメイン型定義
│   ├── schema.ts           Drizzle ORM スキーマ
│   └── room.store.ts       D1 永続化クエリ
│
├── controllers/
│   ├── room.controller.ts  ルーム・プレイヤー状態
│   ├── turn.controller.ts  通常ターン
│   ├── yesno.controller.ts YES/NO イベント
│   ├── story.controller.ts ストーリーモード
│   └── generate.controller.ts AI 問題生成
│
├── durable/
│   ├── RoomHub.ts          Durable Objects (WebSocket ブロードキャスト)
│   └── roomHub.client.ts   RoomHub クライアント
│
├── services/
│   └── engine.service.ts   少数派判定・効果計算
│
├── views/
│   └── room.view.ts        レスポンス整形
│
├── routes/
│   └── room.routes.ts      URL ↔ コントローラー マッピング
│
└── story/
    └── scenarios/index.ts  手書きシナリオデータ

frontend/                   Vite + React フロントエンド
migrations/                 D1 マイグレーション SQL
```

---

## ゲームモード

### 通常モード

GM が AI 生成（または手動）で問題を作成し、全員が同時に3択投票する。少数派がボーナスを得る。

### YES/NO モード

特殊イベント「迷ったらYES」。全員が YES か NO を選び、多数派・少数派で効果が変わる。

### ストーリーモード

GMが手書きシナリオを起動。所持金1位のプレイヤーが専用の選択をし、その結果に応じてその他のプレイヤーへの選択肢が変化する。ターンを通じてスコアが積まれ、最終的に happy / normal / bad のエンディングが決まる。

---

## 少数派判定ルール

- 最少得票の選択肢 → **少数派**（同数なら全て少数派）
- 1人だけ選択 → **少数ボーナス×2**
- 全選択肢同数 → **全員に場イベント（デフォルト -¥50,000）**

### 逆転補正（所持金が低いほど少数ボーナスが強い）

| 所持金            | 少数ボーナス倍率 |
| ----------------- | ---------------- |
| ¥500,000 以上     | ×1.0             |
| ¥200,000〜499,999 | ×1.3             |
| ¥199,999 以下     | ×1.6             |
