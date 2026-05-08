CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  gm_player_id TEXT NOT NULL,
  status TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  inside_joke_config_json TEXT,
  finalization_mode INTEGER NOT NULL DEFAULT 0,
  all_choices_equal_event_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  money INTEGER NOT NULL,
  alive INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_players_room_id ON players(room_id);

CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  mode TEXT NOT NULL,
  phase TEXT NOT NULL,
  story TEXT,
  choices_json TEXT,
  selections_json TEXT,
  yesno_selections_json TEXT,
  result_json TEXT,
  yesno_result_json TEXT,
  started_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(room_id, turn_number),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turns_room_id ON turns(room_id);
