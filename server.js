require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const { PORT, APP_PASSWORD, SESSION_SECRET } = require("./src/config");
const { calculateSession } = require("./src/calc");
const {
  initializeSpreadsheet,
  getSettings,
  getMembers,
  getRecentSessions,
  getDebts,
  saveSession,
  addPayment
} = require("./src/sheets");

const app = express();
let initPromise = null;

app.use(express.json());
app.use(
  session({
    name: "bgm.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.status(401).json({ message: "Bạn chưa đăng nhập." });
}

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = initializeSpreadsheet().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/api", async (req, res, next) => {
  if (req.path === "/health" || req.path === "/login") {
    return next();
  }
  try {
    await ensureInitialized();
    return next();
  } catch (error) {
    console.error("Không thể khởi tạo Google Sheets:", error.message);
    return res.status(500).json({
      message:
        "Không thể kết nối Google Sheets. Kiểm tra GOOGLE_SHEET_ID, quyền share sheet và GOOGLE_SERVICE_ACCOUNT_JSON."
    });
  }
});

app.post("/api/login", (req, res) => {
  const inputPassword = String(req.body?.password || "");
  if (!inputPassword || inputPassword !== APP_PASSWORD) {
    return res.status(401).json({ message: "Sai mật khẩu." });
  }

  req.session.authenticated = true;
  req.session.username = "Nhóm cầu lông";
  return res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/bootstrap", requireAuth, async (req, res) => {
  try {
    const [settings, members, debts, sessions] = await Promise.all([
      getSettings(),
      getMembers(),
      getDebts(),
      getRecentSessions(20)
    ]);

    return res.json({
      settings,
      members,
      debts,
      sessions
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get("/api/debts", requireAuth, async (_req, res) => {
  try {
    const debts = await getDebts();
    return res.json({ debts });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get("/api/sessions", requireAuth, async (req, res) => {
  const limit = Number(req.query.limit || 20);
  try {
    const sessions = await getRecentSessions(limit);
    return res.json({ sessions });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/sessions", requireAuth, async (req, res) => {
  try {
    const settings = await getSettings();
    const result = calculateSession(req.body, settings);
    const createdBy = req.session.username || "admin";
    const sessionId = await saveSession(result, createdBy);
    return res.json({ sessionId, result, message: "Đã lưu buổi đánh và cập nhật công nợ." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/payments", requireAuth, async (req, res) => {
  try {
    const payload = {
      date: String(req.body?.date || "").trim() || new Date().toISOString().slice(0, 10),
      name: String(req.body?.name || "").trim(),
      amount: req.body?.amount,
      note: String(req.body?.note || "").trim()
    };
    await addPayment(payload);
    return res.json({ ok: true, message: "Đã ghi thanh toán và cập nhật công nợ." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.use((err, _req, res, _next) => {
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}]`, err);
  res.status(500).json({ message: `Có lỗi hệ thống. Mã lỗi: ${requestId}` });
});

if (require.main === module) {
  ensureInitialized()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
      });
    })
    .catch((error) => {
      console.error("Không thể khởi tạo Google Sheets:", error.message);
      process.exit(1);
    });
} else {
  ensureInitialized().catch((error) => {
    console.error("Google Sheets init warning on Vercel:", error.message);
  });
}

module.exports = app;
