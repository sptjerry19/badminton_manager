-- Baseline idempotent cho database cũ và database mới; không xóa dữ liệu.
CREATE TABLE IF NOT EXISTS login_sessions (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS login_sessions_expire_idx ON login_sessions (expire);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS members (
      member_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'Cố định',
      gender TEXT NOT NULL DEFAULT '',
      birthday TEXT NOT NULL DEFAULT '',
      level INTEGER NOT NULL DEFAULT 5,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      phone_number TEXT NOT NULL DEFAULT '',
      zalo_id TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      time TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      fixed_court_cost INTEGER NOT NULL DEFAULT 0,
      extra_courts INTEGER NOT NULL DEFAULT 0,
      shuttlecock_cost INTEGER NOT NULL DEFAULT 0,
      total_cost INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS session_participants (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      member_id TEXT NOT NULL DEFAULT '',
      member_name TEXT NOT NULL,
      member_name_ci TEXT NOT NULL,
      participant_type TEXT NOT NULL DEFAULT 'Cố định',
      participant_level INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      responded_at TIMESTAMPTZ,
      UNIQUE (session_id, member_name_ci)
    );

    CREATE TABLE IF NOT EXISTS polls (
      poll_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      question TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS poll_answers (
      id BIGSERIAL PRIMARY KEY,
      poll_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      member_id TEXT NOT NULL DEFAULT '',
      member_name TEXT NOT NULL,
      member_name_ci TEXT NOT NULL,
      answer TEXT NOT NULL,
      answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, member_name_ci)
    );

    CREATE TABLE IF NOT EXISTS participants (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT '',
      present BOOLEAN NOT NULL DEFAULT FALSE,
      amount INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS payments (
      payment_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      member_id TEXT NOT NULL DEFAULT '',
      member_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS expenses (
      expense_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      total_amount INTEGER NOT NULL DEFAULT 0,
      split_method TEXT NOT NULL DEFAULT 'equal',
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS expense_participants (
      id BIGSERIAL PRIMARY KEY,
      expense_id TEXT NOT NULL,
      member_id TEXT NOT NULL DEFAULT '',
      member_name TEXT NOT NULL,
      member_name_ci TEXT NOT NULL,
      share_amount INTEGER NOT NULL DEFAULT 0,
      split_method TEXT NOT NULL DEFAULT 'equal',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (expense_id, member_name_ci)
    );

    CREATE TABLE IF NOT EXISTS debts (
      member_id TEXT PRIMARY KEY,
      member_name TEXT NOT NULL,
      total_due INTEGER NOT NULL DEFAULT 0,
      total_paid INTEGER NOT NULL DEFAULT 0,
      balance INTEGER NOT NULL DEFAULT 0,
      last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS match_pair_history (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      pair_key TEXT NOT NULL,
      member_a TEXT NOT NULL,
      member_b TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS generated_matches (
      id BIGSERIAL PRIMARY KEY,
      match_date TEXT NOT NULL,
      session_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      match_no INTEGER NOT NULL,
      court_no INTEGER NOT NULL DEFAULT 1,
      match_time TEXT NOT NULL DEFAULT '',
      team_a_json JSONB NOT NULL,
      team_b_json JSONB NOT NULL,
      level_diff INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (match_date, round, match_no)
    );

    CREATE TABLE IF NOT EXISTS birthday_events (
      event_id TEXT PRIMARY KEY,
      event_name TEXT NOT NULL,
      event_date TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS birthday_event_brands (
      id BIGSERIAL PRIMARY KEY,
      event_id TEXT NOT NULL,
      brand_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS birthday_event_drinks (
      drink_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      brand_name TEXT NOT NULL,
      drink_name TEXT NOT NULL,
      price INTEGER,
      image_url TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS birthday_drink_orders (
      id BIGSERIAL PRIMARY KEY,
      event_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      member_name TEXT NOT NULL,
      drink_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(event_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS basic_sessions (
      basic_session_id TEXT PRIMARY KEY,
      play_date TEXT NOT NULL,
      court TEXT NOT NULL,
      court_fee INTEGER NOT NULL DEFAULT 0,
      shuttle_fee INTEGER NOT NULL DEFAULT 0,
      total_fee INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS basic_shares (
      id BIGSERIAL PRIMARY KEY,
      basic_session_id TEXT NOT NULL REFERENCES basic_sessions(basic_session_id) ON DELETE CASCADE,
      member_id TEXT NOT NULL DEFAULT '',
      member_name TEXT NOT NULL,
      member_name_ci TEXT NOT NULL,
      share_amount INTEGER NOT NULL DEFAULT 0,
      paid BOOLEAN NOT NULL DEFAULT FALSE,
      paid_at TIMESTAMPTZ,
      UNIQUE (basic_session_id, member_name_ci)
    );

    CREATE TABLE IF NOT EXISTS push_tokens (
      token TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS push_tokens_member_idx ON push_tokens(member_id);

ALTER TABLE session_participants
    ADD COLUMN IF NOT EXISTS participant_type TEXT NOT NULL DEFAULT 'Cố định';

ALTER TABLE session_participants
    ADD COLUMN IF NOT EXISTS participant_level INTEGER;

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS vote_status TEXT NOT NULL DEFAULT 'open';

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS booking_image_url TEXT NOT NULL DEFAULT '';

ALTER TABLE members
    ADD COLUMN IF NOT EXISTS birthday TEXT NOT NULL DEFAULT '';

ALTER TABLE basic_sessions
    ADD COLUMN IF NOT EXISTS extra_fee INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS extra_note TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS vote_session_id TEXT NOT NULL DEFAULT '';

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'birthday_event_brands_event_fk' AND conrelid = 'birthday_event_brands'::regclass) THEN
    ALTER TABLE birthday_event_brands
    ADD CONSTRAINT birthday_event_brands_event_fk
    FOREIGN KEY (event_id) REFERENCES birthday_events(event_id) ON DELETE CASCADE;
  END IF;
END
$migration$;
ALTER TABLE birthday_event_brands VALIDATE CONSTRAINT birthday_event_brands_event_fk;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'birthday_event_drinks_event_fk' AND conrelid = 'birthday_event_drinks'::regclass) THEN
    ALTER TABLE birthday_event_drinks
    ADD CONSTRAINT birthday_event_drinks_event_fk
    FOREIGN KEY (event_id) REFERENCES birthday_events(event_id) ON DELETE CASCADE;
  END IF;
END
$migration$;
ALTER TABLE birthday_event_drinks VALIDATE CONSTRAINT birthday_event_drinks_event_fk;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'birthday_drink_orders_event_fk' AND conrelid = 'birthday_drink_orders'::regclass) THEN
    ALTER TABLE birthday_drink_orders
    ADD CONSTRAINT birthday_drink_orders_event_fk
    FOREIGN KEY (event_id) REFERENCES birthday_events(event_id) ON DELETE CASCADE;
  END IF;
END
$migration$;
ALTER TABLE birthday_drink_orders VALIDATE CONSTRAINT birthday_drink_orders_event_fk;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'birthday_drink_orders_drink_fk' AND conrelid = 'birthday_drink_orders'::regclass) THEN
    ALTER TABLE birthday_drink_orders
    ADD CONSTRAINT birthday_drink_orders_drink_fk
    FOREIGN KEY (drink_id) REFERENCES birthday_event_drinks(drink_id) ON DELETE CASCADE;
  END IF;
END
$migration$;
ALTER TABLE birthday_drink_orders VALIDATE CONSTRAINT birthday_drink_orders_drink_fk;

CREATE TABLE IF NOT EXISTS member_credits (
      credit_id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL DEFAULT '',
      member_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS notices (
      notice_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS notices_created_at_idx ON notices(created_at DESC);

CREATE TABLE IF NOT EXISTS tournaments (
      tournament_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      content_html TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

CREATE INDEX IF NOT EXISTS tournaments_created_at_idx
    ON tournaments(created_at DESC);

CREATE TABLE IF NOT EXISTS tournament_events (
      event_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      min_level_sum INTEGER NOT NULL DEFAULT 2,
      max_level_sum INTEGER NOT NULL DEFAULT 20,
      gender_rule TEXT NOT NULL DEFAULT 'MF',
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

CREATE TABLE IF NOT EXISTS tournament_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE IF NOT EXISTS tournament_registrations (
      member_id TEXT PRIMARY KEY,
      member_name TEXT NOT NULL,
      join_summary BOOLEAN NOT NULL DEFAULT FALSE,
      profile_completed BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

ALTER TABLE tournament_registrations
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';

ALTER TABLE tournament_registrations
    ALTER COLUMN status SET DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS tournament_player_events (
      member_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      PRIMARY KEY (member_id, event_id)
    );

CREATE TABLE IF NOT EXISTS tournament_pairs (
      pair_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      member_a_id TEXT NOT NULL,
      member_b_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at TIMESTAMPTZ
    );

CREATE INDEX IF NOT EXISTS tournament_pairs_event_status_idx
    ON tournament_pairs(event_id, status);

CREATE TABLE IF NOT EXISTS tournament_matches (
      match_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      match_no INTEGER NOT NULL,
      pair_a_id TEXT NOT NULL,
      pair_b_id TEXT NOT NULL,
      score_a INTEGER,
      score_b INTEGER,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (event_id, round, match_no)
    );

ALTER TABLE tournament_matches
    ADD COLUMN IF NOT EXISTS play_order INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS tournament_member_stats (
      member_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      point_diff INTEGER NOT NULL DEFAULT 0,
      points_for INTEGER NOT NULL DEFAULT 0,
      points_against INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (member_id, event_id)
    );
