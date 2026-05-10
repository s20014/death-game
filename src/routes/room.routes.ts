import { Hono } from "hono";
import {
  handleCreateRoom,
  handleGetRoom,
  handleGmState,
  handleJoinRoom,
  handleLogState,
  handlePlayerState,
  handleResetRoom,
  handleRoomWs,
} from "../controllers/room.controller.js";
import {
  handleResolveTurn,
  handleSetFinalization,
  handleStartTurn,
  handleSubmitSelection,
} from "../controllers/turn.controller.js";
import {
  handleResolveYesNo,
  handleSubmitYesNo,
  handleTriggerYesNo,
} from "../controllers/yesno.controller.js";
import { handleGenerateTurn } from "../controllers/generate.controller.js";
import {
  handleAdvanceToOthers,
  handleResolveStoryTurn,
  handleStartStoryTurn,
  handleSubmitFirstSelection,
  handleSubmitOthersSelection,
} from "../controllers/story.controller.js";

const router = new Hono();

// ルーム管理
router.post("/", handleCreateRoom);
router.post("/:roomId/join", handleJoinRoom);
router.get("/:roomId", handleGetRoom);
router.get("/:roomId/ws", handleRoomWs);
router.get("/:roomId/player-state", handlePlayerState);
router.get("/:roomId/gm-state", handleGmState);
router.get("/:roomId/log-state", handleLogState);

// ターン進行（通常）
router.post("/:roomId/turns/generate", handleGenerateTurn);
router.post("/:roomId/turns", handleStartTurn);
router.post("/:roomId/turns/select", handleSubmitSelection);
router.post("/:roomId/turns/resolve", handleResolveTurn);
router.post("/:roomId/finalize", handleSetFinalization);
router.post("/:roomId/reset", handleResetRoom);

// YES/NO特殊イベント
router.post("/:roomId/turns/yesno", handleTriggerYesNo);
router.post("/:roomId/turns/yesno/select", handleSubmitYesNo);
router.post("/:roomId/turns/yesno/resolve", handleResolveYesNo);

// ストーリーモード
router.post("/:roomId/turns/story", handleStartStoryTurn);
router.post("/:roomId/turns/story/first", handleSubmitFirstSelection);
router.post("/:roomId/turns/story/advance", handleAdvanceToOthers);
router.post("/:roomId/turns/story/others", handleSubmitOthersSelection);
router.post("/:roomId/turns/story/resolve", handleResolveStoryTurn);

export { router as roomRouter };
