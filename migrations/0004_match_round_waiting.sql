-- Giữ tính năng ngồi chờ theo vòng từ main; startup vẫn chỉ kiểm tra migration.
CREATE TABLE IF NOT EXISTS generated_match_round_waiting (
  match_date TEXT NOT NULL,
  round INTEGER NOT NULL,
  waiting_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_date, round)
);
