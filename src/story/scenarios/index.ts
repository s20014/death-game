import type { StoryTurnDefinition } from "../../models/types.js";

export const SCENARIO: StoryTurnDefinition[] = [
  {
    turnIndex: 0,
    background:
      "すべてのターンが終わった——。お金を賭けて争い、時に傷つけ合い、それでも最後まで戦い続けた。そして今、1位のプレイヤーにだけ「最後の選択」が与えられた。",
    firstScene: {
      question: "あなたの手の中に、全員分の賞金がある。どうする？",
      choices: [
        { id: "monopolize", text: "独り占めする" },
        { id: "share", text: "みんなに分ける" },
      ],
    },
    othersScenes: {
      share: {
        question: "1位のプレイヤーが「みんなに分ける」と言った。あなたは、どう受け取る？",
        choices: [
          { id: "cooperate", text: "みんなで分ける" },
          { id: "defect", text: "自分だけ得をする" },
        ],
      },
    },
  },
];
