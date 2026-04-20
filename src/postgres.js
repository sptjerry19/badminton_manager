const crypto = require("crypto");
const { Pool } = require("pg");
const { calculateSession } = require("./calc");
const { DEFAULT_SETTINGS, DEFAULT_FIXED_MEMBERS } = require("./config");

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

function normalizePhone(value) {
  return String(value || "").trim();
}

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function dateTimeKey(date, time = "00:00") {
  return `${String(date || "").trim()}T${String(time || "00:00").trim()}`;
}

function parseCsvMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Tham số month phải có định dạng YYYY-MM.");
  return month;
}

function normalizeGender(gender) {
  const value = String(gender || "").trim().toLowerCase();
  if (value === "nam" || value === "male" || value === "m") return "Nam";
  if (value === "nu" || value === "nữ" || value === "female" || value === "f") return "Nữ";
  return "Nam";
}

function buildMemberId(name, index = 0) {
  const slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `m_${slug || "member"}_${index + 1}`;
}

if (!process.env.POSTGRES_URL) {
  throw new Error("Thiếu POSTGRES_URL. Hãy cấu hình Vercel Postgres connection string.");
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL.includes("localhost") ? false : { rejectUnauthorized: false }
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initializeDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS members (
      member_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'Cố định',
      gender TEXT NOT NULL DEFAULT '',
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
  `);

  await query(`
    ALTER TABLE session_participants
    ADD COLUMN IF NOT EXISTS participant_type TEXT NOT NULL DEFAULT 'Cố định';
  `);
  await query(`
    ALTER TABLE session_participants
    ADD COLUMN IF NOT EXISTS participant_level INTEGER;
  `);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await query(
      `
      INSERT INTO settings(key, value)
      VALUES ($1, $2)
      ON CONFLICT(key) DO NOTHING
      `,
      [key, String(value)]
    );
  }

  const memberCount = await query(`SELECT COUNT(*)::int AS count FROM members`);
  if (memberCount.rows[0].count === 0) {
    const ts = nowIso();
    for (let i = 0; i < DEFAULT_FIXED_MEMBERS.length; i += 1) {
      const name = DEFAULT_FIXED_MEMBERS[i];
      await query(
        `
        INSERT INTO members(member_id, name, type, level, active, created_at, updated_at)
        VALUES ($1, $2, 'Cố định', 5, TRUE, $3, $3)
        `,
        [buildMemberId(name, i), name, ts]
      );
    }
  }
}

async function getSettings() {
  const result = await query(`SELECT key, value FROM settings`);
  const map = {};
  result.rows.forEach((row) => {
    map[row.key] = toNumber(row.value, row.value);
  });
  return {
    ...DEFAULT_SETTINGS,
    ...map
  };
}

function mapMember(row) {
  return {
    memberId: row.member_id,
    name: row.name,
    type: row.type,
    gender: row.gender || "",
    level: normalizeLevel(row.level),
    active: Boolean(row.active),
    phoneNumber: row.phone_number || "",
    zaloId: row.zalo_id || "",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
  };
}

async function getMembers() {
  const result = await query(`SELECT * FROM members ORDER BY name ASC`);
  return result.rows.map(mapMember);
}

async function getActiveFixedMembers() {
  const result = await query(
    `SELECT * FROM members WHERE active = TRUE AND type = 'Cố định' ORDER BY name ASC`
  );
  return result.rows.map(mapMember);
}

async function getRecentSessions(limit = 20) {
  const sessionsResult = await query(
    `
    SELECT * FROM sessions
    ORDER BY date DESC, time DESC
    LIMIT $1
    `,
    [Math.max(1, limit)]
  );

  const statsResult = await query(
    `
    SELECT session_id,
           SUM(CASE WHEN status='yes' THEN 1 ELSE 0 END)::int AS yes,
           SUM(CASE WHEN status='no' THEN 1 ELSE 0 END)::int AS no,
           SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)::int AS pending
    FROM session_participants
    GROUP BY session_id
    `
  );
  const settledResult = await query(
    `
    SELECT session_id, COUNT(*)::int AS count
    FROM participants
    GROUP BY session_id
    `
  );

  const statsBySession = {};
  statsResult.rows.forEach((row) => {
    statsBySession[row.session_id] = {
      yes: toNumber(row.yes),
      no: toNumber(row.no),
      pending: toNumber(row.pending)
    };
  });
  const settledBySession = {};
  settledResult.rows.forEach((row) => {
    settledBySession[row.session_id] = toNumber(row.count) > 0;
  });

  return sessionsResult.rows.map((row) => ({
    sessionId: row.session_id,
    date: row.date,
    time: row.time || "",
    location: row.location || "",
    note: row.note || "",
    fixedCourtCost: toNumber(row.fixed_court_cost),
    extraCourts: toNumber(row.extra_courts),
    shuttlecockCost: toNumber(row.shuttlecock_cost),
    totalCost: toNumber(row.total_cost),
    createdBy: row.created_by || "admin",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    stats: statsBySession[row.session_id] || { yes: 0, no: 0, pending: 0 },
    settled: Boolean(settledBySession[row.session_id])
  }));
}

async function getSessionById(sessionId) {
  const result = await query(`SELECT * FROM sessions WHERE session_id = $1`, [sessionId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    date: row.date,
    time: row.time || "",
    location: row.location || "",
    note: row.note || "",
    fixedCourtCost: toNumber(row.fixed_court_cost),
    extraCourts: toNumber(row.extra_courts),
    shuttlecockCost: toNumber(row.shuttlecock_cost),
    totalCost: toNumber(row.total_cost),
    createdBy: row.created_by || "admin",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : ""
  };
}

async function getSessionParticipants(sessionId) {
  const result = await query(
    `
    SELECT session_id, member_id, member_name, participant_type, participant_level, status, responded_at
    FROM session_participants
    WHERE session_id = $1
    ORDER BY member_name ASC
    `,
    [sessionId]
  );
  return result.rows.map((row) => ({
    sessionId: row.session_id,
    memberId: row.member_id,
    memberName: row.member_name,
    participantType: row.participant_type || "Cố định",
    level: row.participant_level !== null && row.participant_level !== undefined ? normalizeLevel(row.participant_level) : null,
    status: safeLower(row.status || "pending"),
    respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : ""
  }));
}

async function getPollBySession(sessionId) {
  const result = await query(`SELECT * FROM polls WHERE session_id = $1`, [sessionId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    pollId: row.poll_id,
    sessionId: row.session_id,
    question: row.question,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : ""
  };
}

async function getPollAnswersBySession(sessionId) {
  const result = await query(
    `
    SELECT poll_id, session_id, member_id, member_name, answer, answered_at
    FROM poll_answers
    WHERE session_id = $1
    ORDER BY member_name ASC
    `,
    [sessionId]
  );
  return result.rows.map((row) => ({
    pollId: row.poll_id,
    sessionId: row.session_id,
    memberId: row.member_id,
    memberName: row.member_name,
    answer: row.answer,
    answeredAt: row.answered_at ? new Date(row.answered_at).toISOString() : ""
  }));
}

async function getUpcomingSessionForMember(memberName) {
  const result = await query(
    `
    SELECT *
    FROM sessions
    WHERE (date || 'T' || COALESCE(time, '00:00')) >= $1
    ORDER BY date ASC, time ASC
    LIMIT 1
    `,
    [new Date().toISOString().slice(0, 16)]
  );
  const row = result.rows[0];
  if (!row) return null;
  const sessionId = row.session_id;
  const participants = await getSessionParticipants(sessionId);
  const mine = participants.find((item) => safeLower(item.memberName) === safeLower(memberName));
  const poll = await getPollBySession(sessionId);
  let myPollAnswer = "";
  if (poll) {
    const answers = await getPollAnswersBySession(sessionId);
    myPollAnswer =
      answers.find((item) => safeLower(item.memberName) === safeLower(memberName))?.answer || "";
  }
  return {
    sessionId,
    date: row.date,
    time: row.time || "",
    location: row.location || "",
    note: row.note || "",
    totalCost: toNumber(row.total_cost),
    myStatus: mine?.status || "pending",
    poll: poll
      ? {
          pollId: poll.pollId,
          question: poll.question,
          myAnswer: myPollAnswer
        }
      : null
  };
}

async function createSession(payload, createdBy = "admin") {
  const date = String(payload.date || "").trim();
  const time = String(payload.time || "").trim();
  if (!date || !time) throw new Error("Thiếu ngày hoặc giờ cho buổi chơi.");

  const sessionId = `S${Date.now()}`;
  const ts = nowIso();
  const location = String(payload.location || "").trim();
  const note = String(payload.note || "").trim();
  const pollQuestion = String(payload.pollQuestion || "").trim();

  await query(
    `
    INSERT INTO sessions(
      session_id, date, time, location, note, fixed_court_cost, extra_courts, shuttlecock_cost, total_cost, created_by, created_at
    )
    VALUES ($1,$2,$3,$4,$5,0,0,0,0,$6,$7)
    `,
    [sessionId, date, time, location, note, createdBy, ts]
  );

  const members = await getActiveFixedMembers();
  for (const member of members) {
    await query(
      `
      INSERT INTO session_participants(session_id, member_id, member_name, member_name_ci, participant_type, participant_level, status)
      VALUES ($1,$2,$3,$4,'Cố định',$5,'pending')
      ON CONFLICT(session_id, member_name_ci) DO NOTHING
      `,
      [sessionId, member.memberId, member.name, safeLower(member.name), normalizeLevel(member.level)]
    );
  }

  let poll = null;
  if (pollQuestion) {
    const pollId = `P${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await query(
      `
      INSERT INTO polls(poll_id, session_id, question, created_at)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT(session_id) DO UPDATE SET question = EXCLUDED.question
      `,
      [pollId, sessionId, pollQuestion, ts]
    );
    poll = { pollId, question: pollQuestion };
  }

  return { sessionId, totalCost: 0, poll };
}

async function settleSession({ sessionId, fixedCourtCost, extraCourts, shuttlecockCost, fixedMembers, guests }) {
  const targetSession = await getSessionById(sessionId);
  if (!targetSession) throw new Error("Không tìm thấy buổi chơi cần chốt.");

  const settings = await getSettings();
  const activeMembers = await getActiveFixedMembers();
  const fixedByName = {};
  (Array.isArray(fixedMembers) ? fixedMembers : []).forEach((item) => {
    const name = String(item?.name || "").trim();
    if (!name) return;
    fixedByName[safeLower(name)] = Boolean(item.present);
  });

  const payload = {
    date: targetSession.date,
    fixedCourtCost: toNumber(fixedCourtCost),
    extraCourts: Math.max(0, toNumber(extraCourts)),
    shuttlecockCost: Math.max(0, toNumber(shuttlecockCost)),
    fixedMembers: activeMembers.map((member) => ({
      name: member.name,
      present: Boolean(fixedByName[safeLower(member.name)])
    })),
    guests: (Array.isArray(guests) ? guests : [])
      .map((item) => ({
        name: String(item?.name || "").trim(),
        gender: normalizeGender(item?.gender)
      }))
      .filter((item) => item.name)
  };
  const calcResult = calculateSession(payload, settings);
  const ts = nowIso();

  for (const member of activeMembers) {
    await query(
      `
      INSERT INTO session_participants(session_id, member_id, member_name, member_name_ci, participant_type, participant_level, status, responded_at)
      VALUES ($1,$2,$3,$4,'Cố định',$5,$6,$7)
      ON CONFLICT(session_id, member_name_ci) DO UPDATE
      SET status = EXCLUDED.status, responded_at = EXCLUDED.responded_at, member_id = EXCLUDED.member_id, participant_type = 'Cố định', participant_level = EXCLUDED.participant_level
      `,
      [
        sessionId,
        member.memberId,
        member.name,
        safeLower(member.name),
        normalizeLevel(member.level),
        fixedByName[safeLower(member.name)] ? "yes" : "no",
        ts
      ]
    );
  }

  await query(`DELETE FROM participants WHERE session_id = $1`, [sessionId]);
  for (const participant of calcResult.participants) {
    await query(
      `
      INSERT INTO participants(session_id, date, name, type, gender, present, amount, note)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'')
      `,
      [
        sessionId,
        targetSession.date,
        participant.name,
        participant.type,
        participant.gender || "",
        Boolean(participant.present),
        Math.round(toNumber(participant.amount))
      ]
    );
  }

  await query(
    `
    UPDATE sessions
    SET fixed_court_cost = $2,
        extra_courts = $3,
        shuttlecock_cost = $4,
        total_cost = $5
    WHERE session_id = $1
    `,
    [sessionId, calcResult.fixedCourtCost, calcResult.extraCourts, calcResult.shuttlecockCost, calcResult.totalCost]
  );

  await recomputeDebts();
  return calcResult;
}

async function upsertMemberContact(memberName, phoneNumber) {
  const phone = normalizePhone(phoneNumber);
  if (!phone) throw new Error("Số điện thoại không được để trống.");
  const result = await query(
    `
    UPDATE members
    SET phone_number = $2, updated_at = NOW()
    WHERE LOWER(name) = LOWER($1)
    RETURNING *
    `,
    [memberName, phone]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Không tìm thấy thành viên.");
  return mapMember(row);
}

async function updateMemberLevel(memberName, level) {
  const result = await query(
    `
    UPDATE members
    SET level = $2, updated_at = NOW()
    WHERE LOWER(name) = LOWER($1)
    RETURNING *
    `,
    [memberName, normalizeLevel(level)]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Không tìm thấy thành viên.");
  return mapMember(row);
}

async function respondToSession({ sessionId, memberName, status, pollAnswer }) {
  const safeStatus = safeLower(status);
  if (!["yes", "no"].includes(safeStatus)) {
    throw new Error("Trạng thái tham gia chỉ nhận yes/no.");
  }
  const memberResult = await query(`SELECT * FROM members WHERE LOWER(name) = LOWER($1)`, [memberName]);
  const member = memberResult.rows[0];
  if (!member) throw new Error("Không tìm thấy thành viên.");

  const session = await getSessionById(sessionId);
  if (!session) throw new Error("Không tìm thấy buổi chơi.");

  const ts = nowIso();
  await query(
    `
    INSERT INTO session_participants(session_id, member_id, member_name, member_name_ci, participant_type, participant_level, status, responded_at)
    VALUES ($1,$2,$3,$4,'Cố định',$5,$6,$7)
    ON CONFLICT(session_id, member_name_ci) DO UPDATE
    SET status = EXCLUDED.status, responded_at = EXCLUDED.responded_at, member_id = EXCLUDED.member_id, participant_type = 'Cố định', participant_level = EXCLUDED.participant_level
    `,
    [sessionId, member.member_id, member.name, safeLower(member.name), normalizeLevel(member.level), safeStatus, ts]
  );

  const poll = await getPollBySession(sessionId);
  if (poll) {
    const answerText = String(pollAnswer || "").trim();
    if (!answerText) throw new Error("Buổi này có poll, bạn cần trả lời poll.");
    await query(
      `
      INSERT INTO poll_answers(poll_id, session_id, member_id, member_name, member_name_ci, answer, answered_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(session_id, member_name_ci) DO UPDATE
      SET answer = EXCLUDED.answer, answered_at = EXCLUDED.answered_at, poll_id = EXCLUDED.poll_id, member_id = EXCLUDED.member_id
      `,
      [poll.pollId, sessionId, member.member_id, member.name, safeLower(member.name), answerText, ts]
    );
  }

  return {
    sessionId,
    memberName: member.name,
    status: safeStatus
  };
}

async function addGuestToSession({ sessionId, guestName, level = 5, status = "yes" }) {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error("Không tìm thấy buổi chơi.");
  const name = String(guestName || "").trim();
  if (!name) throw new Error("Tên GL không được để trống.");
  const safeStatus = safeLower(status || "yes");
  if (!["yes", "no", "pending"].includes(safeStatus)) {
    throw new Error("Status của GL phải là yes/no/pending.");
  }
  const guestId = `g_${sessionId}_${crypto.randomUUID().slice(0, 8)}`;
  await query(
    `
    INSERT INTO session_participants(session_id, member_id, member_name, member_name_ci, participant_type, participant_level, status, responded_at)
    VALUES ($1,$2,$3,$4,'GL',$5,$6,$7)
    ON CONFLICT(session_id, member_name_ci) DO UPDATE
    SET participant_type = 'GL',
        participant_level = EXCLUDED.participant_level,
        status = EXCLUDED.status,
        responded_at = EXCLUDED.responded_at,
        member_id = EXCLUDED.member_id
    `,
    [sessionId, guestId, name, safeLower(name), normalizeLevel(level), safeStatus, nowIso()]
  );
  return {
    sessionId,
    guestId,
    guestName: name,
    status: safeStatus,
    level: normalizeLevel(level)
  };
}

async function addPayment({ date, memberName, amount, note }) {
  const safeAmount = toNumber(amount);
  if (safeAmount <= 0) throw new Error("Số tiền thanh toán phải lớn hơn 0.");
  const paymentId = crypto.randomUUID();
  const paymentDate = String(date || "").trim() || new Date().toISOString().slice(0, 10);
  const memberResult = await query(`SELECT * FROM members WHERE LOWER(name) = LOWER($1)`, [memberName]);
  const member = memberResult.rows[0];
  await query(
    `
    INSERT INTO payments(payment_id, date, member_id, member_name, amount, note, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    `,
    [
      paymentId,
      paymentDate,
      member?.member_id || "",
      member?.name || String(memberName || "").trim(),
      Math.round(safeAmount),
      String(note || "").trim(),
      nowIso()
    ]
  );
  await recomputeDebts();
}

async function recomputeDebts() {
  const [allMembers, activeFixedMembers, participantsResult, paymentsResult] = await Promise.all([
    getMembers(),
    getActiveFixedMembers(),
    query(`SELECT * FROM participants`),
    query(`SELECT * FROM payments`)
  ]);

  const memberByName = {};
  allMembers.forEach((member) => {
    memberByName[safeLower(member.name)] = member;
  });

  const dueByName = {};
  participantsResult.rows.forEach((row) => {
    if (!row.present) return;
    const name = String(row.name || "").trim();
    if (!name) return;
    dueByName[name] = (dueByName[name] || 0) + Math.round(toNumber(row.amount));
  });

  const paidByName = {};
  paymentsResult.rows.forEach((row) => {
    const name = String(row.member_name || "").trim();
    if (!name) return;
    paidByName[name] = (paidByName[name] || 0) + Math.round(toNumber(row.amount));
  });

  const names = new Set([
    ...activeFixedMembers.map((member) => member.name),
    ...Object.keys(dueByName),
    ...Object.keys(paidByName)
  ]);
  const ts = nowIso();

  await query(`DELETE FROM debts`);
  for (const name of names) {
    const member = memberByName[safeLower(name)] || null;
    const totalDue = Math.round(dueByName[name] || 0);
    const totalPaid = Math.round(paidByName[name] || 0);
    await query(
      `
      INSERT INTO debts(member_id, member_name, total_due, total_paid, balance, last_updated)
      VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [member?.memberId || "", member?.name || name, totalDue, totalPaid, totalDue - totalPaid, ts]
    );
  }
}

async function getDebts() {
  const result = await query(`SELECT * FROM debts ORDER BY member_name ASC`);
  return result.rows.map((row) => ({
    memberId: row.member_id || "",
    memberName: row.member_name,
    totalDue: Math.round(toNumber(row.total_due)),
    totalPaid: Math.round(toNumber(row.total_paid)),
    balance: Math.round(toNumber(row.balance)),
    lastUpdated: row.last_updated ? new Date(row.last_updated).toISOString() : ""
  }));
}

async function getPayments(limit = 1000) {
  const result = await query(
    `
    SELECT * FROM payments
    ORDER BY date DESC, created_at DESC
    LIMIT $1
    `,
    [Math.max(1, limit)]
  );
  return result.rows.map((row) => ({
    paymentId: row.payment_id,
    date: row.date,
    memberId: row.member_id || "",
    memberName: row.member_name,
    amount: Math.round(toNumber(row.amount)),
    note: row.note || "",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : ""
  }));
}

async function getMemberHistory(memberName, limit = 20) {
  const result = await query(
    `
    SELECT sp.session_id, sp.status, s.date, s.time, s.location, s.total_cost
    FROM session_participants sp
    LEFT JOIN sessions s ON s.session_id = sp.session_id
    WHERE sp.member_name_ci = $1
    ORDER BY s.date DESC, s.time DESC
    LIMIT $2
    `,
    [safeLower(memberName), Math.max(1, limit)]
  );
  return result.rows.map((row) => ({
    sessionId: row.session_id,
    date: row.date || "",
    time: row.time || "",
    location: row.location || "",
    status: safeLower(row.status || "pending"),
    totalCost: Math.round(toNumber(row.total_cost))
  }));
}

async function getPairHistoryCount() {
  const result = await query(`SELECT pair_key, COUNT(*)::int AS count FROM match_pair_history GROUP BY pair_key`);
  const map = {};
  result.rows.forEach((row) => {
    map[row.pair_key] = toNumber(row.count);
  });
  return map;
}

async function recordMatchPairs(sessionId, rounds, buildPairKey) {
  for (const roundItem of rounds) {
    for (const match of roundItem.matches) {
      const pairs = [
        [match.teamA[0].name, match.teamA[1].name],
        [match.teamB[0].name, match.teamB[1].name]
      ];
      for (const pair of pairs) {
        await query(
          `
          INSERT INTO match_pair_history(session_id, round, pair_key, member_a, member_b, created_at)
          VALUES ($1,$2,$3,$4,$5,$6)
          `,
          [sessionId, roundItem.round, buildPairKey(pair[0], pair[1]), pair[0], pair[1], nowIso()]
        );
      }
    }
  }
}

async function getMonthlyReport(month) {
  const safeMonth = parseCsvMonth(month);
  const [members, sessionsResult, participantsResult, paymentsResult, debts] = await Promise.all([
    getActiveFixedMembers(),
    query(`SELECT * FROM sessions WHERE date LIKE $1`, [`${safeMonth}%`]),
    query(`SELECT * FROM participants WHERE date LIKE $1`, [`${safeMonth}%`]),
    query(`SELECT * FROM payments WHERE date LIKE $1`, [`${safeMonth}%`]),
    getDebts()
  ]);

  const settledSessionSet = new Set(participantsResult.rows.map((row) => row.session_id));
  const monthlySessions = sessionsResult.rows.filter((session) => settledSessionSet.has(session.session_id));
  const monthlySessionIds = new Set(monthlySessions.map((session) => session.session_id));
  const totalSessions = monthlySessions.length;
  const totalMonthlyCost = monthlySessions.reduce((sum, session) => sum + Math.round(toNumber(session.total_cost)), 0);

  const attendanceYesByMember = {};
  participantsResult.rows.forEach((item) => {
    if (!monthlySessionIds.has(item.session_id)) return;
    if (!item.present) return;
    if (String(item.type || "").trim() !== "Cố định") return;
    const memberName = String(item.name || "").trim();
    if (!memberName) return;
    attendanceYesByMember[memberName] = (attendanceYesByMember[memberName] || 0) + 1;
  });

  const memberStats = members.map((member) => {
    const attended = attendanceYesByMember[member.name] || 0;
    return {
      memberId: member.memberId,
      memberName: member.name,
      attendedSessions: attended,
      totalSessions,
      attendanceRate: totalSessions > 0 ? Number((attended / totalSessions).toFixed(2)) : 0
    };
  });

  const paidByMember = {};
  paymentsResult.rows.forEach((payment) => {
    const key = String(payment.member_name || "").trim();
    if (!key) return;
    paidByMember[key] = (paidByMember[key] || 0) + Math.round(toNumber(payment.amount));
  });

  const topPayers = Object.entries(paidByMember)
    .map(([memberName, amount]) => ({ memberName, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const topDebtors = debts
    .filter((item) => item.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5)
    .map((item) => ({
      memberName: item.memberName,
      balance: item.balance
    }));

  return {
    month: safeMonth,
    totalMonthlyCost,
    totalSessions,
    attendanceByMember: memberStats,
    topDebtors,
    topPayers
  };
}

async function getSnapshotForSheetSync() {
  const [settings, members, sessions, participants, sessionParticipants, polls, pollAnswers, payments, debts, pairHistory] =
    await Promise.all([
      getSettings(),
      query(`SELECT * FROM members ORDER BY name ASC`),
      query(`SELECT * FROM sessions ORDER BY created_at ASC`),
      query(`SELECT * FROM participants ORDER BY id ASC`),
      query(`SELECT * FROM session_participants ORDER BY id ASC`),
      query(`SELECT * FROM polls ORDER BY created_at ASC`),
      query(`SELECT * FROM poll_answers ORDER BY id ASC`),
      query(`SELECT * FROM payments ORDER BY created_at ASC`),
      query(`SELECT * FROM debts ORDER BY member_name ASC`),
      query(`SELECT * FROM match_pair_history ORDER BY id ASC`)
    ]);

  return {
    config: Object.entries(settings).map(([key, value]) => ({ key, value })),
    members: members.rows.map((row) => ({
      memberId: row.member_id,
      name: row.name,
      type: row.type,
      gender: row.gender || "",
      level: normalizeLevel(row.level),
      active: row.active ? "TRUE" : "FALSE",
      phoneNumber: row.phone_number || "",
      zaloId: row.zalo_id || "",
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
    })),
    sessions: sessions.rows.map((row) => ({
      sessionId: row.session_id,
      date: row.date,
      time: row.time || "",
      location: row.location || "",
      note: row.note || "",
      fixedCourtCost: toNumber(row.fixed_court_cost),
      extraCourts: toNumber(row.extra_courts),
      shuttlecockCost: toNumber(row.shuttlecock_cost),
      totalCost: toNumber(row.total_cost),
      createdBy: row.created_by || "admin",
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : ""
    })),
    participants: participants.rows.map((row) => ({
      sessionId: row.session_id,
      date: row.date,
      name: row.name,
      type: row.type,
      gender: row.gender || "",
      present: row.present ? "TRUE" : "FALSE",
      amount: toNumber(row.amount),
      note: row.note || ""
    })),
    sessionParticipants: sessionParticipants.rows.map((row) => ({
      sessionId: row.session_id,
      memberId: row.member_id,
      memberName: row.member_name,
      status: row.status,
      respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : ""
    })),
    polls: polls.rows.map((row) => ({
      pollId: row.poll_id,
      sessionId: row.session_id,
      question: row.question,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : ""
    })),
    pollAnswers: pollAnswers.rows.map((row) => ({
      pollId: row.poll_id,
      sessionId: row.session_id,
      memberId: row.member_id,
      memberName: row.member_name,
      answer: row.answer,
      answeredAt: row.answered_at ? new Date(row.answered_at).toISOString() : ""
    })),
    payments: payments.rows.map((row) => ({
      paymentId: row.payment_id,
      date: row.date,
      memberId: row.member_id,
      memberName: row.member_name,
      amount: toNumber(row.amount),
      note: row.note || "",
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : ""
    })),
    debts: debts.rows.map((row) => ({
      memberId: row.member_id || "",
      memberName: row.member_name,
      totalDue: toNumber(row.total_due),
      totalPaid: toNumber(row.total_paid),
      balance: toNumber(row.balance),
      lastUpdated: row.last_updated ? new Date(row.last_updated).toISOString() : ""
    })),
    matchPairHistory: pairHistory.rows.map((row) => ({
      sessionId: row.session_id,
      round: toNumber(row.round),
      pairKey: row.pair_key,
      memberA: row.member_a,
      memberB: row.member_b,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : ""
    }))
  };
}

async function replaceAllDataFromSnapshot(snapshot) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM match_pair_history");
    await client.query("DELETE FROM debts");
    await client.query("DELETE FROM payments");
    await client.query("DELETE FROM participants");
    await client.query("DELETE FROM poll_answers");
    await client.query("DELETE FROM polls");
    await client.query("DELETE FROM session_participants");
    await client.query("DELETE FROM sessions");
    await client.query("DELETE FROM members");
    await client.query("DELETE FROM settings");

    for (const row of snapshot.config || []) {
      await client.query(`INSERT INTO settings(key, value) VALUES ($1,$2)`, [
        String(row.key || "").trim(),
        String(row.value ?? "")
      ]);
    }

    for (const row of snapshot.members || []) {
      await client.query(
        `
        INSERT INTO members(member_id, name, type, gender, level, active, phone_number, zalo_id, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          String(row.memberId || "").trim() || buildMemberId(row.name || "", 0),
          String(row.name || "").trim(),
          String(row.type || "Cố định").trim() || "Cố định",
          String(row.gender || "").trim(),
          normalizeLevel(row.level),
          String(row.active || "TRUE").toUpperCase() !== "FALSE",
          normalizePhone(row.phoneNumber || row.phone_number),
          String(row.zaloId || row.zalo_id || "").trim(),
          String(row.createdAt || nowIso()),
          String(row.updatedAt || nowIso())
        ]
      );
    }

    for (const row of snapshot.sessions || []) {
      await client.query(
        `
        INSERT INTO sessions(session_id, date, time, location, note, fixed_court_cost, extra_courts, shuttlecock_cost, total_cost, created_by, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `,
        [
          String(row.sessionId || "").trim(),
          String(row.date || "").trim(),
          String(row.time || "").trim(),
          String(row.location || "").trim(),
          String(row.note || "").trim(),
          Math.round(toNumber(row.fixedCourtCost)),
          Math.round(toNumber(row.extraCourts)),
          Math.round(toNumber(row.shuttlecockCost)),
          Math.round(toNumber(row.totalCost)),
          String(row.createdBy || "admin"),
          String(row.createdAt || nowIso())
        ]
      );
    }

    for (const row of snapshot.sessionParticipants || []) {
      const memberName = String(row.memberName || "").trim();
      await client.query(
        `
        INSERT INTO session_participants(session_id, member_id, member_name, member_name_ci, status, responded_at)
      VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          String(row.sessionId || "").trim(),
          String(row.memberId || "").trim(),
          memberName,
          safeLower(memberName),
          String(row.status || "pending").trim().toLowerCase(),
          row.respondedAt ? String(row.respondedAt) : null
        ]
      );
    }

    for (const row of snapshot.polls || []) {
      await client.query(
        `INSERT INTO polls(poll_id, session_id, question, created_at) VALUES ($1,$2,$3,$4)`,
        [
          String(row.pollId || "").trim(),
          String(row.sessionId || "").trim(),
          String(row.question || "").trim(),
          String(row.createdAt || nowIso())
        ]
      );
    }

    for (const row of snapshot.pollAnswers || []) {
      const memberName = String(row.memberName || "").trim();
      await client.query(
        `
        INSERT INTO poll_answers(poll_id, session_id, member_id, member_name, member_name_ci, answer, answered_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          String(row.pollId || "").trim(),
          String(row.sessionId || "").trim(),
          String(row.memberId || "").trim(),
          memberName,
          safeLower(memberName),
          String(row.answer || "").trim(),
          String(row.answeredAt || nowIso())
        ]
      );
    }

    for (const row of snapshot.participants || []) {
      await client.query(
        `
        INSERT INTO participants(session_id, date, name, type, gender, present, amount, note)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          String(row.sessionId || "").trim(),
          String(row.date || "").trim(),
          String(row.name || "").trim(),
          String(row.type || "").trim(),
          String(row.gender || "").trim(),
          String(row.present || "TRUE").toUpperCase() !== "FALSE",
          Math.round(toNumber(row.amount)),
          String(row.note || "").trim()
        ]
      );
    }

    for (const row of snapshot.payments || []) {
      await client.query(
        `
        INSERT INTO payments(payment_id, date, member_id, member_name, amount, note, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          String(row.paymentId || "").trim() || crypto.randomUUID(),
          String(row.date || "").trim(),
          String(row.memberId || "").trim(),
          String(row.memberName || "").trim(),
          Math.round(toNumber(row.amount)),
          String(row.note || "").trim(),
          String(row.createdAt || nowIso())
        ]
      );
    }

    for (const row of snapshot.debts || []) {
      await client.query(
        `
        INSERT INTO debts(member_id, member_name, total_due, total_paid, balance, last_updated)
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          String(row.memberId || "").trim(),
          String(row.memberName || "").trim(),
          Math.round(toNumber(row.totalDue)),
          Math.round(toNumber(row.totalPaid)),
          Math.round(toNumber(row.balance)),
          String(row.lastUpdated || nowIso())
        ]
      );
    }

    for (const row of snapshot.matchPairHistory || []) {
      await client.query(
        `
        INSERT INTO match_pair_history(session_id, round, pair_key, member_a, member_b, created_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          String(row.sessionId || "").trim(),
          Math.round(toNumber(row.round)),
          String(row.pairKey || "").trim(),
          String(row.memberA || "").trim(),
          String(row.memberB || "").trim(),
          String(row.createdAt || nowIso())
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  initializeDatabase,
  getSettings,
  getMembers,
  getActiveFixedMembers,
  getRecentSessions,
  getSessionById,
  getSessionParticipants,
  getPollBySession,
  getPollAnswersBySession,
  getUpcomingSessionForMember,
  createSession,
  settleSession,
  upsertMemberContact,
  updateMemberLevel,
  respondToSession,
  addGuestToSession,
  addPayment,
  recomputeDebts,
  getDebts,
  getPayments,
  getMemberHistory,
  getPairHistoryCount,
  recordMatchPairs,
  getMonthlyReport,
  getSnapshotForSheetSync,
  replaceAllDataFromSnapshot
};
