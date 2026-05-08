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

| 用途               | 採用技術                                    |
| ------------------ | ------------------------------------------- |
| 言語               | TypeScript 6                                |
| HTTPフレームワーク | [Hono](https://hono.dev/)                   |
| ランタイム         | Node.js（`@hono/node-server`）              |
| テスト             | [Vitest](https://vitest.dev/)               |
| 実行（開発）       | [tsx](https://github.com/privatenumber/tsx) |

---

## セットアップ

```bash
# 依存パッケージのインストール
npm install

# 開発サーバー起動（ホットリロード付き）
npm run dev

# ビルド
npm run build

# 本番起動
npm start
```

デフォルトのポートは `3000`。`PORT` 環境変数で変更可能。

```bash
PORT=8080 npm run dev
```

---

## テスト

```bash
# 1回実行
npm test

# ウォッチモード
npm run test:watch
```

---

## プロジェクト構成

```
src/
├── server.ts              Nodeサーバーの起動
├── app.ts                 Honoアプリ組み立て（ミドルウェア・ルートマウント）
│
├── models/                [M] データ層
│   ├── types.ts            全ドメイン型定義
│   └── room.store.ts       インメモリストア（将来DB差し替え可）
│
├── services/              ビジネスロジック層（HTTP非依存）
│   └── engine.service.ts   少数派判定・効果計算・YES/NO解決
│
├── views/                 [V] プレゼンテーション層
│   └── room.view.ts        レスポンスJSON整形・¥フォーマット・ランキング
│
├── controllers/           [C] HTTPハンドラ
│   ├── room.controller.ts  ルーム作成・参加・取得
│   ├── turn.controller.ts  通常ターン開始・投票・解決・決着モード
│   └── yesno.controller.ts YES/NOイベント発動・投票・解決
│
└── routes/
    └── room.routes.ts      URLとコントローラーのマッピング

test/
└── engine.test.ts         ゲームロジック単体テスト
```

---

## API リファレンス

### ルーム管理

#### `POST /rooms` — ルーム作成

```json
// リクエスト
{
  "gmPlayerName": "たぬき",
  "settings": { "maxTurns": 10, "selectionTimeoutSec": 20 }
}

// レスポンス 201
{
  "room": { "id": "...", "status": "waiting", ... },
  "gmPlayerId": "gm-player-uuid"
}
```

#### `POST /rooms/:roomId/join` — 参加

```json
// リクエスト
{ "playerName": "さくら" }

// レスポンス 200
{
  "room": { ... },
  "playerId": "player-uuid"
}
```

#### `GET /rooms/:roomId` — ルーム詳細取得

ランキング付きプレイヤー一覧・現在ターン情報を返す。

---

### 通常ターン進行

#### `POST /rooms/:roomId/turns` — ターン開始（GM専用）

```json
{
  "gmPlayerId": "...",
  "story": "深夜のラーメン屋に到着した一行。次の行動は？",
  "choices": [
    {
      "id": "c1",
      "text": "ラーメンを食べる",
      "riskLevel": "low",
      "mainEffect": { "type": "lose", "amount": 50000, "description": "出費" },
      "minorityBonus": {
        "type": "gain",
        "amount": 100000,
        "description": "貴重な体験"
      }
    },
    {
      "id": "c2",
      "text": "断る",
      "riskLevel": "low",
      "mainEffect": { "type": "gain", "amount": 50000, "description": "節約" },
      "minorityBonus": {
        "type": "gain",
        "amount": 150000,
        "description": "睡眠は金なり"
      }
    },
    {
      "id": "c3",
      "text": "全員に奢る",
      "riskLevel": "high",
      "mainEffect": {
        "type": "lose",
        "amount": 300000,
        "description": "大出費"
      },
      "minorityBonus": {
        "type": "gamble",
        "minAmount": 300000,
        "maxAmount": 400000,
        "description": "ヒーロー扱い"
      }
    }
  ]
}
```

#### `POST /rooms/:roomId/turns/select` — 選択投票

```json
{ "playerId": "...", "choiceId": "c1" }
```

#### `POST /rooms/:roomId/turns/resolve` — ターン解決（GM専用）

```json
{ "gmPlayerId": "..." }
```

レスポンスに少数派判定結果・所持金変動・全員の選択内容が含まれる。

#### `POST /rooms/:roomId/finalize` — 決着モード切替（GM専用）

```json
{ "gmPlayerId": "...", "enabled": true }
```

次ターン終了時に最高所持金プレイヤーが即勝者になる。

---

### YES/NO 特殊イベント「迷ったらYES」

社訓を知っているのに NO を選ぶと少数派でもボーナスなし。

| 選択 | 区分   | 効果                      |
| ---- | ------ | ------------------------- |
| YES  | 多数派 | +¥100,000                 |
| YES  | 少数派 | +¥250,000                 |
| NO   | 多数派 | -¥150,000                 |
| NO   | 少数派 | -¥150,000（ボーナスなし） |

#### `POST /rooms/:roomId/turns/yesno` — イベント発動（GM専用）

```json
{ "gmPlayerId": "...", "story": "上司から『もう一軒行くぞ！』と声がかかった。" }
```

#### `POST /rooms/:roomId/turns/yesno/select` — YES/NO投票

```json
{ "playerId": "...", "answer": "yes" }
```

#### `POST /rooms/:roomId/turns/yesno/resolve` — 解決（GM専用）

```json
{ "gmPlayerId": "..." }
```

---

## ゲームフロー

```
GM: POST /rooms               → roomId と gmPlayerId を取得
各プレイヤー: POST /rooms/:id/join  → playerId を取得

【ターン繰り返し】
GM: POST /rooms/:id/turns          → ストーリーと選択肢を提示
各プレイヤー: POST .../select       → 選択肢を投票（制限時間内）
GM: POST .../resolve               → 集計・効果適用・結果公開

【任意】
GM: POST .../yesno               → YES/NO特殊イベント発動
各プレイヤー: POST .../yesno/select
GM: POST .../yesno/resolve

【終了条件】
- 設定ターン数到達
- 生存者1人
- GM が finalize モードをON → 次ターン終了で即決着
```

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

### 効果タイプ

| タイプ   | 動作                                           |
| -------- | ---------------------------------------------- |
| `gain`   | 固定額を獲得                                   |
| `lose`   | 固定額を失う                                   |
| `gamble` | `minAmount`〜`maxAmount` のランダム獲得        |
| `event`  | 現在所持金の `rate` 割合で増減（格差逆転効果） |
