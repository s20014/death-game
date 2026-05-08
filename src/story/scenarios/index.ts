import type { StoryTurnDefinition } from "../../models/types.js";

// プレースホルダーシナリオ（後でユーザーが差し替える）
export const SCENARIO: StoryTurnDefinition[] = [
  {
    turnIndex: 0,
    background:
      "【第1話】ゲームが始まって数ターン。気づけば資産の差が開き始めた。トップに立つ者は、その力をどう使うのか——",
    firstScene: {
      question: "あなたは今、誰よりも多くの資産を持っている。その力で、何をする？",
      choices: [
        {
          id: "dominate",
          text: "このまま世界を牛耳る",
          storyScore: { happy: 0, normal: 1, bad: 2 },
        },
        {
          id: "share",
          text: "最下位の人間に分け与える",
          storyScore: { happy: 3, normal: 1, bad: 0 },
        },
      ],
    },
    othersScenes: {
      dominate: {
        question: "1位が「世界を牛耳る」と宣言した。あなたはどう動く？",
        choices: [
          {
            id: "follow",
            text: "従って恩恵を受ける",
            moneyEffect: { type: "gain", amount: 100_000, description: "服従の報酬" },
            storyScore: { happy: 0, normal: 1, bad: 2 },
          },
          {
            id: "resist",
            text: "密かに抵抗する",
            moneyEffect: { type: "lose", amount: 50_000, description: "抵抗の代償" },
            storyScore: { happy: 1, normal: 1, bad: 0 },
          },
        ],
      },
      share: {
        question: "1位が最下位に資産を分けようとしている。あなたは？",
        choices: [
          {
            id: "support",
            text: "その行動を支持する",
            moneyEffect: { type: "gain", amount: 80_000, description: "信頼の絆" },
            storyScore: { happy: 3, normal: 0, bad: 0 },
          },
          {
            id: "envy",
            text: "面白くない、嫉妬する",
            moneyEffect: { type: "lose", amount: 30_000, description: "嫉妬の代償" },
            storyScore: { happy: 0, normal: 1, bad: 1 },
          },
        ],
      },
    },
  },
];
