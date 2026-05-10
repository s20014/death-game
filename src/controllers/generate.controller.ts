import type { Context } from "hono";
import type { AppBindings } from "../bindings.js";
import { getRoom } from "../models/room.store.js";

type AppContext = Context<{ Bindings: AppBindings }>;

type GeneratedTurn = {
  story: string;
  choices: { id: string; text: string; resultStory: { majority: string; minority: string } }[];
};

const PROMPT = `あなたはMINORITY MONEYというお金ゲームの進行AIです。
参加者が3択から1つを選び、「最も少ない人数だったグループ」が賞金を獲得するゲームです。

重要なルール：
- story（状況説明）では、どの選択肢が得か・何が入っているかを絶対に言ってはいけない
- storyは「何を選ぶかの状況設定」だけを書く（結果は不明なまま）
- resultStoryで、選んだ後に「少数派だったから賞金を得た」「多数派だったから逃した」という因果を書く

お金にまつわるシナリオ例：
- 三つの宝箱（中身は開けてみるまでわからない）
- 競馬の馬を選ぶ
- 株・投資先を選ぶ
- 怪しい取引・オークション
- 宝くじ・ガチャ

必ず以下のJSON形式のみで返してください（マークダウン不要、JSONのみ）：
{
  "story": "状況説明（2〜3文。何を選ぶかの場面設定のみ。結果・中身には触れない）",
  "choices": [
    {
      "id": "a",
      "text": "選択肢A（10文字以内）",
      "resultStory": {
        "majority": "多数派だった場合の結末（1文。同じものを選んだ人が多く、賞金を逃したストーリー）",
        "minority": "少数派だった場合の結末（1文。この選択をした人が少なく、賞金を得たストーリー）"
      }
    },
    {
      "id": "b",
      "text": "選択肢B（10文字以内）",
      "resultStory": {
        "majority": "多数派だった場合の結末（1文）",
        "minority": "少数派だった場合の結末（1文）"
      }
    },
    {
      "id": "c",
      "text": "選択肢C（10文字以内）",
      "resultStory": {
        "majority": "多数派だった場合の結末（1文）",
        "minority": "少数派だった場合の結末（1文）"
      }
    }
  ]
}`;

function extractJson(raw: string): string {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match?.[1]) return match[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1) return raw.slice(start, end + 1);
  return raw.trim();
}

export async function handleGenerateTurn(c: AppContext) {
  const roomId = c.req.param("roomId");
  if (!roomId) return c.json({ error: "roomId is required" }, 400);

  const body = await c.req.json<{ gmPlayerId: string }>();
  const room = await getRoom(roomId, c.env.DB);
  if (!room) return c.json({ error: "room not found" }, 404);
  if (body.gmPlayerId !== room.gmPlayerId) {
    return c.json({ error: "forbidden: gm only" }, 403);
  }

  try {
    const result = await (c.env.AI.run as (model: string, input: unknown) => Promise<{ response?: string }>)(
      "@cf/meta/llama-4-scout-17b-16e-instruct",
      {
        messages: [{ role: "user", content: PROMPT }],
        max_tokens: 800,
      },
    );

    if (!result.response) return c.json({ error: "AI生成に失敗しました" }, 500);

    const raw = typeof result.response === "string" ? result.response : JSON.stringify(result.response);
    const jsonStr = extractJson(raw);
    const generated = JSON.parse(jsonStr) as GeneratedTurn;
    if (
      typeof generated.story !== "string" ||
      !Array.isArray(generated.choices) ||
      generated.choices.length !== 3
    ) {
      return c.json({ error: "AI生成の形式が不正でした" }, 500);
    }

    return c.json(generated);
  } catch (err) {
    console.error("AI generation failed:", err);
    return c.json({ error: "AI生成に失敗しました" }, 500);
  }
}
