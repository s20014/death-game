import type { Context } from "hono";
import type { AppBindings } from "../bindings.js";
import { getRoom } from "../models/room.store.js";

type AppContext = Context<{ Bindings: AppBindings }>;

type GeneratedTurn = {
  story: string;
  choices: { id: string; text: string; resultStory: { majority: string; minority: string } }[];
};

const PROMPT = `あなたはデスゲームの進行AIです。参加者が資金をかけて選択を迫られる緊迫したシナリオを1つ生成してください。
必ず以下のJSON形式のみで返してください（前後に余分なテキスト不要）：
{
  "story": "ゲームマスターが読み上げる状況説明（2〜3文、デスゲームらしい緊迫感）",
  "choices": [
    {
      "id": "a",
      "text": "選択肢Aのラベル（15文字以内）",
      "resultStory": {
        "majority": "この選択肢が多数派だった場合の結末（1〜2文、具体的に）",
        "minority": "この選択肢が少数派だった場合の結末（1〜2文、少数派ボーナスの状況で）"
      }
    },
    {
      "id": "b",
      "text": "選択肢Bのラベル（15文字以内）",
      "resultStory": {
        "majority": "この選択肢が多数派だった場合の結末（1〜2文）",
        "minority": "この選択肢が少数派だった場合の結末（1〜2文）"
      }
    },
    {
      "id": "c",
      "text": "選択肢Cのラベル（15文字以内）",
      "resultStory": {
        "majority": "この選択肢が多数派だった場合の結末（1〜2文）",
        "minority": "この選択肢が少数派だった場合の結末（1〜2文）"
      }
    }
  ]
}`;

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
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages: [{ role: "user", content: PROMPT }],
        response_format: { type: "json_object" },
        max_tokens: 1024,
      },
    );

    if (!result.response) return c.json({ error: "AI生成に失敗しました" }, 500);

    const generated = JSON.parse(result.response) as GeneratedTurn;
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
