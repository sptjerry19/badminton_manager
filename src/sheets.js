const fs = require("fs");
const { google } = require("googleapis");
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
  payments: "Payments",
  debts: "Debts"
};

const HEADERS = {
  Config: ["key", "value"],
  Members: ["name", "type", "gender", "level", "active"],
  Sessions: [
    "sessionId",
    "date",
    "fixedCourtCost",
    "extraCourts",
    "shuttlecockCost",
    "totalPeople",
    "totalCost",
    "totalGuestFee",
    "totalCollected",
    "mode",
    "warnings",
    "createdBy",
    "createdAt"
  ],
  Participants: ["sessionId", "date", "name", "type", "gender", "present", "amount", "note"],
  Payments: ["date", "name", "amount", "note", "createdAt"],
  Debts: ["name", "type", "totalDue", "totalPaid", "balance", "lastUpdated"]
};

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadCredentials() {
  const jsonFromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (jsonFromEnv) {
    try {
      return JSON.parse(jsonFromEnv);
    } catch (error) {
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

async function initializeSpreadsheet() {
  await ensureSheetsExist();

  await ensureHeader(SHEETS.config, HEADERS.Config);
  await ensureHeader(SHEETS.members, HEADERS.Members);
  await ensureHeader(SHEETS.sessions, HEADERS.Sessions);
  await ensureHeader(SHEETS.participants, HEADERS.Participants);
  await ensureHeader(SHEETS.payments, HEADERS.Payments);
  await ensureHeader(SHEETS.debts, HEADERS.Debts);

  const configRows = rowsToObjects(await readRows(`${SHEETS.config}!A1:B200`));
  if (!configRows.length) {
    const configValues = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [key, value]);
    await writeRows(`${SHEETS.config}!A2`, configValues);
  }

  const memberRows = rowsToObjects(await readRows(`${SHEETS.members}!A1:E500`));
  if (!memberRows.length) {
    const defaults = DEFAULT_FIXED_MEMBERS.map((name) => [name, "Cố định", "", "", "TRUE"]);
    await writeRows(`${SHEETS.members}!A2`, defaults);
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

async function getMembers() {
  const rows = rowsToObjects(await readRows(`${SHEETS.members}!A1:E1000`));
  return rows.map((row) => ({
    name: String(row.name || "").trim(),
    type: String(row.type || "").trim() || "GL",
    gender: String(row.gender || "").trim(),
    level: String(row.level || "").trim(),
    active: String(row.active || "TRUE").toUpperCase() !== "FALSE"
  }));
}

async function getRecentSessions(limit = 20) {
  const rows = rowsToObjects(await readRows(`${SHEETS.sessions}!A1:M5000`));
  return rows.slice(-limit).reverse();
}

async function getDebts() {
  const rows = rowsToObjects(await readRows(`${SHEETS.debts}!A1:F5000`));
  return rows.map((row) => ({
    name: row.name,
    type: row.type,
    totalDue: toNumber(row.totalDue),
    totalPaid: toNumber(row.totalPaid),
    balance: toNumber(row.balance),
    lastUpdated: row.lastUpdated
  }));
}

async function saveSession(sessionResult, createdBy = "admin") {
  const sessionId = `S${Date.now()}`;
  const createdAt = nowIso();
  const warnings = sessionResult.warnings.join(" | ");

  await appendRows(`${SHEETS.sessions}!A:M`, [
    [
      sessionId,
      sessionResult.date,
      sessionResult.fixedCourtCost,
      sessionResult.extraCourts,
      sessionResult.shuttlecockCost,
      sessionResult.totalPeople,
      sessionResult.totalCost,
      sessionResult.totalGuestFee,
      sessionResult.totalCollected,
      sessionResult.mode,
      warnings,
      createdBy,
      createdAt
    ]
  ]);

  const participantRows = sessionResult.participants.map((p) => [
    sessionId,
    sessionResult.date,
    p.name,
    p.type,
    p.gender,
    p.present ? "TRUE" : "FALSE",
    p.amount,
    ""
  ]);

  await appendRows(`${SHEETS.participants}!A:H`, participantRows);
  await recomputeDebts();

  return sessionId;
}

async function addPayment({ date, name, amount, note }) {
  const safeAmount = toNumber(amount);
  if (!name) throw new Error("Thiếu tên người thanh toán.");
  if (safeAmount <= 0) throw new Error("Số tiền thanh toán phải lớn hơn 0.");

  await appendRows(`${SHEETS.payments}!A:E`, [[date, name, safeAmount, note || "", nowIso()]]);
  await recomputeDebts();
}

async function recomputeDebts() {
  const [members, participantRows, paymentRows] = await Promise.all([
    getMembers(),
    rowsToObjects(await readRows(`${SHEETS.participants}!A1:H10000`)),
    rowsToObjects(await readRows(`${SHEETS.payments}!A1:E10000`))
  ]);

  const typeByName = {};
  members.forEach((m) => {
    if (m.active) typeByName[m.name] = m.type || "GL";
  });

  const dueByName = {};
  participantRows.forEach((row) => {
    const name = String(row.name || "").trim();
    if (!name) return;
    const present = String(row.present || "TRUE").toUpperCase() !== "FALSE";
    if (!present) return;
    const amount = toNumber(row.amount);
    dueByName[name] = (dueByName[name] || 0) + amount;
    if (!typeByName[name]) typeByName[name] = row.type || "GL";
  });

  const paidByName = {};
  paymentRows.forEach((row) => {
    const name = String(row.name || "").trim();
    if (!name) return;
    const amount = toNumber(row.amount);
    paidByName[name] = (paidByName[name] || 0) + amount;
  });

  const names = new Set([...Object.keys(typeByName), ...Object.keys(dueByName), ...Object.keys(paidByName)]);
  const now = nowIso();
  const debtRows = Array.from(names)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const totalDue = Math.round(dueByName[name] || 0);
      const totalPaid = Math.round(paidByName[name] || 0);
      const balance = totalDue - totalPaid;
      return [name, typeByName[name] || "GL", totalDue, totalPaid, balance, now];
    });

  await clearRange(`${SHEETS.debts}!A2:F10000`);
  if (debtRows.length) await writeRows(`${SHEETS.debts}!A2`, debtRows);
}

module.exports = {
  SHEETS,
  initializeSpreadsheet,
  getSettings,
  getMembers,
  getRecentSessions,
  getDebts,
  saveSession,
  addPayment
};
