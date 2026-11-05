-- Bổ sung lịch sử thanh toán và khóa yêu cầu; không backfill dữ liệu cũ.
ALTER TABLE member_credits ADD COLUMN IF NOT EXISTS request_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS member_credits_request_idx
      ON member_credits(member_id, request_id) WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS basic_share_settlements (
      settlement_id TEXT PRIMARY KEY,
      share_id BIGINT NOT NULL,
      basic_session_id TEXT NOT NULL,
      member_id TEXT NOT NULL DEFAULT '',
      member_name TEXT NOT NULL,
      share_amount INTEGER NOT NULL CHECK (share_amount >= 0),
      credit_used INTEGER NOT NULL CHECK (credit_used >= 0 AND credit_used <= share_amount),
      debit_credit_id TEXT REFERENCES member_credits(credit_id),
      refund_credit_id TEXT REFERENCES member_credits(credit_id),
      settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reversed_at TIMESTAMPTZ,
      CHECK ((credit_used > 0) = (debit_credit_id IS NOT NULL)),
      CHECK (refund_credit_id IS NULL OR reversed_at IS NOT NULL)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS basic_share_settlements_active_idx
      ON basic_share_settlements(share_id) WHERE reversed_at IS NULL;
    CREATE INDEX IF NOT EXISTS basic_share_settlements_member_idx
      ON basic_share_settlements(member_id);
