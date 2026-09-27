const fs = require("fs");
const path = require("path");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const {
  deletePushTokens,
  getPushTokensForMemberKey,
  getWeeklyReminderAudience
} = require("./postgres");

const DEAD_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered"
]);

let messagingClient = null;
let initAttempted = false;

function formatMoney(value) {
  return `${new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0))}đ`;
}

function formatPlayDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return String(iso || "");
  return `${Number(match[3])}/${Number(match[2])}`;
}

function buildReminderText({ session, debtBalance, basicUnpaid }) {
  const lines = [];
  if (session?.date) {
    const when = [formatPlayDate(session.date), session.time].filter(Boolean).join(" ");
    const place = session.location ? ` · ${session.location}` : "";
    lines.push(`Lịch đánh: ${when}${place}`);
  } else {
    lines.push("Chưa có buổi mới trên lịch.");
  }
  if (Number(basicUnpaid) > 0) lines.push(`Sổ sân còn ${formatMoney(basicUnpaid)}`);
  if (Number(debtBalance) > 0) lines.push(`Công nợ còn ${formatMoney(debtBalance)}`);
  if (Number(basicUnpaid) <= 0 && Number(debtBalance) <= 0) lines.push("Bạn không còn khoản chưa đóng.");
  lines.push("Mở app để xác nhận và đóng tiền.");
  return lines.join("\n");
}

function normalizeServiceAccount(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n");
  if (!parsed.private_key || !parsed.client_email) return null;
  return parsed;
}

function readServiceAccountFile() {
  const configured = String(process.env.FIREBASE_SERVICE_ACCOUNT_FILE || "").trim();
  const candidates = [
    configured,
    path.join(process.cwd(), "badminton-e1571.json")
  ].filter(Boolean);
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = normalizeServiceAccount(JSON.parse(fs.readFileSync(filePath, "utf8")));
      if (parsed) return parsed;
    } catch (error) {
      console.error(`Không đọc được service account tại ${path.basename(filePath)}:`, error.message);
    }
  }
  return null;
}

function parseServiceAccountText(raw) {
  let text = String(raw || "").trim();
  if (!text) return null;
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      const unwrapped = JSON.parse(text);
      if (unwrapped && typeof unwrapped === "object") return normalizeServiceAccount(unwrapped);
      if (typeof unwrapped === "string") text = unwrapped.trim();
    } catch {
      text = text.slice(1, -1).trim();
    }
  }
  if (!text.startsWith("{")) return null;
  try {
    return normalizeServiceAccount(JSON.parse(text));
  } catch (error) {
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON không phải JSON hợp lệ:", error.message);
    return null;
  }
}

function loadServiceAccount() {
  const fromEnv = parseServiceAccountText(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (fromEnv) return fromEnv;
  const fromFile = readServiceAccountFile();
  if (fromFile) return fromFile;
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey) return null;
  return {
    projectId: process.env.FIREBASE_PROJECT_ID || "badminton-e1571",
    clientEmail,
    privateKey
  };
}

function getFirebaseMessaging() {
  if (initAttempted) return messagingClient;
  initAttempted = true;
  try {
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) return null;
    const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(serviceAccount) });
    messagingClient = getMessaging(app);
    return messagingClient;
  } catch (error) {
    console.error("Không khởi tạo được Firebase Admin:", error.message);
    messagingClient = null;
    return null;
  }
}

async function deliver(tokens, title, body) {
  const unique = [...new Set((tokens || []).map((item) => String(item || "").trim()).filter(Boolean))];
  if (!unique.length) return { configured: Boolean(getFirebaseMessaging()), sent: 0, failed: 0, removed: 0 };
  const client = getFirebaseMessaging();
  if (!client) return { configured: false, sent: 0, failed: 0, removed: 0 };
  const link = String(process.env.APP_BASE_URL || "").trim();
  const response = await client.sendEachForMulticast({
    tokens: unique,
    notification: { title, body },
    webpush: link ? { fcmOptions: { link } } : undefined
  });
  const dead = [];
  response.responses.forEach((item, index) => {
    if (!item.success && DEAD_TOKEN_CODES.has(item.error?.code)) dead.push(unique[index]);
  });
  if (dead.length) await deletePushTokens(dead);
  return {
    configured: true,
    sent: response.successCount,
    failed: response.failureCount,
    removed: dead.length
  };
}

class NotificationService {
  async sendToMember(memberId, message) {
    const text = String(message || "").trim();
    if (!text) return { ok: true, sent: 0 };
    try {
      const tokens = await getPushTokensForMemberKey(memberId);
      if (!tokens.length) {
        console.log(`[Push][member=${memberId}] chưa có token. ${text}`);
        return { ok: true, sent: 0, failed: 0 };
      }
      const result = await deliver(tokens, "Nhóm cầu lông", text);
      if (!result.configured) {
        console.log(`[Push][member=${memberId}] Firebase Admin chưa cấu hình. ${text}`);
      }
      return { ok: true, ...result };
    } catch (error) {
      console.error(`[Push][member=${memberId}]`, error.message);
      return { ok: false, sent: 0, failed: 1 };
    }
  }

  async broadcast(members, messageBuilder) {
    const list = Array.isArray(members) ? members : [];
    const configured = Boolean(getFirebaseMessaging());
    if (!configured) return { configured: false, sent: 0, failed: 0 };
    const results = await Promise.all(
      list.map((member) => {
        const memberId = member.memberId || member.name;
        const message = typeof messageBuilder === "function" ? messageBuilder(member) : String(messageBuilder || "");
        return this.sendToMember(memberId, message);
      })
    );
    return results.reduce(
      (summary, result) => ({
        configured: true,
        sent: summary.sent + Number(result.sent || 0),
        failed: summary.failed + Number(result.failed || 0)
      }),
      { configured: true, sent: 0, failed: 0 }
    );
  }

  async sendWeeklyReminders() {
    const audience = await getWeeklyReminderAudience();
    if (!getFirebaseMessaging()) {
      return {
        configured: false,
        message:
          "Thiếu Firebase service account trên server. Trong Vercel: Settings → Environment Variables, thêm FIREBASE_SERVICE_ACCOUNT_JSON bằng nội dung file service account, rồi Redeploy.",
        session: audience.session,
        members: audience.members.length,
        withToken: audience.members.filter((member) => member.tokens.length).length,
        sent: 0,
        failed: 0
      };
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const member of audience.members) {
      if (!member.tokens.length) {
        skipped += 1;
        continue;
      }
      const body = buildReminderText({
        session: audience.session,
        debtBalance: member.debtBalance,
        basicUnpaid: member.basicUnpaid
      });
      try {
        const result = await deliver(member.tokens, "Nhắc lịch cầu lông", body);
        sent += result.sent;
        failed += result.failed;
      } catch (error) {
        console.error(`[Push][member=${member.memberId}]`, error.message);
        failed += member.tokens.length;
      }
    }
    return {
      configured: true,
      session: audience.session,
      members: audience.members.length,
      withToken: audience.members.length - skipped,
      skipped,
      sent,
      failed
    };
  }
}

module.exports = {
  NotificationService,
  buildReminderText
};
