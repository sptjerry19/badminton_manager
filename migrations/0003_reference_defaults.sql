-- Chỉ cấu hình/nội dung giải đấu bắt buộc. Giữ nguyên giá trị đã chỉnh.
INSERT INTO tournament_events(event_id, name, min_level_sum, max_level_sum, gender_rule, active)
      VALUES ('MD','Đôi nam',2,20,'MM',TRUE)
      ON CONFLICT (event_id) DO NOTHING;

INSERT INTO tournament_events(event_id, name, min_level_sum, max_level_sum, gender_rule, active)
      VALUES ('XD','Đôi nam nữ',2,20,'MF',TRUE)
      ON CONFLICT (event_id) DO NOTHING;

INSERT INTO tournament_events(event_id, name, min_level_sum, max_level_sum, gender_rule, active)
      VALUES ('WD','Đôi nữ',2,20,'FF',TRUE)
      ON CONFLICT (event_id) DO NOTHING;

INSERT INTO tournament_settings(key, value)
      VALUES ('points_to_win', '21')
      ON CONFLICT (key) DO NOTHING;

INSERT INTO tournament_settings(key, value)
      VALUES ('registration_open', 'true')
      ON CONFLICT (key) DO NOTHING;

INSERT INTO tournament_settings(key, value)
      VALUES ('pairing_open', 'true')
      ON CONFLICT (key) DO NOTHING;

INSERT INTO settings(key, value)
      VALUES ('extraCourtRate', '300000')
      ON CONFLICT(key) DO NOTHING;

INSERT INTO settings(key, value)
      VALUES ('maleGuestRate', '80000')
      ON CONFLICT(key) DO NOTHING;

INSERT INTO settings(key, value)
      VALUES ('femaleGuestRate', '60000')
      ON CONFLICT(key) DO NOTHING;

INSERT INTO settings(key, value)
      VALUES ('highThreshold', '12')
      ON CONFLICT(key) DO NOTHING;

INSERT INTO settings(key, value)
      VALUES ('lowThreshold', '8')
      ON CONFLICT(key) DO NOTHING;
