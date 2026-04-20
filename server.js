require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const { PORT, ADMIN_PASSWORD, SESSION_SECRET } = require("./src/config");
const { NotificationService } = require("./src/notification");
const { generateMatchPlan, buildPairKey } = require("./src/matchmaking");
const {
  initializeDatabase,
  getActiveFixedMembers,
  getMembers,
  getRecentSessions,
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
  getPairHistoryCount,
  recordMatchPairs,
  getMonthlyReport,
  getMemberHistory,
  getPayments,
  getDebts,
  addPayment,
  getSnapshotForSheetSync,
  replaceAllDataFromSnapshot
} = require("./src/postgres");
const { syncSnapshotToSheets, getSnapshotFromSheets } = require("./src/sheets");

const app = express();
let initPromise = null;
const notificationService = new NotificationService();

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
  if (req.session?.authenticated && req.session?.role) return next();
  return res.status(401).json({ message: "Bạn chưa đăng nhập." });
}

function requireRole(roles) {
  return (req, res, next) => {
    const role = req.session?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ message: "Bạn không có quyền thực hiện thao tác này." });
    }
    return next();
  };
}

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = initializeDatabase().catch((error) => {
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
  if (req.path === "/health" || req.path === "/login" || req.path === "/login-options") {
    return next();
  }
  try {
    await ensureInitialized();
    return next();
  } catch (error) {
    console.error("Không thể khởi tạo Postgres:", error.message);
    return res.status(500).json({
      message: "Không thể kết nối Postgres. Kiểm tra POSTGRES_URL và quyền truy cập database."
    });
  }
});

app.get("/api/login-options", async (_req, res) => {
  try {
    await ensureInitialized();
    const members = await getActiveFixedMembers();
    return res.json({
      members: members.map((member) => ({
        memberId: member.memberId,
        name: member.name,
        phoneNumber: member.phoneNumber || ""
      }))
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/login", (req, res) => {
  const mode = String(req.body?.mode || "").trim().toLowerCase();
  if (mode === "admin") {
    const inputPassword = String(req.body?.password || "");
    if (!inputPassword || inputPassword !== ADMIN_PASSWORD) {
      return res.status(401).json({ message: "Sai mật khẩu admin." });
    }
    req.session.authenticated = true;
    req.session.role = "admin";
    req.session.memberName = "";
    req.session.username = "Admin";
    return res.json({ ok: true, role: "admin" });
  }

  if (mode !== "user") {
    return res.status(400).json({ message: "mode phải là admin hoặc user." });
  }

  return ensureInitialized()
    .then(async () => {
      const memberName = String(req.body?.memberName || "").trim();
      const phoneNumber = String(req.body?.phoneNumber || "").trim();
      if (!memberName || !phoneNumber) {
        return res.status(400).json({ message: "Bạn cần chọn thành viên và nhập số điện thoại." });
      }
      const members = await getActiveFixedMembers();
      const member = members.find((item) => item.name.toLowerCase() === memberName.toLowerCase());
      if (!member) return res.status(404).json({ message: "Thành viên không tồn tại hoặc đã bị khóa." });

      await upsertMemberContact(member.name, phoneNumber);
      req.session.authenticated = true;
      req.session.role = "user";
      req.session.memberName = member.name;
      req.session.username = member.name;
      return res.json({
        ok: true,
        role: "user",
        memberName: member.name
      });
    })
    .catch((error) => res.status(400).json({ message: error.message }));
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/bootstrap", requireAuth, async (req, res) => {
  try {
    const role = req.session.role;
    const memberName = req.session.memberName || "";
    if (role === "admin") {
      const [members, debts, sessions, payments] = await Promise.all([
        getMembers(),
        getDebts(),
        getRecentSessions(30),
        getPayments(100)
      ]);
      return res.json({
        auth: { role },
        members,
        debts,
        sessions,
        payments
      });
    }

    const [upcomingSession, debts, history, payments] = await Promise.all([
      getUpcomingSessionForMember(memberName),
      getDebts(),
      getMemberHistory(memberName, 20),
      getPayments(200)
    ]);

    return res.json({
      auth: { role, memberName },
      upcomingSession,
      myDebt: debts.find((item) => item.memberName.toLowerCase() === memberName.toLowerCase()) || null,
      myHistory: history,
      myPayments: payments.filter((item) => item.memberName.toLowerCase() === memberName.toLowerCase()).slice(0, 20)
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get("/api/debts", requireAuth, async (_req, res) => {
  try {
    const debts = await getDebts();
    if (_req.session.role === "admin") {
      return res.json({ debts });
    }
    const memberName = String(_req.session.memberName || "").toLowerCase();
    return res.json({
      debts: debts.filter((item) => item.memberName.toLowerCase() === memberName)
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get("/api/sessions", requireAuth, async (req, res) => {
  const limit = Number(req.query.limit || 20) || 20;
  try {
    if (req.session.role === "admin") {
      const sessions = await getRecentSessions(limit);
      return res.json({ sessions });
    }
    const history = await getMemberHistory(req.session.memberName, limit);
    return res.json({ sessions: history });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get("/api/sessions/upcoming", requireAuth, async (req, res) => {
  try {
    if (req.session.role === "admin") {
      const sessions = await getRecentSessions(30);
      return res.json({ sessions });
    }
    const sessionItem = await getUpcomingSessionForMember(req.session.memberName);
    return res.json({ session: sessionItem });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.patch("/api/members/level", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const memberName = String(req.body?.memberName || "").trim();
    const level = Number(req.body?.level);
    const member = await updateMemberLevel(memberName, level);
    return res.json({ ok: true, member });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/sessions", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const createdBy = req.session.username || "admin";
    const created = await createSession(req.body, createdBy);
    const members = await getActiveFixedMembers();
    await notificationService.broadcast(members, (member) => {
      const location = req.body?.location ? ` @${req.body.location}` : "";
      return `Lich danh cau moi: ${req.body?.date} ${req.body?.time}${location}. Vui long vao app xac nhan tham gia.`;
    });
    return res.json({
      ok: true,
      sessionId: created.sessionId,
      totalCost: created.totalCost,
      poll: created.poll,
      message: "Đã tạo buổi chơi để điểm danh trước trận và gửi thông báo stub."
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/sessions/:sessionId/settle", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    const fixedMembers = Array.isArray(req.body?.fixedMembers) ? req.body.fixedMembers : [];
    const guests = Array.isArray(req.body?.guests) ? req.body.guests : [];
    const result = await settleSession({
      sessionId,
      fixedCourtCost: req.body?.fixedCourtCost,
      extraCourts: req.body?.extraCourts,
      shuttlecockCost: req.body?.shuttlecockCost,
      fixedMembers,
      guests
    });
    return res.json({
      ok: true,
      result,
      message: "Đã chốt buổi sau khi đánh và tính công nợ theo dữ liệu thực tế."
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/sessions/:sessionId/respond", requireAuth, requireRole(["user", "admin"]), async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    const memberName = req.session.role === "admin" ? String(req.body?.memberName || "").trim() : req.session.memberName;
    const status = String(req.body?.status || "").trim();
    const pollAnswer = req.body?.pollAnswer;
    const result = await respondToSession({ sessionId, memberName, status, pollAnswer });
    return res.json({
      ok: true,
      result,
      message: "Đã ghi nhận lựa chọn tham gia."
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/sessions/:sessionId/poll", requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    const [poll, answers] = await Promise.all([getPollBySession(sessionId), getPollAnswersBySession(sessionId)]);
    if (!poll) return res.json({ poll: null, answers: [] });
    if (req.session.role === "admin") {
      return res.json({ poll, answers });
    }
    const memberName = String(req.session.memberName || "").toLowerCase();
    return res.json({
      poll,
      answers: answers.filter((item) => item.memberName.toLowerCase() === memberName)
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/sessions/:sessionId/participants", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    const [participants, poll, pollAnswers] = await Promise.all([
      getSessionParticipants(sessionId),
      getPollBySession(sessionId),
      getPollAnswersBySession(sessionId)
    ]);
    const pollAnswerByMember = {};
    pollAnswers.forEach((item) => {
      pollAnswerByMember[String(item.memberName || "").toLowerCase()] = item.answer || "";
    });
    return res.json({
      participants: participants.map((item) => ({
        ...item,
        pollAnswer: pollAnswerByMember[String(item.memberName || "").toLowerCase()] || ""
      })),
      pollQuestion: poll?.question || ""
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/sessions/:sessionId/guests", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    const guestName = String(req.body?.guestName || "").trim();
    const level = Number(req.body?.level || 5);
    const status = String(req.body?.status || "yes").trim();
    const result = await addGuestToSession({ sessionId, guestName, level, status });
    return res.json({ ok: true, result, message: "Đã thêm/cập nhật GL cho buổi này." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/sessions/:sessionId/matches", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    const [participants, allMembers, pairHistory] = await Promise.all([
      getSessionParticipants(sessionId),
      getMembers(),
      getPairHistoryCount()
    ]);

    const levelByName = {};
    allMembers.forEach((member) => {
      levelByName[member.name.toLowerCase()] = Number(member.level || 5);
    });
    const players = participants
      .filter((item) => item.status === "yes")
      .map((item) => ({
        memberId: item.memberId,
        name: item.memberName,
        level:
          item.level !== null && item.level !== undefined
            ? Number(item.level)
            : levelByName[item.memberName.toLowerCase()] || 5
      }));

    const roundCount = Math.max(1, Number(req.body?.roundCount || 2));
    const rounds = generateMatchPlan(players, pairHistory, roundCount);
    await recordMatchPairs(sessionId, rounds, buildPairKey);

    return res.json({ ok: true, rounds });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/payments", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const payload = {
      date: String(req.body?.date || "").trim() || new Date().toISOString().slice(0, 10),
      memberName: String(req.body?.memberName || "").trim(),
      amount: req.body?.amount,
      note: String(req.body?.note || "").trim()
    };
    await addPayment(payload);
    await notificationService.sendToMember(
      payload.memberName,
      `Thanh toan da duoc ghi nhan: ${payload.memberName} - ${payload.amount}`
    );
    return res.json({ ok: true, message: "Đã ghi nhận thanh toán và cập nhật công nợ." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

async function runSyncToSheets() {
  const snapshot = await getSnapshotForSheetSync();
  await syncSnapshotToSheets(snapshot);
  return {
    syncedAt: new Date().toISOString(),
    rows: {
      members: snapshot.members.length,
      sessions: snapshot.sessions.length,
      participants: snapshot.participants.length,
      sessionParticipants: snapshot.sessionParticipants.length,
      polls: snapshot.polls.length,
      pollAnswers: snapshot.pollAnswers.length,
      payments: snapshot.payments.length,
      debts: snapshot.debts.length,
      matchPairHistory: snapshot.matchPairHistory.length
    }
  };
}

app.post("/api/admin/sync-sheets", requireAuth, requireRole(["admin"]), async (_req, res) => {
  try {
    const result = await runSyncToSheets();
    return res.json({ ok: true, ...result, message: "Đã đồng bộ dữ liệu Postgres sang Google Sheets." });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/admin/migrate-from-sheets", requireAuth, requireRole(["admin"]), async (_req, res) => {
  try {
    const snapshot = await getSnapshotFromSheets();
    await replaceAllDataFromSnapshot(snapshot);
    return res.json({
      ok: true,
      message: "Đã migrate dữ liệu từ Google Sheets sang Postgres.",
      rows: {
        members: snapshot.members.length,
        sessions: snapshot.sessions.length,
        participants: snapshot.participants.length,
        sessionParticipants: snapshot.sessionParticipants.length,
        polls: snapshot.polls.length,
        pollAnswers: snapshot.pollAnswers.length,
        payments: snapshot.payments.length,
        debts: snapshot.debts.length
      }
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get("/api/cron/sync-sheets", async (req, res) => {
  try {
    const cronSecret = process.env.CRON_SECRET || "";
    const authHeader = String(req.headers.authorization || "");
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ message: "Unauthorized cron sync request." });
    }
    await ensureInitialized();
    const result = await runSyncToSheets();
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

app.get("/api/reports/monthly", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    const format = String(req.query.format || "json").trim().toLowerCase();
    const report = await getMonthlyReport(month);
    if (format !== "csv") return res.json(report);

    const lines = [];
    lines.push("month,totalMonthlyCost,totalSessions");
    lines.push([report.month, report.totalMonthlyCost, report.totalSessions].map(escapeCsvCell).join(","));
    lines.push("");
    lines.push("memberName,attendedSessions,totalSessions,attendanceRate");
    report.attendanceByMember.forEach((item) => {
      lines.push(
        [item.memberName, item.attendedSessions, item.totalSessions, item.attendanceRate].map(escapeCsvCell).join(",")
      );
    });
    lines.push("");
    lines.push("topDebtors_memberName,topDebtors_balance");
    report.topDebtors.forEach((item) => {
      lines.push([item.memberName, item.balance].map(escapeCsvCell).join(","));
    });
    lines.push("");
    lines.push("topPayers_memberName,topPayers_amount");
    report.topPayers.forEach((item) => {
      lines.push([item.memberName, item.amount].map(escapeCsvCell).join(","));
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="monthly-report-${report.month}.csv"`);
    return res.send(lines.join("\n"));
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
      console.error("Không thể khởi tạo Postgres:", error.message);
      process.exit(1);
    });
} else {
  ensureInitialized().catch((error) => {
    console.error("Postgres init warning on Vercel:", error.message);
  });
}

module.exports = app;
