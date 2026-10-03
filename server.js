require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { PORT, ADMIN_PASSWORD, SESSION_SECRET } = require("./src/config");
const { NotificationService } = require("./src/notification");
const { generateMatchPlan, buildPairKey } = require("./src/matchmaking");
const {
  initializeDatabase,
  getActiveFixedMembers,
  getMembers,
  getRecentSessions,
  listVoteSessions,
  getSessionById,
  getSessionParticipants,
  getPollBySession,
  getActivePollForMember,
  getPollAnswersBySession,
  getUpcomingSessionForMember,
  createSession,
  cancelVoteSession,
  bookVoteSession,
  settleSession,
  upsertMemberContact,
  updateMemberLevel,
  createMember,
  updateMemberProfile,
  deleteMember,
  createBirthdayEvent,
  getBirthdayEvents,
  getBirthdayEventDetail,
  upsertBirthdayDrinkSelection,
  getBirthdayEventAdminView,
  respondToSession,
  answerPoll,
  addGuestToSession,
  getPairHistoryCount,
  recordMatchPairs,
  replaceGeneratedMatchesForDate,
  getGeneratedMatchesByDate,
  getMonthlyReport,
  getMemberHistory,
  getPayments,
  getDebts,
  addPayment,
  addExpense,
  getExpenses,
  getSnapshotForSheetSync,
  replaceAllDataFromSnapshot,
  getBasicLedger,
  createBasicSession,
  setBasicSharePaid,
  settleBasicPerson,
  deleteBasicSession,
  upsertPushToken,
  addMemberCredit,
  getMemberCreditSummary,
  getMemberCreditBalanceByName,
  getPlaysForDate,
  pool
} = require("./src/postgres");
const { syncSnapshotToSheets, getSnapshotFromSheets } = require("./src/sheets");
const {
  getTournamentBootstrap,
  registerTournamentMember,
  loginTournamentMember,
  completeTournamentProfile,
  updateEventRules,
  updateTournamentSettings,
  listTournamentPlayers,
  adminUpdatePlayer,
  adminSetPlayerStatus,
  adminRemovePlayer,
  listPairCandidates,
  invitePartner,
  respondPair,
  cancelPair,
  listPairs,
  listMatches,
  generateMatches,
  setMatchScore,
  getStandings,
  getTournamentEvents,
  listTournaments,
  getTournamentById,
  createTournament,
  updateTournament,
  activateTournament,
  deleteTournament
} = require("./src/tournament");

const app = express();
let initPromise = null;
const notificationService = new NotificationService();
const loginMaxAgeMs = 1000 * 60 * 60 * 24 * 90;

app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "login_sessions",
      createTableIfMissing: false,
      pruneSessionInterval: false
    }),
    name: "bgm.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: Boolean(process.env.VERCEL),
      maxAge: loginMaxAgeMs
    }
  })
);

app.get("/tournament", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "tournament.html"));
});

app.get("/basic", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "basic.html"));
});

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
  if (
    req.path === "/health" ||
    req.path === "/login" ||
    req.path === "/login-options" ||
    req.path === "/push/config" ||
    req.path === "/tournament/login" ||
    req.path === "/tournament/login-options" ||
    req.path === "/tournament/register"
  ) {
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
    const members = (await getMembers()).filter((member) => member.active);
    return res.json({
      members: members.map((member) => ({
        memberId: member.memberId,
        name: member.name,
        type: member.type || "GL",
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
      const members = (await getMembers()).filter((member) => member.active);
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
      const [members, debts, sessions, payments, expenses, birthdayEvents, voteSessions] = await Promise.all([
        getMembers(),
        getDebts(),
        getRecentSessions(30),
        getPayments(100),
        getExpenses(100),
        getBirthdayEvents(50),
        listVoteSessions({ includeCancelled: true, limit: 30 })
      ]);
      return res.json({
        auth: { role },
        members,
        debts,
        sessions,
        payments,
        expenses,
        birthdayEvents,
        voteSessions
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const [upcomingSession, debts, history, payments, activeVote, todaysMatches, birthdayEvents, voteSessions] =
      await Promise.all([
        getUpcomingSessionForMember(memberName),
        getDebts(),
        getMemberHistory(memberName, 20),
        getPayments(200),
        getActivePollForMember(memberName),
        getGeneratedMatchesByDate(today),
        getBirthdayEvents(20),
        listVoteSessions({ includeCancelled: false, limit: 30, memberName })
      ]);

    return res.json({
      auth: { role, memberName },
      upcomingSession,
      activeVote,
      todaysMatches,
      birthdayEvents,
      voteSessions,
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

app.get("/api/credits", requireAuth, async (req, res) => {
  try {
    if (req.session.role === "admin") {
      return res.json(await getMemberCreditSummary());
    }
    const balance = await getMemberCreditBalanceByName(req.session.memberName || "");
    return res.json({ balance });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/credits", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const direction = String(req.body?.direction || "add").trim().toLowerCase();
    const amount = Math.abs(Math.round(Number(req.body?.amount) || 0));
    const signed = direction === "use" ? -amount : amount;
    const summary = await addMemberCredit({
      memberId: req.body?.memberId,
      amount: signed,
      note: req.body?.note
    });
    return res.json({ ok: true, ...summary, message: direction === "use" ? "Đã trừ tiền thừa." : "Đã ghi tiền thừa." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
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

app.post("/api/members", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const member = await createMember({
      name: req.body?.name,
      type: req.body?.type,
      gender: req.body?.gender,
      birthday: req.body?.birthday,
      phoneNumber: req.body?.phoneNumber,
      level: req.body?.level,
      active: req.body?.active
    });
    return res.json({ ok: true, member, message: "Đã thêm thành viên mới." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.patch("/api/members/:memberId", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const memberId = String(req.params.memberId || "").trim();
    const member = await updateMemberProfile(memberId, {
      name: req.body?.name,
      type: req.body?.type,
      gender: req.body?.gender,
      birthday: req.body?.birthday,
      phoneNumber: req.body?.phoneNumber,
      level: req.body?.level,
      active: req.body?.active
    });
    return res.json({ ok: true, member, message: "Đã cập nhật thông tin thành viên." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.delete("/api/members/:memberId", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const memberId = String(req.params.memberId || "").trim();
    const result = await deleteMember(memberId);
    return res.json({ ok: true, ...result, message: "Đã xóa thành viên." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

function formatPlayDateShort(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return String(iso || "");
  return `${Number(match[3])}/${Number(match[2])}`;
}

function formatMoneyText(value) {
  return `${new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0))}đ`;
}

function describePush(prefix, result) {
  if (!result?.configured) {
    return `${prefix} Thông báo chưa gửi được vì Firebase chưa cấu hình. Bấm Gửi thông báo để thử lại.`;
  }
  if (!result.sent && result.failed) {
    return `${prefix} Gửi thông báo lỗi ${result.failed} thiết bị. Bấm Gửi thông báo để gửi lại.`;
  }
  if (!result.sent) return `${prefix} Chưa có thiết bị nào bật thông báo.`;
  const failed = result.failed ? `, lỗi ${result.failed}` : "";
  return `${prefix} Đã gửi thông báo tới ${result.sent} thiết bị${failed}.`;
}

function courtNotice(session) {
  const location = session.location ? ` · ${session.location}` : "";
  const time = session.time ? ` ${session.time}` : "";
  return `Lịch đánh mới: ${session.date}${time}${location}. Vào app xác nhận tham gia.`;
}

function basicCourtNotice(session) {
  return `Sân mới ${formatPlayDateShort(session.date)} · ${session.court}. Tổng ${formatMoneyText(session.totalFee)}. Mở sổ để xem phần của bạn.`;
}

function stripHtmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function tournamentCreateNotice(tournament) {
  const location = tournament.location ? ` · ${tournament.location}` : "";
  const excerpt = stripHtmlToText(tournament.contentHtml).slice(0, 120);
  const body = excerpt ? `. ${excerpt}` : "";
  return `Giải mới: ${tournament.name}${location}${body}. Vào tab Giải đấu để xem.`;
}

async function notifyActiveMembers(message) {
  const members = (await getMembers()).filter((member) => member.active);
  return notificationService.broadcast(members, () => message);
}

app.post("/api/sessions", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const createdBy = req.session.username || "admin";
    const created = await createSession(req.body, createdBy);
    const location = req.body?.location ? ` · ${req.body.location}` : "";
    let push = { configured: false, sent: 0, failed: 0 };
    try {
      push = await notifyActiveMembers(
        `Lịch đánh mới: ${req.body?.date} ${req.body?.time || ""}${location}. Vào app xác nhận tham gia.`
      );
    } catch (error) {
      console.error("Không gửi được thông báo sân mới:", error.message);
      push = { configured: true, sent: 0, failed: 1 };
    }
    return res.json({
      ok: true,
      sessionId: created.sessionId,
      totalCost: created.totalCost,
      poll: created.poll,
      push,
      message: describePush("Đã tạo buổi.", push)
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/sessions/votes", requireAuth, async (req, res) => {
  try {
    const includeCancelled = req.session.role === "admin";
    const memberName = req.session.role === "admin" ? "" : req.session.memberName || "";
    const voteSessions = await listVoteSessions({
      includeCancelled,
      limit: Number(req.query.limit || 30) || 30,
      memberName
    });
    return res.json({ sessions: voteSessions });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/sessions/:sessionId/cancel", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    const sessionItem = await cancelVoteSession(sessionId);
    let push = { configured: false, sent: 0, failed: 0 };
    try {
      const location = sessionItem.location ? ` · ${sessionItem.location}` : "";
      push = await notifyActiveMembers(
        `Đã hủy vote sân: ${sessionItem.date} ${sessionItem.time || ""}${location}. Không cần phản hồi nữa.`
      );
    } catch (error) {
      console.error("Không gửi được thông báo hủy vote:", error.message);
      push = { configured: true, sent: 0, failed: 1 };
    }
    return res.json({
      ok: true,
      session: sessionItem,
      push,
      message: describePush("Đã hủy vote sân.", push)
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/sessions/:sessionId/book", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    const imageDataUrl = String(req.body?.imageDataUrl || req.body?.bookingImageUrl || "").trim();
    const sessionItem = await bookVoteSession(sessionId, imageDataUrl);
    let push = { configured: false, sent: 0, failed: 0 };
    try {
      const location = sessionItem.location ? ` · ${sessionItem.location}` : "";
      push = await notifyActiveMembers(
        `Đã đặt sân: ${sessionItem.date} ${sessionItem.time || ""}${location}. Vào app xem ảnh xác nhận.`
      );
    } catch (error) {
      console.error("Không gửi được thông báo đặt sân:", error.message);
      push = { configured: true, sent: 0, failed: 1 };
    }
    return res.json({
      ok: true,
      session: sessionItem,
      push,
      message: describePush("Đã đánh dấu đặt sân.", push)
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

app.post("/api/sessions/:sessionId/poll-answer", requireAuth, requireRole(["user", "admin"]), async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    const memberName = req.session.role === "admin" ? String(req.body?.memberName || "").trim() : req.session.memberName;
    const answer = String(req.body?.answer || "").trim();
    const result = await answerPoll({ sessionId, memberName, answer });
    return res.json({ ok: true, result, message: "Đã ghi nhận phiếu vote." });
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
    if (!sessionId) {
      return res.status(400).json({ message: "Thiếu sessionId để generate trận." });
    }
    const [sessionItem, participants, allMembers, pairHistory] = await Promise.all([
      getSessionById(sessionId),
      getSessionParticipants(sessionId),
      getMembers(),
      getPairHistoryCount()
    ]);
    if (!sessionItem) {
      return res.status(404).json({ message: "Không tìm thấy session để generate trận." });
    }

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
    if (players.length < 4) {
      return res.status(400).json({
        message: `Cần ít nhất 4 người xác nhận 'Có tham gia' để generate trận. Hiện tại chỉ có ${players.length}.`
      });
    }

    const roundCount = Math.max(1, Number(req.body?.roundCount || 2));
    const rounds = generateMatchPlan(players, pairHistory, roundCount);
    await recordMatchPairs(sessionId, rounds, buildPairKey);
    await replaceGeneratedMatchesForDate(sessionId, sessionItem.date, rounds);

    return res.json({ ok: true, matchDate: sessionItem.date, rounds });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/matches", requireAuth, async (req, res) => {
  try {
    const date = String(req.query.date || "").trim() || new Date().toISOString().slice(0, 10);
    const matches = await getGeneratedMatchesByDate(date);
    return res.json({ date, matches });
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
      `Đã ghi nhận thanh toán ${payload.amount} cho ${payload.memberName}.`
    );
    return res.json({ ok: true, message: "Đã ghi nhận thanh toán và cập nhật công nợ." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/expenses", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const payload = {
      sessionId: String(req.body?.sessionId || "").trim(),
      name: String(req.body?.name || "").trim(),
      totalAmount: req.body?.totalAmount,
      participants: Array.isArray(req.body?.participants) ? req.body.participants : [],
      splitMethod: String(req.body?.splitMethod || "equal").trim(),
      note: String(req.body?.note || "").trim()
    };
    const expense = await addExpense(payload);
    return res.json({ ok: true, message: "Đã ghi nhận chi phí phát sinh.", expense });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/birthday-events", requireAuth, async (req, res) => {
  try {
    const events = await getBirthdayEvents(100);
    return res.json({ events });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/birthday-events", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const event = await createBirthdayEvent(
      {
        eventName: req.body?.eventName,
        date: req.body?.date,
        description: req.body?.description,
        brands: req.body?.brands,
        drinks: req.body?.drinks
      },
      req.session.username || "admin"
    );
    return res.json({ ok: true, event, message: "Đã tạo birthday event." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/birthday-events/:eventId", requireAuth, async (req, res) => {
  try {
    const eventId = String(req.params.eventId || "").trim();
    const memberName = req.session.role === "admin" ? String(req.query.memberName || "").trim() : req.session.memberName;
    const event = await getBirthdayEventDetail(eventId, memberName);
    return res.json({ event });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/birthday-events/:eventId/select-drink", requireAuth, requireRole(["user", "admin"]), async (req, res) => {
  try {
    const eventId = String(req.params.eventId || "").trim();
    const memberName = req.session.role === "admin" ? String(req.body?.memberName || "").trim() : req.session.memberName;
    const drinkId = String(req.body?.drinkId || "").trim();
    const quantity = req.body?.quantity;
    const selection = await upsertBirthdayDrinkSelection({ eventId, memberName, drinkId, quantity });
    return res.json({ ok: true, selection, message: "Đã cập nhật lựa chọn món." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/birthday-events/:eventId/admin-view", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const eventId = String(req.params.eventId || "").trim();
    const result = await getBirthdayEventAdminView(eventId);
    return res.json(result);
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
      expenses: snapshot.expenses?.length || 0,
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
        expenses: snapshot.expenses?.length || 0,
        debts: snapshot.debts.length
      }
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

function isCronAuthorized(req) {
  const cronSecret = process.env.CRON_SECRET || "";
  const authHeader = String(req.headers.authorization || "");
  return Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;
}

app.get("/api/push/config", (_req, res) => {
  res.json({ vapidKey: String(process.env.FIREBASE_VAPID_KEY || "").trim() });
});

app.post("/api/push/subscribe", requireAuth, async (req, res) => {
  try {
    const memberName = String(req.session.memberName || "").trim();
    if (!memberName) {
      return res.status(400).json({ message: "Hãy đăng nhập bằng tài khoản thành viên để bật thông báo." });
    }
    const members = await getMembers();
    const member = members.find((item) => item.name.toLowerCase() === memberName.toLowerCase());
    if (!member) return res.status(404).json({ message: "Không tìm thấy thành viên." });
    await upsertPushToken(member.memberId, req.body?.token);
    return res.json({ ok: true, message: "Đã bật thông báo trên thiết bị này." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/push/test", requireAuth, requireRole(["admin"]), async (_req, res) => {
  try {
    const result = await notificationService.sendWeeklyReminders();
    return res.json({
      ok: true,
      ...result,
      message: result.configured ? "Đã gửi nhắc lịch." : result.message
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

function todayPlayNotice(plan) {
  const lines = [`Hôm nay ${formatPlayDateShort(plan.date)} có lịch đánh.`];
  plan.sessions.forEach((item) => {
    const when = [formatPlayDateShort(item.date), item.time].filter(Boolean).join(" ");
    const place = item.location ? ` · ${item.location}` : "";
    lines.push(`${when}${place}`);
  });
  plan.basicSessions.forEach((item) => {
    if (item.court) lines.push(`Sân ${item.court}`);
  });
  lines.push("Mở app để xem chi tiết.");
  return lines.join("\n");
}

app.get("/api/cron/weekly-reminder", async (req, res) => {
  try {
    if (!isCronAuthorized(req)) {
      return res.status(401).json({ message: "Unauthorized cron reminder request." });
    }
    await ensureInitialized();
    const result = await notificationService.sendWeeklyReminders();
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get("/api/cron/today-play", async (req, res) => {
  try {
    if (!isCronAuthorized(req)) {
      return res.status(401).json({ message: "Unauthorized cron play reminder request." });
    }
    await ensureInitialized();
    const plan = await getPlaysForDate();
    const count = plan.sessions.length + plan.basicSessions.length;
    if (!count) {
      return res.json({
        ok: true,
        skipped: true,
        date: plan.date,
        sent: 0,
        failed: 0,
        message: "Hôm nay không có lịch đánh."
      });
    }
    const push = await notifyActiveMembers(todayPlayNotice(plan));
    return res.json({
      ok: true,
      skipped: false,
      date: plan.date,
      sessions: count,
      ...push
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get("/api/cron/sync-sheets", async (req, res) => {
  try {
    if (!isCronAuthorized(req)) {
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

app.get("/api/basic", requireAuth, async (req, res) => {
  try {
    const [members, sessions] = await Promise.all([getMembers(), getBasicLedger()]);
    return res.json({
      role: req.session.role,
      memberName: req.session.memberName || "",
      members: members
        .filter((member) => member.active)
        .map((member) => ({ memberId: member.memberId, name: member.name })),
      sessions
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/sessions/notify", requireAuth, requireRole(["admin"]), async (_req, res) => {
  try {
    const sessions = await listVoteSessions({ includeCancelled: false, limit: 1 });
    const session = sessions[0];
    if (!session) return res.status(400).json({ message: "Chưa có buổi đang mở để gửi thông báo." });
    const push = await notifyActiveMembers(courtNotice(session));
    return res.json({ ok: true, push, message: describePush("Gửi lại buổi mới nhất.", push) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/basic/sessions", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const sessionItem = await createBasicSession({
      date: req.body?.date,
      court: req.body?.court,
      courtFee: req.body?.courtFee,
      shuttleFee: req.body?.shuttleFee,
      memberIds: req.body?.memberIds,
      guestNames: req.body?.guestNames
    });
    let push = { configured: false, sent: 0, failed: 0 };
    try {
      push = await notifyActiveMembers(basicCourtNotice(sessionItem));
    } catch (error) {
      console.error("Không gửi được thông báo sân:", error.message);
      push = { configured: true, sent: 0, failed: 1 };
    }
    return res.json({
      ok: true,
      session: sessionItem,
      push,
      message: describePush("Đã lưu buổi.", push)
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/basic/notify", requireAuth, requireRole(["admin"]), async (_req, res) => {
  try {
    const sessions = await getBasicLedger();
    const session = sessions[0];
    if (!session) return res.status(400).json({ message: "Chưa có sân để gửi thông báo." });
    const push = await notifyActiveMembers(basicCourtNotice(session));
    return res.json({ ok: true, push, message: describePush(`Gửi lại sân ${session.court}.`, push) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.patch("/api/basic/shares/:shareId", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const share = await setBasicSharePaid(req.params.shareId, req.body?.paid);
    return res.json({ ok: true, share });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.patch("/api/basic/people/paid", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const sessions = await settleBasicPerson({
      memberId: req.body?.memberId,
      memberName: req.body?.memberName
    });
    return res.json({ ok: true, sessions });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.delete("/api/basic/sessions/:id", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    await deleteBasicSession(req.params.id);
    return res.json({ ok: true, message: "Đã xóa buổi." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.use((err, _req, res, _next) => {
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}]`, err);
  res.status(500).json({ message: `Có lỗi hệ thống. Mã lỗi: ${requestId}` });
});

app.get("/api/tournament/login-options", async (_req, res) => {
  try {
    await ensureInitialized();
    const members = (await getMembers()).filter((member) => member.active);
    return res.json({
      members: members.map((member) => ({
        memberId: member.memberId,
        name: member.name
      }))
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/tournament/register", async (req, res) => {
  try {
    await ensureInitialized();
    const member = await registerTournamentMember({
      name: req.body?.name,
      phoneNumber: req.body?.phoneNumber
    });
    req.session.authenticated = true;
    req.session.role = "user";
    req.session.memberName = member.name;
    req.session.username = member.name;
    return res.json({ ok: true, role: "user", memberName: member.name, member });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/tournament/login", async (req, res) => {
  try {
    await ensureInitialized();
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
    const member = await loginTournamentMember({
      memberName: req.body?.memberName,
      phoneNumber: req.body?.phoneNumber
    });
    req.session.authenticated = true;
    req.session.role = "user";
    req.session.memberName = member.name;
    req.session.username = member.name;
    return res.json({ ok: true, role: "user", memberName: member.name, member });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/tournament/bootstrap", requireAuth, async (req, res) => {
  try {
    const data = await getTournamentBootstrap({
      role: req.session.role,
      memberName: req.session.memberName || ""
    });
    return res.json(data);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/tournament/catalog", requireAuth, async (_req, res) => {
  try {
    return res.json({ tournaments: await listTournaments() });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get("/api/tournament/catalog/:tournamentId", requireAuth, async (req, res) => {
  try {
    const tournament = await getTournamentById(req.params.tournamentId);
    return res.json({ tournament });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/tournament/catalog", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const tournament = await createTournament({
      name: req.body?.name,
      location: req.body?.location,
      contentHtml: req.body?.contentHtml
    });
    let push = { configured: false, sent: 0, failed: 0 };
    try {
      push = await notifyActiveMembers(tournamentCreateNotice(tournament));
    } catch (error) {
      console.error("Không gửi được thông báo giải mới:", error.message);
      push = { configured: true, sent: 0, failed: 1 };
    }
    return res.json({
      ok: true,
      tournament,
      push,
      message: describePush("Đã tạo giải đấu.", push)
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.patch("/api/tournament/catalog/:tournamentId", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const tournament = await updateTournament(req.params.tournamentId, {
      name: req.body?.name,
      location: req.body?.location,
      contentHtml: req.body?.contentHtml
    });
    return res.json({ ok: true, tournament, message: "Đã cập nhật giải đấu." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post(
  "/api/tournament/catalog/:tournamentId/activate",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const tournament = await activateTournament(req.params.tournamentId);
      return res.json({ ok: true, tournament, message: "Đã đặt giải đang diễn ra." });
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
  }
);

app.delete("/api/tournament/catalog/:tournamentId", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const result = await deleteTournament(req.params.tournamentId);
    return res.json({ ok: true, ...result, message: "Đã xóa giải đấu." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/tournament/profile", requireAuth, requireRole(["user"]), async (req, res) => {
  try {
    const result = await completeTournamentProfile(req.session.memberName, req.body || {});
    req.session.memberName = result.member.name;
    req.session.username = result.member.name;
    return res.json({ ok: true, ...result, message: "Đã lưu hồ sơ giải đấu." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.patch("/api/tournament/settings", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const settings = await updateTournamentSettings(req.body || {});
    return res.json({ ok: true, settings });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.patch("/api/tournament/events/:eventId/rules", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const event = await updateEventRules(req.params.eventId, {
      minLevelSum: req.body?.minLevelSum,
      maxLevelSum: req.body?.maxLevelSum
    });
    return res.json({ ok: true, event });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/tournament/players", requireAuth, requireRole(["admin"]), async (_req, res) => {
  try {
    return res.json({ players: await listTournamentPlayers() });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.patch("/api/tournament/players/:memberId", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    if (req.body?.status !== undefined && Object.keys(req.body || {}).length === 1) {
      const player = await adminSetPlayerStatus(req.params.memberId, req.body.status);
      return res.json({ ok: true, player, message: "Đã cập nhật trạng thái VĐV." });
    }
    const player = await adminUpdatePlayer(req.params.memberId, req.body || {});
    return res.json({ ok: true, player });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.delete("/api/tournament/players/:memberId", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const result = await adminRemovePlayer(req.params.memberId);
    return res.json({ ok: true, ...result, message: "Đã xóa VĐV khỏi danh sách giải." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/tournament/events", requireAuth, async (_req, res) => {
  try {
    return res.json({ events: await getTournamentEvents() });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get("/api/tournament/pairs/candidates", requireAuth, requireRole(["user"]), async (req, res) => {
  try {
    const eventId = String(req.query.eventId || "").trim();
    const candidates = await listPairCandidates(req.session.memberName, eventId);
    return res.json({ candidates });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/tournament/pairs", requireAuth, async (req, res) => {
  try {
    if (req.session.role === "admin") {
      return res.json({ pairs: await listPairs({ eventId: req.query.eventId || "" }) });
    }
    const bootstrap = await getTournamentBootstrap({
      role: "user",
      memberName: req.session.memberName || ""
    });
    return res.json({ pairs: bootstrap.pairs || [] });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/tournament/pairs/invite", requireAuth, requireRole(["user"]), async (req, res) => {
  try {
    const pair = await invitePartner(req.session.memberName, {
      eventId: req.body?.eventId,
      partnerMemberId: req.body?.partnerMemberId
    });
    return res.json({ ok: true, pair, message: "Đã gửi lời mời đồng đội." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/tournament/pairs/:pairId/respond", requireAuth, requireRole(["user"]), async (req, res) => {
  try {
    const accept = String(req.body?.accept).toLowerCase() !== "false" && req.body?.accept !== false;
    const pair = await respondPair(req.session.memberName, req.params.pairId, accept);
    return res.json({
      ok: true,
      pair,
      message: accept ? "Đã chấp nhận ghép đôi." : "Đã từ chối lời mời."
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/tournament/pairs/:pairId/cancel", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const result = await cancelPair(req.params.pairId);
    return res.json({ ok: true, ...result, message: "Đã hủy cặp." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/tournament/matches", requireAuth, async (req, res) => {
  try {
    return res.json({ matches: await listMatches(req.query.eventId || "") });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/tournament/matches/generate", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const result = await generateMatches(req.body?.eventId || "");
    return res.json({ ok: true, ...result, message: `Đã tạo ${result.created} trận.` });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.patch("/api/tournament/matches/:matchId/score", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const match = await setMatchScore(req.params.matchId, req.body?.scoreA, req.body?.scoreB);
    return res.json({ ok: true, match, message: "Đã lưu tỉ số." });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.get("/api/tournament/standings", requireAuth, async (req, res) => {
  try {
    return res.json({ standings: await getStandings(req.query.eventId || "") });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
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
