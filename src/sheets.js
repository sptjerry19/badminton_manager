const fs = require("fs");
const crypto = require("crypto");
const { google } = require("googleapis");
const { calculateSession } = require("./calc");
const {
  GOOGLE_SHEET_ID,
  GOOGLE_APPLICATION_CREDENTIALS,
  DEFAULT_SETTINGS,
  DEFAULT_FIXED_MEMBERS
} = require("./config");

const SHEETS = {
  config: "Config",
  members: "Members",
  sessions: "Sessions",
  participants: "Participants",
  sessionParticipants: "SessionParticipants",
  polls: "Polls",
  pollAnswers: "PollAnswers",
  payments: "Payments",
  debts: "Debts",
  matchPairHistory: "MatchPairHistory"
};

const HEADERS = {
  Config: ["key", "value"],
  Members: ["memberId", "name", "type", "gender", "level", "active", "phoneNumber", "zaloId", "createdAt", "updatedAt"],
  Sessions: [
    "sessionId",
    "date",
    "time",
    "location",
    "note",
    "fixedCourtCost",
    "extraCourts",
    "shuttlecockCost",
    "totalCost",
    "createdBy",
    "createdAt"
  ],
  Participants: ["sessionId", "date", "name", "type", "gender", "present", "amount", "note"],
  SessionParticipants: ["sessionId", "memberId", "memberName", "status", "respondedAt"],
  Polls: ["pollId", "sessionId", "question", "createdAt"],
  PollAnswers: ["pollId", "sessionId", "memberId", "memberName", "answer", "answeredAt"],
  Payments: ["paymentId", "date", "memberId", "memberName", "amount", "note", "createdAt"],
  Debts: ["memberId", "memberName", "totalDue", "totalPaid", "balance", "lastUpdated"],
  MatchPairHistory: ["sessionId", "round", "pairKey", "memberA", "memberB", "createdAt"]
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

function normalizePhone(value) {
  return String(value || "").trim();
}

function buildMemberId(name, index = 0) {
  const slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `m_${slug || "member"}_${index + 1}`;
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

function loadCredentials() {
  const jsonFromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (jsonFromEnv) {
    try {
      return JSON.parse(jsonFromEnv);
    } catch (_error) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON không phải JSON hợp lệ.");
    }
  }

  if (!fs.existsSync(GOOGLE_APPLICATION_CREDENTIALS)) {
    throw new Error(
      `Không tìm thấy credentials tại ${GOOGLE_APPLICATION_CREDENTIALS}. ` +
        "Hãy tạo credentials.json hoặc dùng GOOGLE_SERVICE_ACCOUNT_JSON."
    );
  }
  return JSON.parse(fs.readFileSync(GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
}

async function getClient() {
  if (!GOOGLE_SHEET_ID) {
    throw new Error("Thiếu GOOGLE_SHEET_ID trong biến môi trường.");
  }

  const credentials = loadCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({
    version: "v4",
    auth
  });
}

async function getSheetTitles(sheets) {
  const info = await sheets.spreadsheets.get({
    spreadsheetId: GOOGLE_SHEET_ID
  });
  return (info.data.sheets || []).map((s) => s.properties.title);
}

async function batchUpdateSpreadsheet(requests) {
  const sheets = await getClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: { requests }
  });
}

async function ensureSheetsExist() {
  const sheets = await getClient();
  const existingTitles = await getSheetTitles(sheets);
  const requests = [];

  Object.values(SHEETS).forEach((title) => {
    if (!existingTitles.includes(title)) {
      requests.push({ addSheet: { properties: { title } } });
    }
  });

  if (requests.length) await batchUpdateSpreadsheet(requests);
}

async function clearRange(range) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEET_ID,
    range
  });
}

async function writeRows(range, values) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });
}

async function appendRows(range, values) {
  if (!values.length) return;
  const sheets = await getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values }
  });
}

async function readRows(range) {
  const sheets = await getClient();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range
  });
  return result.data.values || [];
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const [header, ...data] = rows;
  return data
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
    .map((row) => {
      const item = {};
      header.forEach((key, index) => {
        item[key] = row[index] ?? "";
      });
      return item;
    });
}

async function ensureHeader(title, header) {
  const rows = await readRows(`${title}!A1:Z1`);
  if (!rows.length || rows[0].join("|") !== header.join("|")) {
    await writeRows(`${title}!A1`, [header]);
  }
}

async function rewriteSheet(title, header, rows) {
  const values = rows.map((row) => header.map((key) => row[key] ?? ""));
  await clearRange(`${title}!A2:Z100000`);
  if (values.length) {
    await writeRows(`${title}!A2`, values);
  }
}

async function getMembers() {
  const rows = rowsToObjects(await readRows(`${SHEETS.members}!A1:J5000`));
  return rows
    .map((row, index) => {
      const name = String(row.name || row.memberName || "").trim();
      if (!name) return null;
      return {
        memberId: String(row.memberId || buildMemberId(name, index)).trim(),
        name,
        type: String(row.type || "Cố định").trim() || "Cố định",
        gender: String(row.gender || "").trim(),
        level: normalizeLevel(row.level),
        active: String(row.active || "TRUE").toUpperCase() !== "FALSE",
        phoneNumber: normalizePhone(row.phoneNumber || row.phone_number),
        zaloId: String(row.zaloId || row.zalo_id || "").trim(),
        createdAt: String(row.createdAt || nowIso()),
        updatedAt: String(row.updatedAt || nowIso())
      };
    })
    .filter(Boolean);
}

async function getActiveFixedMembers() {
  const members = await getMembers();
  return members.filter((member) => member.active && member.type === "Cố định");
}

async function initializeSpreadsheet() {
  await ensureSheetsExist();
  await Promise.all([
    ensureHeader(SHEETS.config, HEADERS.Config),
    ensureHeader(SHEETS.members, HEADERS.Members),
    ensureHeader(SHEETS.sessions, HEADERS.Sessions),
    ensureHeader(SHEETS.participants, HEADERS.Participants),
    ensureHeader(SHEETS.sessionParticipants, HEADERS.SessionParticipants),
    ensureHeader(SHEETS.polls, HEADERS.Polls),
    ensureHeader(SHEETS.pollAnswers, HEADERS.PollAnswers),
    ensureHeader(SHEETS.payments, HEADERS.Payments),
    ensureHeader(SHEETS.debts, HEADERS.Debts),
    ensureHeader(SHEETS.matchPairHistory, HEADERS.MatchPairHistory)
  ]);

  const configRows = rowsToObjects(await readRows(`${SHEETS.config}!A1:B200`));
  if (!configRows.length) {
    const configValues = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [key, value]);
    await writeRows(`${SHEETS.config}!A2`, configValues);
  }

  const members = await getMembers();
  if (!members.length) {
    const ts = nowIso();
    const defaults = DEFAULT_FIXED_MEMBERS.map((name, index) => ({
      memberId: buildMemberId(name, index),
      name,
      type: "Cố định",
      gender: "",
      level: 5,
      active: "TRUE",
      phoneNumber: "",
      zaloId: "",
      createdAt: ts,
      updatedAt: ts
    }));
    await writeRows(
      `${SHEETS.members}!A2`,
      defaults.map((row) => HEADERS.Members.map((key) => row[key] ?? ""))
    );
  } else {
    const normalized = members.map((member) => ({
      ...member,
      active: member.active ? "TRUE" : "FALSE"
    }));
    await rewriteSheet(SHEETS.members, HEADERS.Members, normalized);
  }
}

async function getSettings() {
  const rows = rowsToObjects(await readRows(`${SHEETS.config}!A1:B200`));
  const map = {};
  rows.forEach((row) => {
    map[row.key] = toNumber(row.value, row.value);
  });
  return {
    ...DEFAULT_SETTINGS,
    ...map
  };
}

async function getRecentSessions(limit = 20) {
  const sessions = rowsToObjects(await readRows(`${SHEETS.sessions}!A1:K10000`));
  const participants = rowsToObjects(await readRows(`${SHEETS.sessionParticipants}!A1:E30000`));
  const settledParticipants = rowsToObjects(await readRows(`${SHEETS.participants}!A1:H50000`));
  const bySession = {};
  const settledBySession = {};
  participants.forEach((row) => {
    const sessionId = String(row.sessionId || "").trim();
    if (!sessionId) return;
    const status = safeLower(row.status || "pending");
    if (!bySession[sessionId]) bySession[sessionId] = { yes: 0, no: 0, pending: 0 };
    if (status === "yes") bySession[sessionId].yes += 1;
    else if (status === "no") bySession[sessionId].no += 1;
    else bySession[sessionId].pending += 1;
  });
  settledParticipants.forEach((row) => {
    const sessionId = String(row.sessionId || "").trim();
    if (!sessionId) return;
    settledBySession[sessionId] = true;
  });

  const mapped = sessions.map((row) => ({
    sessionId: row.sessionId,
    date: row.date,
    time: row.time || "",
    location: row.location || "",
    note: row.note || "",
    fixedCourtCost: toNumber(row.fixedCourtCost),
    extraCourts: toNumber(row.extraCourts),
    shuttlecockCost: toNumber(row.shuttlecockCost),
    totalCost: toNumber(row.totalCost),
    createdBy: row.createdBy || "admin",
    createdAt: row.createdAt || "",
    stats: bySession[row.sessionId] || { yes: 0, no: 0, pending: 0 },
    settled: Boolean(settledBySession[row.sessionId])
  }));

  mapped.sort((a, b) => dateTimeKey(b.date, b.time).localeCompare(dateTimeKey(a.date, a.time)));
  return mapped.slice(0, Math.max(1, limit));
}

async function getSessionById(sessionId) {
  const rows = rowsToObjects(await readRows(`${SHEETS.sessions}!A1:K10000`));
  const row = rows.find((item) => String(item.sessionId || "").trim() === sessionId);
  if (!row) return null;
  return {
    sessionId: row.sessionId,
    date: row.date,
    time: row.time || "",
    location: row.location || "",
    note: row.note || "",
    fixedCourtCost: toNumber(row.fixedCourtCost),
    extraCourts: toNumber(row.extraCourts),
    shuttlecockCost: toNumber(row.shuttlecockCost),
    totalCost: toNumber(row.totalCost),
    createdBy: row.createdBy || "admin",
    createdAt: row.createdAt || ""
  };
}

async function getSessionParticipants(sessionId) {
  const rows = rowsToObjects(await readRows(`${SHEETS.sessionParticipants}!A1:E30000`));
  return rows
    .filter((row) => String(row.sessionId || "").trim() === sessionId)
    .map((row) => ({
      sessionId: row.sessionId,
      memberId: row.memberId,
      memberName: row.memberName,
      status: safeLower(row.status || "pending"),
      respondedAt: row.respondedAt || ""
    }));
}

async function getPollBySession(sessionId) {
  const rows = rowsToObjects(await readRows(`${SHEETS.polls}!A1:D10000`));
  const poll = rows.find((row) => String(row.sessionId || "").trim() === sessionId);
  if (!poll) return null;
  return {
    pollId: poll.pollId,
    sessionId: poll.sessionId,
    question: poll.question,
    createdAt: poll.createdAt || ""
  };
}

async function getPollAnswersBySession(sessionId) {
  const rows = rowsToObjects(await readRows(`${SHEETS.pollAnswers}!A1:F30000`));
  return rows
    .filter((row) => String(row.sessionId || "").trim() === sessionId)
    .map((row) => ({
      pollId: row.pollId,
      sessionId: row.sessionId,
      memberId: row.memberId,
      memberName: row.memberName,
      answer: row.answer,
      answeredAt: row.answeredAt || ""
    }));
}

async function getUpcomingSessionForMember(memberName) {
  const sessions = rowsToObjects(await readRows(`${SHEETS.sessions}!A1:K10000`));
  const now = new Date().toISOString().slice(0, 16);
  const upcoming = sessions
    .filter((row) => dateTimeKey(row.date, row.time || "00:00") >= now)
    .sort((a, b) => dateTimeKey(a.date, a.time || "00:00").localeCompare(dateTimeKey(b.date, b.time || "00:00")))[0];

  if (!upcoming) return null;
  const participants = await getSessionParticipants(upcoming.sessionId);
  const mine = participants.find((item) => safeLower(item.memberName) === safeLower(memberName));
  const poll = await getPollBySession(upcoming.sessionId);
  let myPollAnswer = "";
  if (poll) {
    const answers = await getPollAnswersBySession(upcoming.sessionId);
    const answer = answers.find((item) => safeLower(item.memberName) === safeLower(memberName));
    myPollAnswer = answer?.answer || "";
  }

  return {
    sessionId: upcoming.sessionId,
    date: upcoming.date,
    time: upcoming.time || "",
    location: upcoming.location || "",
    note: upcoming.note || "",
    totalCost: toNumber(upcoming.totalCost),
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

  await appendRows(`${SHEETS.sessions}!A:K`, [
    [sessionId, date, time, location, note, "", "", "", "", createdBy, ts]
  ]);

  const members = await getActiveFixedMembers();
  const participantRows = members.map((member) => [sessionId, member.memberId, member.name, "pending", ""]);
  await appendRows(`${SHEETS.sessionParticipants}!A:E`, participantRows);

  let poll = null;
  if (pollQuestion) {
    const pollId = `P${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await appendRows(`${SHEETS.polls}!A:D`, [[pollId, sessionId, pollQuestion, ts]]);
    poll = { pollId, question: pollQuestion };
  }

  await recomputeDebts();
  return {
    sessionId,
    totalCost: 0,
    poll
  };
}

async function settleSession({ sessionId, fixedCourtCost, extraCourts, shuttlecockCost, fixedMembers, guests }) {
  const targetSession = await getSessionById(sessionId);
  if (!targetSession) throw new Error("Không tìm thấy buổi chơi cần chốt.");

  const settings = await getSettings();
  const activeMembers = await getActiveFixedMembers();
  const fixedByName = {};
  fixedMembers.forEach((item) => {
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

  // Update session participants based on actual attendance.
  const sessionParticipants = rowsToObjects(await readRows(`${SHEETS.sessionParticipants}!A1:E30000`));
  const participantRows = sessionParticipants.map((row) => {
    if (String(row.sessionId || "").trim() !== sessionId) return row;
    const isFixed = activeMembers.some((m) => safeLower(m.name) === safeLower(row.memberName));
    if (!isFixed) return row;
    return {
      ...row,
      status: Boolean(fixedByName[safeLower(row.memberName)]) ? "yes" : "no",
      respondedAt: nowIso()
    };
  });
  await rewriteSheet(SHEETS.sessionParticipants, HEADERS.SessionParticipants, participantRows);

  // Remove old settlement rows of the same session then append fresh rows.
  const allParticipants = rowsToObjects(await readRows(`${SHEETS.participants}!A1:H50000`));
  const kept = allParticipants.filter((row) => String(row.sessionId || "").trim() !== sessionId);
  await rewriteSheet(SHEETS.participants, HEADERS.Participants, kept);
  const participantFeeRows = calcResult.participants.map((participant) => [
    sessionId,
    targetSession.date,
    participant.name,
    participant.type,
    participant.gender || "",
    participant.present ? "TRUE" : "FALSE",
    Math.round(toNumber(participant.amount)),
    ""
  ]);
  await appendRows(`${SHEETS.participants}!A:H`, participantFeeRows);

  const sessions = rowsToObjects(await readRows(`${SHEETS.sessions}!A1:K10000`));
  const updatedSessions = sessions.map((row) => {
    if (String(row.sessionId || "").trim() !== sessionId) return row;
    return {
      ...row,
      fixedCourtCost: calcResult.fixedCourtCost,
      extraCourts: calcResult.extraCourts,
      shuttlecockCost: calcResult.shuttlecockCost,
      totalCost: calcResult.totalCost
    };
  });
  await rewriteSheet(SHEETS.sessions, HEADERS.Sessions, updatedSessions);

  await recomputeDebts();
  return calcResult;
}

async function upsertMemberContact(memberName, phoneNumber) {
  const members = await getMembers();
  const target = members.find((item) => safeLower(item.name) === safeLower(memberName));
  if (!target) throw new Error("Không tìm thấy thành viên.");
  const phone = normalizePhone(phoneNumber);
  if (!phone) throw new Error("Số điện thoại không được để trống.");
  target.phoneNumber = phone;
  target.updatedAt = nowIso();
  await rewriteSheet(
    SHEETS.members,
    HEADERS.Members,
    members.map((item) => ({
      ...item,
      active: item.active ? "TRUE" : "FALSE"
    }))
  );
  return target;
}

async function updateMemberLevel(memberName, level) {
  const members = await getMembers();
  const target = members.find((item) => safeLower(item.name) === safeLower(memberName));
  if (!target) throw new Error("Không tìm thấy thành viên.");
  target.level = normalizeLevel(level);
  target.updatedAt = nowIso();

  await rewriteSheet(
    SHEETS.members,
    HEADERS.Members,
    members.map((item) => ({
      ...item,
      active: item.active ? "TRUE" : "FALSE"
    }))
  );

  return target;
}

async function respondToSession({ sessionId, memberName, status, pollAnswer }) {
  const safeStatus = safeLower(status);
  if (!["yes", "no"].includes(safeStatus)) {
    throw new Error("Trạng thái tham gia chỉ nhận yes/no.");
  }

  const members = await getMembers();
  const member = members.find((item) => safeLower(item.name) === safeLower(memberName));
  if (!member) throw new Error("Không tìm thấy thành viên.");

  const session = await getSessionById(sessionId);
  if (!session) throw new Error("Không tìm thấy buổi chơi.");

  const participantRows = rowsToObjects(await readRows(`${SHEETS.sessionParticipants}!A1:E30000`));
  const idx = participantRows.findIndex(
    (row) => String(row.sessionId || "").trim() === sessionId && safeLower(row.memberName) === safeLower(memberName)
  );

  const respondedAt = nowIso();
  if (idx >= 0) {
    participantRows[idx].status = safeStatus;
    participantRows[idx].respondedAt = respondedAt;
  } else {
    participantRows.push({
      sessionId,
      memberId: member.memberId,
      memberName: member.name,
      status: safeStatus,
      respondedAt
    });
  }

  await rewriteSheet(SHEETS.sessionParticipants, HEADERS.SessionParticipants, participantRows);

  const poll = await getPollBySession(sessionId);
  if (poll) {
    const answerText = String(pollAnswer || "").trim();
    if (answerText) {
      const answerRows = rowsToObjects(await readRows(`${SHEETS.pollAnswers}!A1:F30000`));
      const answerIdx = answerRows.findIndex(
        (row) => String(row.sessionId || "").trim() === sessionId && safeLower(row.memberName) === safeLower(memberName)
      );
      const answerRow = {
        pollId: poll.pollId,
        sessionId,
        memberId: member.memberId,
        memberName: member.name,
        answer: answerText,
        answeredAt: respondedAt
      };
      if (answerIdx >= 0) answerRows[answerIdx] = answerRow;
      else answerRows.push(answerRow);
      await rewriteSheet(SHEETS.pollAnswers, HEADERS.PollAnswers, answerRows);
    }
  }

  await recomputeDebts();
  return {
    sessionId,
    memberName: member.name,
    status: safeStatus
  };
}

async function addPayment({ date, memberName, amount, note }) {
  const safeAmount = toNumber(amount);
  if (safeAmount <= 0) throw new Error("Số tiền thanh toán phải lớn hơn 0.");
  const safeMemberName = String(memberName || "").trim();
  if (!safeMemberName) throw new Error("Thiếu memberName.");
  const members = await getMembers();
  const member = members.find((item) => safeLower(item.name) === safeLower(safeMemberName));

  const paymentId = crypto.randomUUID();
  const paymentDate = String(date || "").trim() || new Date().toISOString().slice(0, 10);
  await appendRows(`${SHEETS.payments}!A:G`, [
    [
      paymentId,
      paymentDate,
      member?.memberId || "",
      member?.name || safeMemberName,
      Math.round(safeAmount),
      String(note || "").trim(),
      nowIso()
    ]
  ]);
  await recomputeDebts();
}

async function recomputeDebts() {
  const [allMembers, activeFixedMembers, legacyParticipants, paymentRows] = await Promise.all([
    getMembers(),
    getActiveFixedMembers(),
    rowsToObjects(await readRows(`${SHEETS.participants}!A1:H50000`)),
    rowsToObjects(await readRows(`${SHEETS.payments}!A1:G30000`))
  ]);

  const memberById = {};
  const memberByName = {};
  allMembers.forEach((member) => {
    memberById[member.memberId] = member;
    memberByName[safeLower(member.name)] = member;
  });

  const dueByName = {};
  legacyParticipants.forEach((row) => {
    const name = String(row.name || "").trim();
    if (!name) return;
    const present = String(row.present || "TRUE").toUpperCase() !== "FALSE";
    if (!present) return;
    dueByName[name] = (dueByName[name] || 0) + Math.round(toNumber(row.amount));
  });

  const paidByName = {};
  paymentRows.forEach((row) => {
    const name = String(row.memberName || "").trim();
    if (!name) return;
    paidByName[name] = (paidByName[name] || 0) + Math.round(toNumber(row.amount));
  });

  const names = new Set([
    ...activeFixedMembers.map((member) => member.name),
    ...Object.keys(dueByName),
    ...Object.keys(paidByName)
  ]);
  const ts = nowIso();
  const debtRows = Array.from(names)
    .map((name) => {
      const member = memberByName[safeLower(name)] || null;
      const totalDue = Math.round(dueByName[name] || 0);
      const totalPaid = Math.round(paidByName[name] || 0);
      return {
        memberId: member?.memberId || "",
        memberName: member?.name || name,
        totalDue,
        totalPaid,
        balance: totalDue - totalPaid,
        lastUpdated: ts
      };
    })
    .sort((a, b) => a.memberName.localeCompare(b.memberName));

  await rewriteSheet(SHEETS.debts, HEADERS.Debts, debtRows);
}

async function getDebts() {
  const rows = rowsToObjects(await readRows(`${SHEETS.debts}!A1:F10000`));
  return rows.map((row) => ({
    memberId: row.memberId,
    memberName: row.memberName,
    totalDue: Math.round(toNumber(row.totalDue)),
    totalPaid: Math.round(toNumber(row.totalPaid)),
    balance: Math.round(toNumber(row.balance)),
    lastUpdated: row.lastUpdated || ""
  }));
}

async function getPayments(limit = 1000) {
  const rows = rowsToObjects(await readRows(`${SHEETS.payments}!A1:G30000`));
  const mapped = rows.map((row) => ({
    paymentId: row.paymentId,
    date: row.date,
    memberId: row.memberId,
    memberName: row.memberName,
    amount: Math.round(toNumber(row.amount)),
    note: row.note || "",
    createdAt: row.createdAt || ""
  }));
  mapped.sort((a, b) => b.date.localeCompare(a.date));
  return mapped.slice(0, limit);
}

async function getMemberHistory(memberName, limit = 20) {
  const sessions = rowsToObjects(await readRows(`${SHEETS.sessions}!A1:K10000`));
  const participants = rowsToObjects(await readRows(`${SHEETS.sessionParticipants}!A1:E30000`));
  const bySession = {};
  sessions.forEach((s) => {
    bySession[s.sessionId] = s;
  });

  const rows = participants
    .filter((item) => safeLower(item.memberName) === safeLower(memberName))
    .map((item) => {
      const session = bySession[item.sessionId] || {};
      return {
        sessionId: item.sessionId,
        date: session.date || "",
        time: session.time || "",
        location: session.location || "",
        status: safeLower(item.status || "pending"),
        totalCost: Math.round(toNumber(session.totalCost))
      };
    })
    .sort((a, b) => dateTimeKey(b.date, b.time).localeCompare(dateTimeKey(a.date, a.time)));
  return rows.slice(0, limit);
}

async function getPairHistoryCount() {
  const rows = rowsToObjects(await readRows(`${SHEETS.matchPairHistory}!A1:F50000`));
  const map = {};
  rows.forEach((row) => {
    const key = String(row.pairKey || "").trim();
    if (!key) return;
    map[key] = (map[key] || 0) + 1;
  });
  return map;
}

async function recordMatchPairs(sessionId, rounds, buildPairKey) {
  const rows = [];
  rounds.forEach((roundItem) => {
    roundItem.matches.forEach((match) => {
      const pairs = [
        [match.teamA[0].name, match.teamA[1].name],
        [match.teamB[0].name, match.teamB[1].name]
      ];
      pairs.forEach((pair) => {
        rows.push([
          sessionId,
          roundItem.round,
          buildPairKey(pair[0], pair[1]),
          pair[0],
          pair[1],
          nowIso()
        ]);
      });
    });
  });
  await appendRows(`${SHEETS.matchPairHistory}!A:F`, rows);
}

async function getMonthlyReport(month) {
  const safeMonth = parseCsvMonth(month);
  const [members, sessions, settlementParticipants, payments, debts] = await Promise.all([
    getActiveFixedMembers(),
    rowsToObjects(await readRows(`${SHEETS.sessions}!A1:K10000`)),
    rowsToObjects(await readRows(`${SHEETS.participants}!A1:H50000`)),
    rowsToObjects(await readRows(`${SHEETS.payments}!A1:G30000`)),
    getDebts()
  ]);

  const settlementCountBySession = {};
  settlementParticipants.forEach((row) => {
    const sessionId = String(row.sessionId || "").trim();
    if (!sessionId) return;
    settlementCountBySession[sessionId] = (settlementCountBySession[sessionId] || 0) + 1;
  });

  const monthlySessions = sessions.filter(
    (session) =>
      String(session.date || "").startsWith(safeMonth) && settlementCountBySession[String(session.sessionId || "").trim()] > 0
  );
  const monthlySessionIds = new Set(monthlySessions.map((session) => String(session.sessionId || "").trim()));
  const totalSessions = monthlySessions.length;
  const totalMonthlyCost = monthlySessions.reduce((sum, session) => sum + Math.round(toNumber(session.totalCost)), 0);

  const attendanceYesByMember = {};
  settlementParticipants.forEach((item) => {
    const sessionId = String(item.sessionId || "").trim();
    if (!monthlySessionIds.has(sessionId)) return;
    if (String(item.present || "TRUE").toUpperCase() === "FALSE") return;
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
  payments.forEach((payment) => {
    if (!String(payment.date || "").startsWith(safeMonth)) return;
    const key = String(payment.memberName || "").trim();
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

async function getSnapshotFromSheets() {
  await initializeSpreadsheet();
  return {
    config: rowsToObjects(await readRows(`${SHEETS.config}!A1:B1000`)),
    members: rowsToObjects(await readRows(`${SHEETS.members}!A1:J10000`)),
    sessions: rowsToObjects(await readRows(`${SHEETS.sessions}!A1:K50000`)),
    participants: rowsToObjects(await readRows(`${SHEETS.participants}!A1:H100000`)),
    sessionParticipants: rowsToObjects(await readRows(`${SHEETS.sessionParticipants}!A1:E100000`)),
    polls: rowsToObjects(await readRows(`${SHEETS.polls}!A1:D50000`)),
    pollAnswers: rowsToObjects(await readRows(`${SHEETS.pollAnswers}!A1:F100000`)),
    payments: rowsToObjects(await readRows(`${SHEETS.payments}!A1:G100000`)),
    debts: rowsToObjects(await readRows(`${SHEETS.debts}!A1:F100000`)),
    matchPairHistory: rowsToObjects(await readRows(`${SHEETS.matchPairHistory}!A1:F100000`))
  };
}

async function syncSnapshotToSheets(snapshot) {
  await initializeSpreadsheet();
  await rewriteSheet(SHEETS.config, HEADERS.Config, snapshot.config || []);
  await rewriteSheet(SHEETS.members, HEADERS.Members, snapshot.members || []);
  await rewriteSheet(SHEETS.sessions, HEADERS.Sessions, snapshot.sessions || []);
  await rewriteSheet(SHEETS.participants, HEADERS.Participants, snapshot.participants || []);
  await rewriteSheet(
    SHEETS.sessionParticipants,
    HEADERS.SessionParticipants,
    snapshot.sessionParticipants || []
  );
  await rewriteSheet(SHEETS.polls, HEADERS.Polls, snapshot.polls || []);
  await rewriteSheet(SHEETS.pollAnswers, HEADERS.PollAnswers, snapshot.pollAnswers || []);
  await rewriteSheet(SHEETS.payments, HEADERS.Payments, snapshot.payments || []);
  await rewriteSheet(SHEETS.debts, HEADERS.Debts, snapshot.debts || []);
  await rewriteSheet(
    SHEETS.matchPairHistory,
    HEADERS.MatchPairHistory,
    snapshot.matchPairHistory || []
  );
}

module.exports = {
  SHEETS,
  initializeSpreadsheet,
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
  addPayment,
  recomputeDebts,
  getDebts,
  getPayments,
  getMemberHistory,
  getPairHistoryCount,
  recordMatchPairs,
  getMonthlyReport,
  getSnapshotFromSheets,
  syncSnapshotToSheets
};
