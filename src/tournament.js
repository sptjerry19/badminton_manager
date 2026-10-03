const crypto = require("crypto");
const { pool, createMember, getMembers, upsertMemberContact, updateMemberProfile } = require("./postgres");
const { generateRoundRobin } = require("./tournament-draw");

const EVENT_IDS = ["MD", "XD", "WD"];
const LEVEL_LABELS = {
  1: "Newbie",
  2: "Yếu",
  3: "Yếu+",
  4: "TBY",
  5: "TBY+",
  6: "TB-",
  7: "TB",
  8: "TB+",
  9: "TBK",
  10: "Bán chuyên"
};

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLevel(value) {
  const parsed = Math.round(toNumber(value, 5));
  if (parsed < 1) return 1;
  if (parsed > 10) return 10;
  return parsed;
}

function normalizeGender(gender) {
  const value = String(gender || "").trim().toLowerCase();
  if (value === "nam" || value === "male" || value === "m") return "Nam";
  if (value === "nu" || value === "nữ" || value === "female" || value === "f") return "Nữ";
  return "";
}

function normalizePhone(value) {
  return String(value || "").trim();
}

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

async function query(text, params = []) {
  return pool.query(text, params);
}

function levelLabel(level) {
  return LEVEL_LABELS[normalizeLevel(level)] || String(level);
}

function mapEvent(row) {
  return {
    eventId: row.event_id,
    name: row.name,
    minLevelSum: toNumber(row.min_level_sum, 2),
    maxLevelSum: toNumber(row.max_level_sum, 20),
    genderRule: row.gender_rule || "MF",
    active: Boolean(row.active)
  };
}

async function getTournamentSettings() {
  const result = await query(`SELECT key, value FROM tournament_settings`);
  const map = {
    pointsToWin: 21,
    registrationOpen: true,
    pairingOpen: true
  };
  result.rows.forEach((row) => {
    if (row.key === "points_to_win") map.pointsToWin = Math.max(1, toNumber(row.value, 21));
    if (row.key === "registration_open") map.registrationOpen = String(row.value).toLowerCase() !== "false";
    if (row.key === "pairing_open") map.pairingOpen = String(row.value).toLowerCase() !== "false";
  });
  return map;
}

async function updateTournamentSettings(payload = {}) {
  const entries = [];
  if (payload.pointsToWin !== undefined) {
    entries.push(["points_to_win", String(Math.max(1, toNumber(payload.pointsToWin, 21)))]);
  }
  if (payload.registrationOpen !== undefined) {
    entries.push(["registration_open", payload.registrationOpen ? "true" : "false"]);
  }
  if (payload.pairingOpen !== undefined) {
    entries.push(["pairing_open", payload.pairingOpen ? "true" : "false"]);
  }
  for (const [key, value] of entries) {
    await query(
      `
      INSERT INTO tournament_settings(key, value) VALUES ($1,$2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `,
      [key, value]
    );
  }
  return getTournamentSettings();
}

async function getTournamentEvents() {
  const result = await query(`SELECT * FROM tournament_events ORDER BY event_id ASC`);
  return result.rows.map(mapEvent);
}

async function updateEventRules(eventId, { minLevelSum, maxLevelSum }) {
  const id = String(eventId || "").trim().toUpperCase();
  if (!EVENT_IDS.includes(id)) throw new Error("Nội dung không hợp lệ.");
  const minSum = Math.max(2, Math.round(toNumber(minLevelSum, 2)));
  const maxSum = Math.max(minSum, Math.round(toNumber(maxLevelSum, 20)));
  const result = await query(
    `
    UPDATE tournament_events
    SET min_level_sum = $2, max_level_sum = $3
    WHERE event_id = $1
    RETURNING *
    `,
    [id, minSum, maxSum]
  );
  if (!result.rows[0]) throw new Error("Không tìm thấy nội dung.");
  return mapEvent(result.rows[0]);
}

async function findMemberByName(name) {
  const result = await query(`SELECT * FROM members WHERE LOWER(name) = LOWER($1)`, [String(name || "").trim()]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    memberId: row.member_id,
    name: row.name,
    type: row.type,
    gender: row.gender || "",
    level: normalizeLevel(row.level),
    active: Boolean(row.active),
    phoneNumber: row.phone_number || ""
  };
}

function normalizeRegistrationStatus(value) {
  const status = String(value || "pending").trim().toLowerCase();
  if (status === "approved" || status === "blocked") return status;
  return "pending";
}

async function getRegistration(memberId) {
  const result = await query(`SELECT * FROM tournament_registrations WHERE member_id = $1`, [memberId]);
  const row = result.rows[0];
  if (!row) return null;
  const eventsResult = await query(
    `SELECT event_id FROM tournament_player_events WHERE member_id = $1 ORDER BY event_id ASC`,
    [memberId]
  );
  return {
    memberId: row.member_id,
    memberName: row.member_name,
    joinSummary: Boolean(row.join_summary),
    profileCompleted: Boolean(row.profile_completed),
    status: normalizeRegistrationStatus(row.status),
    eventIds: eventsResult.rows.map((item) => item.event_id)
  };
}

async function registerTournamentMember({ name, phoneNumber }) {
  const settings = await getTournamentSettings();
  if (!settings.registrationOpen) throw new Error("Đăng ký giải đã đóng.");
  const safeName = String(name || "").trim();
  const phone = normalizePhone(phoneNumber);
  if (!safeName) throw new Error("Tên không được để trống.");
  if (!phone) throw new Error("Số điện thoại không được để trống.");
  const existing = await findMemberByName(safeName);
  if (existing) throw new Error("Tên này đã tồn tại. Hãy đăng nhập bằng tên và SĐT.");
  const member = await createMember({
    name: safeName,
    type: "GL",
    phoneNumber: phone,
    gender: "",
    level: 5,
    active: true
  });
  return member;
}

async function loginTournamentMember({ memberName, phoneNumber }) {
  const safeName = String(memberName || "").trim();
  const phone = normalizePhone(phoneNumber);
  if (!safeName || !phone) throw new Error("Cần chọn thành viên và nhập số điện thoại.");
  const member = await findMemberByName(safeName);
  if (!member || !member.active) throw new Error("Thành viên không tồn tại hoặc đã bị khóa.");
  await upsertMemberContact(member.name, phone);
  return findMemberByName(member.name);
}

async function completeTournamentProfile(memberName, payload) {
  const settings = await getTournamentSettings();
  if (!settings.registrationOpen) {
    const existing = await findMemberByName(memberName);
    const reg = existing ? await getRegistration(existing.memberId) : null;
    if (!reg?.profileCompleted) throw new Error("Đăng ký giải đã đóng.");
  }

  const member = await findMemberByName(memberName);
  if (!member) throw new Error("Không tìm thấy thành viên.");

  const gender = normalizeGender(payload?.gender);
  if (!gender) throw new Error("Cần chọn giới tính.");
  const level = normalizeLevel(payload?.level);
  const phone = normalizePhone(payload?.phoneNumber || member.phoneNumber);
  if (!phone) throw new Error("Số điện thoại không được để trống.");
  if (!payload?.joinSummary) throw new Error("Cần xác nhận tham gia tổng kết sau giải.");

  const eventIds = [...new Set((Array.isArray(payload?.eventIds) ? payload.eventIds : []).map((id) => String(id || "").trim().toUpperCase()))];
  if (eventIds.length !== 2 || eventIds.some((id) => !EVENT_IDS.includes(id))) {
    throw new Error("Cần chọn đúng 2 trong 3 nội dung.");
  }

  if (gender === "Nam" && eventIds.includes("WD")) {
    throw new Error("Nam không thể đăng ký Đôi nữ.");
  }
  if (gender === "Nữ" && eventIds.includes("MD")) {
    throw new Error("Nữ không thể đăng ký Đôi nam.");
  }

  const nextName = String(payload?.name || member.name).trim() || member.name;
  await updateMemberProfile(member.memberId, {
    name: nextName,
    type: member.type,
    gender,
    phoneNumber: phone,
    level,
    active: true
  });

  const updated = await findMemberByName(nextName);
  const ts = nowIso();
  const existingReg = await getRegistration(updated.memberId);
  const nextStatus =
    existingReg?.status === "approved" || existingReg?.status === "blocked"
      ? existingReg.status
      : "pending";
  await query(
    `
    INSERT INTO tournament_registrations(member_id, member_name, join_summary, profile_completed, status, created_at, updated_at)
    VALUES ($1,$2,TRUE,TRUE,$3,$4,$4)
    ON CONFLICT (member_id) DO UPDATE
    SET member_name = EXCLUDED.member_name,
        join_summary = TRUE,
        profile_completed = TRUE,
        status = CASE
          WHEN tournament_registrations.status IN ('approved', 'blocked') THEN tournament_registrations.status
          ELSE 'pending'
        END,
        updated_at = EXCLUDED.updated_at
    `,
    [updated.memberId, updated.name, nextStatus, ts]
  );
  await query(`DELETE FROM tournament_player_events WHERE member_id = $1`, [updated.memberId]);
  for (const eventId of eventIds) {
    await query(
      `INSERT INTO tournament_player_events(member_id, event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [updated.memberId, eventId]
    );
  }
  return {
    member: updated,
    registration: await getRegistration(updated.memberId)
  };
}

function genderOkForEvent(genderRule, genderA, genderB) {
  const a = normalizeGender(genderA);
  const b = normalizeGender(genderB);
  if (!a || !b) return false;
  if (genderRule === "MM") return a === "Nam" && b === "Nam";
  if (genderRule === "FF") return a === "Nữ" && b === "Nữ";
  if (genderRule === "MF") {
    return (a === "Nam" && b === "Nữ") || (a === "Nữ" && b === "Nam");
  }
  return false;
}

async function getActivePairMemberIds(eventId) {
  const result = await query(
    `
    SELECT member_a_id, member_b_id
    FROM tournament_pairs
    WHERE event_id = $1 AND status IN ('pending', 'locked')
    `,
    [eventId]
  );
  const set = new Set();
  result.rows.forEach((row) => {
    set.add(row.member_a_id);
    set.add(row.member_b_id);
  });
  return set;
}

async function listPairCandidates(memberName, eventId) {
  const settings = await getTournamentSettings();
  if (!settings.pairingOpen) throw new Error("Ghép đôi đang đóng.");
  const id = String(eventId || "").trim().toUpperCase();
  if (!EVENT_IDS.includes(id)) throw new Error("Nội dung không hợp lệ.");

  const me = await findMemberByName(memberName);
  if (!me) throw new Error("Không tìm thấy thành viên.");
  const reg = await getRegistration(me.memberId);
  if (!reg?.profileCompleted || !reg.eventIds.includes(id)) {
    throw new Error("Bạn chưa đăng ký nội dung này.");
  }
  if (reg.status !== "approved") {
    throw new Error(
      reg.status === "blocked"
        ? "Bạn đã bị từ chối tham dự giải."
        : "Admin chưa duyệt hồ sơ của bạn."
    );
  }

  const events = await getTournamentEvents();
  const event = events.find((item) => item.eventId === id);
  if (!event) throw new Error("Không tìm thấy nội dung.");

  const busy = await getActivePairMemberIds(id);
  if (busy.has(me.memberId)) throw new Error("Bạn đã có lời mời hoặc cặp ở nội dung này.");

  const result = await query(
    `
    SELECT m.member_id, m.name, m.gender, m.level, m.phone_number
    FROM tournament_player_events tpe
    INNER JOIN members m ON m.member_id = tpe.member_id
    INNER JOIN tournament_registrations tr
      ON tr.member_id = m.member_id
     AND tr.profile_completed = TRUE
     AND COALESCE(tr.status, 'pending') = 'approved'
    WHERE tpe.event_id = $1
      AND m.active = TRUE
      AND m.member_id <> $2
    ORDER BY m.name ASC
    `,
    [id, me.memberId]
  );

  return result.rows
    .filter((row) => !busy.has(row.member_id))
    .filter((row) => genderOkForEvent(event.genderRule, me.gender, row.gender))
    .filter((row) => {
      const sum = me.level + normalizeLevel(row.level);
      return sum >= event.minLevelSum && sum <= event.maxLevelSum;
    })
    .map((row) => ({
      memberId: row.member_id,
      name: row.name,
      gender: row.gender || "",
      level: normalizeLevel(row.level),
      levelLabel: levelLabel(row.level),
      levelSum: me.level + normalizeLevel(row.level)
    }));
}

async function mapPairRows(rows) {
  if (!rows.length) return [];
  const memberIds = [...new Set(rows.flatMap((row) => [row.member_a_id, row.member_b_id]))];
  const membersResult = await query(
    `SELECT member_id, name, gender, level FROM members WHERE member_id = ANY($1::text[])`,
    [memberIds]
  );
  const byId = {};
  membersResult.rows.forEach((row) => {
    byId[row.member_id] = {
      memberId: row.member_id,
      name: row.name,
      gender: row.gender || "",
      level: normalizeLevel(row.level),
      levelLabel: levelLabel(row.level)
    };
  });
  return rows.map((row) => ({
    pairId: row.pair_id,
    eventId: row.event_id,
    status: row.status,
    invitedBy: row.invited_by || "",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : "",
    memberA: byId[row.member_a_id] || { memberId: row.member_a_id, name: "?", level: 0 },
    memberB: byId[row.member_b_id] || { memberId: row.member_b_id, name: "?", level: 0 },
    levelSum:
      (byId[row.member_a_id]?.level || 0) + (byId[row.member_b_id]?.level || 0)
  }));
}

async function listPairs({ eventId = "", memberId = "", statuses = null } = {}) {
  const clauses = [];
  const params = [];
  if (eventId) {
    params.push(String(eventId).toUpperCase());
    clauses.push(`event_id = $${params.length}`);
  }
  if (memberId) {
    params.push(memberId);
    clauses.push(`(member_a_id = $${params.length} OR member_b_id = $${params.length})`);
  }
  if (Array.isArray(statuses) && statuses.length) {
    params.push(statuses);
    clauses.push(`status = ANY($${params.length}::text[])`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await query(
    `
    SELECT * FROM tournament_pairs
    ${where}
    ORDER BY created_at DESC
    `,
    params
  );
  return mapPairRows(result.rows);
}

async function invitePartner(memberName, { eventId, partnerMemberId }) {
  const settings = await getTournamentSettings();
  if (!settings.pairingOpen) throw new Error("Ghép đôi đang đóng.");
  const id = String(eventId || "").trim().toUpperCase();
  const partnerId = String(partnerMemberId || "").trim();
  if (!EVENT_IDS.includes(id)) throw new Error("Nội dung không hợp lệ.");
  if (!partnerId) throw new Error("Thiếu đồng đội.");

  const me = await findMemberByName(memberName);
  if (!me) throw new Error("Không tìm thấy thành viên.");
  const candidates = await listPairCandidates(memberName, id);
  const partner = candidates.find((item) => item.memberId === partnerId);
  if (!partner) throw new Error("Đồng đội không hợp lệ với rule hiện tại.");

  const pairId = `TP${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
  await query(
    `
    INSERT INTO tournament_pairs(pair_id, event_id, member_a_id, member_b_id, status, invited_by, created_at)
    VALUES ($1,$2,$3,$4,'pending',$5,$6)
    `,
    [pairId, id, me.memberId, partnerId, me.memberId, nowIso()]
  );
  const pairs = await listPairs({ eventId: id, memberId: me.memberId, statuses: ["pending", "locked"] });
  return pairs[0];
}

async function respondPair(memberName, pairId, accept) {
  const me = await findMemberByName(memberName);
  if (!me) throw new Error("Không tìm thấy thành viên.");
  const result = await query(`SELECT * FROM tournament_pairs WHERE pair_id = $1`, [pairId]);
  const row = result.rows[0];
  if (!row) throw new Error("Không tìm thấy lời mời.");
  if (row.status !== "pending") throw new Error("Lời mời không còn hiệu lực.");
  if (row.member_a_id !== me.memberId && row.member_b_id !== me.memberId) {
    throw new Error("Bạn không thuộc lời mời này.");
  }
  if (row.invited_by === me.memberId && accept) {
    throw new Error("Người mời không tự chấp nhận. Chờ đối phương phản hồi.");
  }

  const nextStatus = accept ? "locked" : "rejected";
  await query(
    `
    UPDATE tournament_pairs
    SET status = $2, responded_at = $3
    WHERE pair_id = $1
    `,
    [pairId, nextStatus, nowIso()]
  );
  const pairs = await listPairs({ eventId: row.event_id, memberId: me.memberId });
  return pairs.find((item) => item.pairId === pairId) || null;
}

async function cancelPair(pairId) {
  const result = await query(
    `
    UPDATE tournament_pairs
    SET status = 'cancelled', responded_at = $2
    WHERE pair_id = $1 AND status IN ('pending', 'locked')
    RETURNING pair_id
    `,
    [pairId, nowIso()]
  );
  if (!result.rows[0]) throw new Error("Không hủy được cặp này.");
  return { pairId };
}

async function listTournamentPlayers() {
  const result = await query(
    `
    SELECT tr.member_id, tr.member_name, tr.join_summary, tr.profile_completed, tr.status, tr.created_at,
           m.gender, m.level, m.phone_number, m.active, m.type
    FROM tournament_registrations tr
    INNER JOIN members m ON m.member_id = tr.member_id
    ORDER BY
      CASE COALESCE(tr.status, 'pending')
        WHEN 'pending' THEN 0
        WHEN 'approved' THEN 1
        ELSE 2
      END,
      tr.created_at DESC
    `
  );
  const eventsResult = await query(`SELECT member_id, event_id FROM tournament_player_events`);
  const eventsByMember = {};
  eventsResult.rows.forEach((row) => {
    if (!eventsByMember[row.member_id]) eventsByMember[row.member_id] = [];
    eventsByMember[row.member_id].push(row.event_id);
  });
  const pairs = await listPairs({ statuses: ["pending", "locked"] });
  return result.rows.map((row) => {
    const myPairs = pairs.filter(
      (pair) => pair.memberA.memberId === row.member_id || pair.memberB.memberId === row.member_id
    );
    return {
      memberId: row.member_id,
      name: row.member_name,
      gender: row.gender || "",
      level: normalizeLevel(row.level),
      levelLabel: levelLabel(row.level),
      phoneNumber: row.phone_number || "",
      type: row.type || "GL",
      active: Boolean(row.active),
      joinSummary: Boolean(row.join_summary),
      profileCompleted: Boolean(row.profile_completed),
      status: normalizeRegistrationStatus(row.status),
      eventIds: eventsByMember[row.member_id] || [],
      pairs: myPairs.map((pair) => ({
        pairId: pair.pairId,
        eventId: pair.eventId,
        status: pair.status,
        partnerName:
          pair.memberA.memberId === row.member_id ? pair.memberB.name : pair.memberA.name
      }))
    };
  });
}

async function adminUpdatePlayer(memberId, payload) {
  const id = String(memberId || "").trim();
  const existing = await query(`SELECT * FROM members WHERE member_id = $1`, [id]);
  if (!existing.rows[0]) throw new Error("Không tìm thấy thành viên.");
  const member = await updateMemberProfile(id, {
    name: payload?.name ?? existing.rows[0].name,
    type: existing.rows[0].type,
    gender: payload?.gender ?? existing.rows[0].gender,
    phoneNumber: payload?.phoneNumber ?? existing.rows[0].phone_number,
    level: payload?.level ?? existing.rows[0].level,
    active: payload?.active ?? existing.rows[0].active
  });
  const updates = [`member_name = $2`, `updated_at = $3`];
  const params = [member.memberId, member.name, nowIso()];
  if (payload?.status !== undefined) {
    params.push(normalizeRegistrationStatus(payload.status));
    updates.push(`status = $${params.length}`);
  }
  await query(
    `UPDATE tournament_registrations SET ${updates.join(", ")} WHERE member_id = $1`,
    params
  );
  if (Array.isArray(payload?.eventIds) && payload.eventIds.length === 2) {
    const eventIds = payload.eventIds.map((item) => String(item).toUpperCase());
    if (eventIds.every((item) => EVENT_IDS.includes(item))) {
      await query(`DELETE FROM tournament_player_events WHERE member_id = $1`, [member.memberId]);
      for (const eventId of eventIds) {
        await query(
          `INSERT INTO tournament_player_events(member_id, event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [member.memberId, eventId]
        );
      }
    }
  }
  const players = await listTournamentPlayers();
  return players.find((item) => item.memberId === member.memberId);
}

async function adminSetPlayerStatus(memberId, status) {
  const id = String(memberId || "").trim();
  const next = normalizeRegistrationStatus(status);
  const result = await query(
    `
    UPDATE tournament_registrations
    SET status = $2, updated_at = $3
    WHERE member_id = $1
    RETURNING member_id
    `,
    [id, next, nowIso()]
  );
  if (!result.rows[0]) throw new Error("Không tìm thấy VĐV đăng ký giải.");
  if (next === "blocked") {
    await query(
      `
      UPDATE tournament_pairs
      SET status = 'cancelled', responded_at = $2
      WHERE status IN ('pending', 'locked')
        AND (member_a_id = $1 OR member_b_id = $1)
      `,
      [id, nowIso()]
    );
  }
  const players = await listTournamentPlayers();
  return players.find((item) => item.memberId === id);
}

async function adminRemovePlayer(memberId) {
  const id = String(memberId || "").trim();
  const existing = await query(`SELECT member_id FROM tournament_registrations WHERE member_id = $1`, [id]);
  if (!existing.rows[0]) throw new Error("Không tìm thấy VĐV đăng ký giải.");
  await query(
    `
    UPDATE tournament_pairs
    SET status = 'cancelled', responded_at = $2
    WHERE status IN ('pending', 'locked')
      AND (member_a_id = $1 OR member_b_id = $1)
    `,
    [id, nowIso()]
  );
  await query(`DELETE FROM tournament_player_events WHERE member_id = $1`, [id]);
  await query(`DELETE FROM tournament_member_stats WHERE member_id = $1`, [id]);
  await query(`DELETE FROM tournament_registrations WHERE member_id = $1`, [id]);
  return { memberId: id };
}

async function listMatches(eventId = "") {
  const params = [];
  let where = "";
  if (eventId) {
    params.push(String(eventId).toUpperCase());
    where = `WHERE event_id = $1`;
  }
  const result = await query(
    `
    SELECT * FROM tournament_matches
    ${where}
    ORDER BY event_id ASC, round ASC, match_no ASC
    `,
    params
  );
  if (!result.rows.length) return [];
  const pairIds = [...new Set(result.rows.flatMap((row) => [row.pair_a_id, row.pair_b_id]))];
  const pairs = await listPairs();
  const pairById = {};
  pairs.forEach((pair) => {
    pairById[pair.pairId] = pair;
  });
  return result.rows.map((row) => ({
    matchId: row.match_id,
    eventId: row.event_id,
    round: toNumber(row.round),
    matchNo: toNumber(row.match_no),
    pairAId: row.pair_a_id,
    pairBId: row.pair_b_id,
    pairA: pairById[row.pair_a_id] || null,
    pairB: pairById[row.pair_b_id] || null,
    pairALabel: pairById[row.pair_a_id]
      ? `${pairById[row.pair_a_id].memberA.name} / ${pairById[row.pair_a_id].memberB.name}`
      : row.pair_a_id,
    pairBLabel: pairById[row.pair_b_id]
      ? `${pairById[row.pair_b_id].memberA.name} / ${pairById[row.pair_b_id].memberB.name}`
      : row.pair_b_id,
    scoreA: row.score_a === null || row.score_a === undefined ? null : toNumber(row.score_a),
    scoreB: row.score_b === null || row.score_b === undefined ? null : toNumber(row.score_b),
    status: row.status
  }));
}

async function generateMatches(eventId = "") {
  const events = await getTournamentEvents();
  const targetEvents = eventId
    ? events.filter((item) => item.eventId === String(eventId).toUpperCase())
    : events;
  if (!targetEvents.length) throw new Error("Không có nội dung để generate.");

  const created = [];
  for (const event of targetEvents) {
    const doneCount = await query(
      `SELECT COUNT(*)::int AS count FROM tournament_matches WHERE event_id = $1 AND status = 'done'`,
      [event.eventId]
    );
    if (toNumber(doneCount.rows[0]?.count) > 0) {
      throw new Error(`Nội dung ${event.name} đã có trận hoàn thành — không regenerate.`);
    }

    const locked = await listPairs({ eventId: event.eventId, statuses: ["locked"] });
    if (locked.length < 2) {
      throw new Error(`Nội dung ${event.name} cần ít nhất 2 cặp đã khóa.`);
    }

    await query(`DELETE FROM tournament_matches WHERE event_id = $1 AND status = 'scheduled'`, [
      event.eventId
    ]);
    await query(`DELETE FROM tournament_member_stats WHERE event_id = $1`, [event.eventId]);

    const rr = generateRoundRobin(locked.map((pair) => pair.pairId));
    for (const match of rr) {
      const matchId = `TM${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      await query(
        `
        INSERT INTO tournament_matches(
          match_id, event_id, round, match_no, pair_a_id, pair_b_id, status, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,'scheduled',$7,$7)
        `,
        [matchId, event.eventId, match.round, match.matchNo, match.pairAId, match.pairBId, nowIso()]
      );
      created.push(matchId);
    }
  }
  return {
    created: created.length,
    matches: await listMatches(eventId)
  };
}

async function recomputeEventStats(eventId) {
  const id = String(eventId || "").trim().toUpperCase();
  await query(`DELETE FROM tournament_member_stats WHERE event_id = $1`, [id]);
  const matches = await listMatches(id);
  const done = matches.filter((match) => match.status === "done");
  const stats = {};

  function touch(memberId) {
    if (!stats[memberId]) {
      stats[memberId] = {
        memberId,
        eventId: id,
        played: 0,
        wins: 0,
        points: 0,
        pointDiff: 0,
        pointsFor: 0,
        pointsAgainst: 0
      };
    }
    return stats[memberId];
  }

  for (const match of done) {
    const scoreA = toNumber(match.scoreA);
    const scoreB = toNumber(match.scoreB);
    const aWon = scoreA > scoreB;
    const membersA = [match.pairA?.memberA?.memberId, match.pairA?.memberB?.memberId].filter(Boolean);
    const membersB = [match.pairB?.memberA?.memberId, match.pairB?.memberB?.memberId].filter(Boolean);
    for (const memberId of membersA) {
      const row = touch(memberId);
      row.played += 1;
      row.pointsFor += scoreA;
      row.pointsAgainst += scoreB;
      row.pointDiff = row.pointsFor - row.pointsAgainst;
      if (aWon) {
        row.wins += 1;
        row.points += 1;
      }
    }
    for (const memberId of membersB) {
      const row = touch(memberId);
      row.played += 1;
      row.pointsFor += scoreB;
      row.pointsAgainst += scoreA;
      row.pointDiff = row.pointsFor - row.pointsAgainst;
      if (!aWon) {
        row.wins += 1;
        row.points += 1;
      }
    }
  }

  for (const row of Object.values(stats)) {
    await query(
      `
      INSERT INTO tournament_member_stats(
        member_id, event_id, played, wins, points, point_diff, points_for, points_against
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `,
      [
        row.memberId,
        row.eventId,
        row.played,
        row.wins,
        row.points,
        row.pointDiff,
        row.pointsFor,
        row.pointsAgainst
      ]
    );
  }
}

async function setMatchScore(matchId, scoreA, scoreB) {
  const settings = await getTournamentSettings();
  const a = Math.max(0, Math.round(toNumber(scoreA, -1)));
  const b = Math.max(0, Math.round(toNumber(scoreB, -1)));
  if (!Number.isFinite(Number(scoreA)) || !Number.isFinite(Number(scoreB))) {
    throw new Error("Tỉ số không hợp lệ.");
  }
  if (a === b) throw new Error("Tỉ số không được hòa.");
  const winner = Math.max(a, b);
  if (winner < settings.pointsToWin) {
    throw new Error(`Điểm thắng tối thiểu là ${settings.pointsToWin}.`);
  }

  const result = await query(`SELECT * FROM tournament_matches WHERE match_id = $1`, [matchId]);
  const row = result.rows[0];
  if (!row) throw new Error("Không tìm thấy trận.");

  await query(
    `
    UPDATE tournament_matches
    SET score_a = $2, score_b = $3, status = 'done', updated_at = $4
    WHERE match_id = $1
    `,
    [matchId, a, b, nowIso()]
  );
  await recomputeEventStats(row.event_id);
  const matches = await listMatches(row.event_id);
  return matches.find((item) => item.matchId === matchId);
}

async function getStandings(eventId = "") {
  const params = [];
  let where = "";
  if (eventId) {
    params.push(String(eventId).toUpperCase());
    where = `WHERE s.event_id = $1`;
  }
  const result = await query(
    `
    SELECT s.*, m.name, m.gender, m.level
    FROM tournament_member_stats s
    INNER JOIN members m ON m.member_id = s.member_id
    ${where}
    ORDER BY s.event_id ASC, s.points DESC, s.point_diff DESC, s.points_for DESC, m.name ASC
    `,
    params
  );
  const byEvent = {};
  result.rows.forEach((row) => {
    if (!byEvent[row.event_id]) byEvent[row.event_id] = [];
    byEvent[row.event_id].push({
      rank: byEvent[row.event_id].length + 1,
      memberId: row.member_id,
      name: row.name,
      gender: row.gender || "",
      level: normalizeLevel(row.level),
      levelLabel: levelLabel(row.level),
      played: toNumber(row.played),
      wins: toNumber(row.wins),
      points: toNumber(row.points),
      pointDiff: toNumber(row.point_diff),
      pointsFor: toNumber(row.points_for),
      pointsAgainst: toNumber(row.points_against)
    });
  });
  return byEvent;
}

function mapTournament(row) {
  if (!row) return null;
  return {
    tournamentId: row.tournament_id,
    name: row.name || "",
    location: row.location || "",
    contentHtml: row.content_html || "",
    isActive: Boolean(row.is_active),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
  };
}

async function listTournaments() {
  const result = await query(
    `
    SELECT *
    FROM tournaments
    ORDER BY is_active DESC, created_at DESC
    `
  );
  return result.rows.map(mapTournament);
}

async function getTournamentById(tournamentId) {
  const id = String(tournamentId || "").trim();
  if (!id) throw new Error("Thiếu tournamentId.");
  const result = await query(`SELECT * FROM tournaments WHERE tournament_id = $1`, [id]);
  const tournament = mapTournament(result.rows[0]);
  if (!tournament) throw new Error("Không tìm thấy giải đấu.");
  return tournament;
}

async function getActiveTournament() {
  const result = await query(
    `
    SELECT *
    FROM tournaments
    WHERE is_active = TRUE
    ORDER BY updated_at DESC
    LIMIT 1
    `
  );
  return mapTournament(result.rows[0]);
}

async function createTournament({ name, location, contentHtml }) {
  const safeName = String(name || "").trim();
  if (!safeName) throw new Error("Tên giải không được để trống.");
  const safeLocation = String(location || "").trim();
  const safeHtml = String(contentHtml || "");
  const tournamentId = `t_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const ts = nowIso();
  const result = await query(
    `
    INSERT INTO tournaments(tournament_id, name, location, content_html, is_active, created_at, updated_at)
    VALUES ($1,$2,$3,$4,FALSE,$5,$5)
    RETURNING *
    `,
    [tournamentId, safeName, safeLocation, safeHtml, ts]
  );
  return mapTournament(result.rows[0]);
}

async function updateTournament(tournamentId, { name, location, contentHtml }) {
  const existing = await getTournamentById(tournamentId);
  const safeName = name !== undefined ? String(name || "").trim() : existing.name;
  if (!safeName) throw new Error("Tên giải không được để trống.");
  const safeLocation = location !== undefined ? String(location || "").trim() : existing.location;
  const safeHtml = contentHtml !== undefined ? String(contentHtml || "") : existing.contentHtml;
  const result = await query(
    `
    UPDATE tournaments
    SET name = $2,
        location = $3,
        content_html = $4,
        updated_at = $5
    WHERE tournament_id = $1
    RETURNING *
    `,
    [existing.tournamentId, safeName, safeLocation, safeHtml, nowIso()]
  );
  return mapTournament(result.rows[0]);
}

async function activateTournament(tournamentId) {
  const id = String(tournamentId || "").trim();
  if (!id) throw new Error("Thiếu tournamentId.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT tournament_id FROM tournaments WHERE tournament_id = $1`, [id]);
    if (!existing.rows[0]) throw new Error("Không tìm thấy giải đấu.");
    await client.query(`UPDATE tournaments SET is_active = FALSE, updated_at = $1`, [nowIso()]);
    const result = await client.query(
      `
      UPDATE tournaments
      SET is_active = TRUE, updated_at = $2
      WHERE tournament_id = $1
      RETURNING *
      `,
      [id, nowIso()]
    );
    await client.query("COMMIT");
    return mapTournament(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteTournament(tournamentId) {
  const existing = await getTournamentById(tournamentId);
  await query(`DELETE FROM tournaments WHERE tournament_id = $1`, [existing.tournamentId]);
  return { tournamentId: existing.tournamentId, name: existing.name };
}

async function getTournamentBootstrap({ role, memberName }) {
  const [settings, events, standings, catalog, activeTournament] = await Promise.all([
    getTournamentSettings(),
    getTournamentEvents(),
    getStandings(),
    listTournaments(),
    getActiveTournament()
  ]);

  if (role === "admin") {
    const [players, pairs, matches] = await Promise.all([
      listTournamentPlayers(),
      listPairs(),
      listMatches()
    ]);
    return {
      role,
      settings,
      events,
      players,
      pairs,
      matches,
      standings,
      catalog,
      activeTournament,
      levelLabels: LEVEL_LABELS
    };
  }

  const member = await findMemberByName(memberName);
  if (!member) throw new Error("Không tìm thấy thành viên.");
  const registration = await getRegistration(member.memberId);
  const pairs = registration
    ? await listPairs({ memberId: member.memberId, statuses: ["pending", "locked", "rejected"] })
    : [];
  const matches = await listMatches();

  return {
    role: "user",
    memberName: member.name,
    member,
    registration,
    settings,
    events,
    pairs,
    matches,
    standings,
    catalog,
    activeTournament,
    levelLabels: LEVEL_LABELS
  };
}

module.exports = {
  EVENT_IDS,
  LEVEL_LABELS,
  getTournamentSettings,
  updateTournamentSettings,
  getTournamentEvents,
  updateEventRules,
  registerTournamentMember,
  loginTournamentMember,
  completeTournamentProfile,
  getRegistration,
  listPairCandidates,
  invitePartner,
  respondPair,
  cancelPair,
  listPairs,
  listTournamentPlayers,
  adminUpdatePlayer,
  adminSetPlayerStatus,
  adminRemovePlayer,
  listMatches,
  generateMatches,
  setMatchScore,
  getStandings,
  listTournaments,
  getTournamentById,
  getActiveTournament,
  createTournament,
  updateTournament,
  activateTournament,
  deleteTournament,
  getTournamentBootstrap
};
