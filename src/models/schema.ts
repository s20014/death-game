// このコードは生成AIによって生成されました。
// D1上のテーブル定義をDrizzleで一元管理する。
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const roomsTable = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  gmPlayerId: text("gm_player_id").notNull(),
  status: text("status").notNull(),
  settingsJson: text("settings_json").notNull(),
  stateJson: text("state_json").notNull(),
  insideJokeConfigJson: text("inside_joke_config_json"),
  finalizationMode: integer("finalization_mode").notNull(),
  allChoicesEqualEventJson: text("all_choices_equal_event_json"),
  createdAt: text("created_at").notNull(),
});

export const playersTable = sqliteTable("players", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull(),
  name: text("name").notNull(),
  money: integer("money").notNull(),
  alive: integer("alive").notNull(),
  createdAt: text("created_at").notNull(),
});

export const turnsTable = sqliteTable("turns", {
  roomId: text("room_id").notNull(),
  turnNumber: integer("turn_number").notNull(),
  mode: text("mode").notNull(),
  phase: text("phase").notNull(),
  story: text("story"),
  choicesJson: text("choices_json"),
  selectionsJson: text("selections_json"),
  yesnoSelectionsJson: text("yesno_selections_json"),
  resultJson: text("result_json"),
  yesnoResultJson: text("yesno_result_json"),
  storyDataJson: text("story_data_json"),
  startedAt: text("started_at").notNull(),
  resolvedAt: text("resolved_at"),
});
