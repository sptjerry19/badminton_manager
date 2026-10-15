const state = {
  loginOptions: [],
  auth: null,
  sessions: [],
  voteSessions: [],
  members: [],
  activeAdminTab: "court",
  activeUserTab: "home",
  tournamentMountedFor: "",
  loginAuthMode: "login",
  activeVote: null,
  upcomingSessionId: "",
  selectedUserMatchDate: "",
  pendingApiCalls: 0
};

const VIETQR = {
  bankBin: "970422",
  accountNo: "011911142003",
  accountName: "PHAM DUY LINH",
  template: "compact2"
};

function formatMoney(value) {
  return new Intl.NumberFormat("vi-VN").format(Number(value || 0));
}

function buildVietQrUrl(memberName, amount) {
  const safeAmount = Math.max(0, Math.round(Number(amount || 0)));
  const addInfo = encodeURIComponent(`Thu cong no cau long - ${memberName}`);
  const accountName = encodeURIComponent(VIETQR.accountName);
  return `https://img.vietqr.io/image/${VIETQR.bankBin}-${VIETQR.accountNo}-${VIETQR.template}.png?amount=${safeAmount}&addInfo=${addInfo}&accountName=${accountName}`;
}

function toggleModal(id, isOpen) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.toggle("hidden", !isOpen);
  modal.classList.toggle("flex", isOpen);
}

let loadingHideTimer = null;

function setLoading(isLoading) {
  const modal = document.getElementById("loadingModal");
  if (!modal) return;
  modal.classList.toggle("hidden", !isLoading);
  modal.classList.toggle("flex", isLoading);
}

function bumpLoading(delta = 1) {
  state.pendingApiCalls = Math.max(0, state.pendingApiCalls + Number(delta || 0));
  if (state.pendingApiCalls > 0) {
    if (loadingHideTimer) {
      clearTimeout(loadingHideTimer);
      loadingHideTimer = null;
    }
    setLoading(true);
    return;
  }
  if (loadingHideTimer) clearTimeout(loadingHideTimer);
  loadingHideTimer = setTimeout(() => {
    loadingHideTimer = null;
    if (state.pendingApiCalls === 0) setLoading(false);
  }, 80);
}

window.bumpLoading = bumpLoading;

async function api(path, options = {}) {
  const trackLoading = options.loading !== false;
  if (trackLoading) bumpLoading(1);
  try {
    const response = await fetch(path, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Có lỗi hệ thống.");
    return data;
  } finally {
    if (trackLoading) bumpLoading(-1);
  }
}

function showLoginMode() {
  document.getElementById("loginSection").classList.remove("hidden");
  document.getElementById("appSection").classList.add("hidden");
  state.tournamentMountedFor = "";
  state.activeUserTab = "home";
  ["userTournamentMount", "adminTournamentMount"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = "";
      el.dataset.ready = "0";
    }
  });
}

function showAppMode() {
  document.getElementById("loginSection").classList.add("hidden");
  document.getElementById("appSection").classList.remove("hidden");
}

function setMessage(id, message, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message || "";
  el.className = `text-sm ${isError ? "text-red-600" : "text-emerald-600"}`;
}

function escapeHtmlText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setLoginAuthMode(mode) {
  state.loginAuthMode = mode;
  document.querySelectorAll("#authModeSegment .login-segment-btn").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.mode === mode);
  });
  const loginFields = document.getElementById("loginFields");
  const registerFields = document.getElementById("registerFields");
  const adminFields = document.getElementById("adminFields");
  const memberSelect = document.getElementById("memberSelectInput");
  const phoneInput = document.getElementById("phoneInput");
  const registerPhone = document.getElementById("registerPhone");
  const submitLabel = document.getElementById("authSubmitLabel");
  if (loginFields) loginFields.hidden = mode !== "login";
  if (registerFields) registerFields.hidden = mode !== "register";
  if (adminFields) adminFields.hidden = mode !== "admin";
  if (memberSelect) memberSelect.required = mode === "login";
  if (phoneInput) phoneInput.required = mode === "login";
  if (registerPhone) {
    registerPhone.required = mode === "register";
    // Browser đôi khi nhét email vào ô SĐT của form đăng ký.
    if (mode === "register" && String(registerPhone.value || "").includes("@")) {
      registerPhone.value = "";
    }
  }
  if (submitLabel) {
    submitLabel.textContent =
      mode === "register" ? "Đăng ký" : mode === "admin" ? "Vào admin" : "Đăng nhập";
  }
}

function toggleLoginMode() {
  setLoginAuthMode(state.loginAuthMode || "login");
}

function renderLoginOptions() {
  const select = document.getElementById("memberSelectInput");
  if (!select) return;
  select.innerHTML = "";
  state.loginOptions.forEach((member) => {
    const option = document.createElement("option");
    option.value = member.name;
    option.textContent = member.type ? `${member.name} (${member.type})` : member.name;
    select.appendChild(option);
  });
}

function renderRoleHeader(auth) {
  const roleTitle = document.getElementById("roleTitle");
  const loginIdentity = document.getElementById("loginIdentity");
  const isAdmin = auth.role === "admin";
  roleTitle.textContent = isAdmin ? "Admin dashboard" : "User dashboard";
  loginIdentity.textContent = isAdmin ? "Bạn đang đăng nhập bằng quyền admin." : `Xin chào ${auth.memberName}.`;
  document.getElementById("adminSection").classList.toggle("hidden", !isAdmin);
  document.getElementById("userSection").classList.toggle("hidden", isAdmin);
}

function renderMemberLevels(members) {
  const tbody = document.getElementById("memberLevelTable");
  tbody.innerHTML = "";
  members.forEach((member) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="border border-slate-200 px-2 py-1">${member.name}</td>
      <td class="border border-slate-200 px-2 py-1">${member.type || "-"}</td>
      <td class="border border-slate-200 px-2 py-1">${member.gender || "-"}</td>
      <td class="border border-slate-200 px-2 py-1">${member.birthday || "-"}</td>
      <td class="border border-slate-200 px-2 py-1">${member.phoneNumber || "-"}</td>
      <td class="border border-slate-200 px-2 py-1">${member.level ?? "-"}</td>
      <td class="border border-slate-200 px-2 py-1">${member.active ? "TRUE" : "FALSE"}</td>
      <td class="border border-slate-200 px-2 py-1">
        <div class="flex flex-wrap items-center gap-1">
          <button data-member-id="${member.memberId}" class="edit-member-btn rounded bg-blue-600 px-2 py-1 text-white">Sửa</button>
          <button data-member-id="${member.memberId}" class="delete-member-btn rounded bg-rose-600 px-2 py-1 text-white">Xóa</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function resetMemberModal() {
  document.getElementById("memberModalTitle").textContent = "Thêm member";
  document.getElementById("memberModalIdInput").value = "";
  document.getElementById("memberNameInput").value = "";
  document.getElementById("memberTypeInput").value = "Cố định";
  document.getElementById("memberGenderInput").value = "";
  document.getElementById("memberBirthdayInput").value = "";
  document.getElementById("memberPhoneInput").value = "";
  document.getElementById("memberLevelInput").value = "5";
  document.getElementById("memberActiveInput").checked = true;
  setMessage("memberModalMessage", "");
}

function openMemberModal(member = null) {
  if (!member) {
    resetMemberModal();
  } else {
    document.getElementById("memberModalTitle").textContent = `Sửa member: ${member.name}`;
    document.getElementById("memberModalIdInput").value = member.memberId || "";
    document.getElementById("memberNameInput").value = member.name || "";
    document.getElementById("memberTypeInput").value = member.type || "GL";
    document.getElementById("memberGenderInput").value = member.gender || "";
    document.getElementById("memberBirthdayInput").value = member.birthday || "";
    document.getElementById("memberPhoneInput").value = member.phoneNumber || "";
    document.getElementById("memberLevelInput").value = String(member.level ?? 5);
    document.getElementById("memberActiveInput").checked = Boolean(member.active);
    setMessage("memberModalMessage", "");
  }
  toggleModal("memberModal", true);
}

function renderSessionSelect(sessions) {
  state.sessions = sessions;
  const matchSelect = document.getElementById("matchSessionSelect");
  if (!matchSelect) return;
  matchSelect.innerHTML = sessions
    .map(
      (session) =>
        `<option value="${escapeHtmlText(session.sessionId)}">${escapeHtmlText(`${session.date} ${session.time} · ${session.location || session.sessionId}`)}</option>`
    )
    .join("");
}

// Popup nhắc phản hồi khi user còn "pending" ở buổi sắp tới.
function renderUpcoming(session) {
  if (!session) {
    state.upcomingSessionId = "";
    toggleModal("attendanceModal", false);
    return;
  }
  state.upcomingSessionId = session.sessionId;
  document.getElementById("attendanceModalInfo").textContent = [
    `Buổi: ${session.date} ${session.time}`,
    session.location ? `Địa điểm: ${session.location}` : "",
    session.note ? `Ghi chú: ${session.note}` : ""
  ]
    .filter(Boolean)
    .join(" | ");

  const voteStatus = String(session.voteStatus || "open").toLowerCase();
  const myStatus = String(session.myStatus || "pending").toLowerCase();
  const canStillVote = voteStatus === "open" || voteStatus === "booked";
  toggleModal("attendanceModal", canStillVote && myStatus === "pending");
}

function voteStatusLabel(status) {
  const value = String(status || "open").toLowerCase();
  if (value === "booked") return "Đã đặt";
  if (value === "cancelled") return "Đã hủy";
  return "Đang vote";
}

function voteStatusClass(status) {
  const value = String(status || "open").toLowerCase();
  if (value === "booked") return "is-booked";
  if (value === "cancelled") return "is-cancelled";
  return "is-open";
}

function voteCardHead(session) {
  const status = String(session.voteStatus || "open").toLowerCase();
  const stats = session.stats || { yes: 0, no: 0, pending: 0 };
  const charged = session.basicSessionId ? `<span class="vote-badge is-charged">Đã tính tiền</span>` : "";
  return `<div class="vote-card-head">
      <div>
        <strong>${escapeHtmlText(session.date)} ${escapeHtmlText(session.time || "")}</strong>
        <p>${escapeHtmlText(session.location || "Chưa có địa điểm")}${session.note ? ` · ${escapeHtmlText(session.note)}` : ""}</p>
      </div>
      <div class="vote-badges">${charged}<span class="vote-badge ${voteStatusClass(status)}">${voteStatusLabel(status)}</span></div>
    </div>
    <p class="vote-stats"><b>${stats.yes || 0}</b> tham gia · ${stats.no || 0} không · ${stats.pending || 0} chưa trả lời</p>`;
}

function voteBookingImage(session) {
  const status = String(session.voteStatus || "open").toLowerCase();
  if (status !== "booked" || !session.bookingImageUrl) return "";
  return `<button type="button" class="vote-thumb-btn" data-action="preview-booking" data-session="${escapeHtmlText(session.sessionId)}">
      <img src="${escapeHtmlText(session.bookingImageUrl)}" alt="Ảnh đặt sân" class="vote-thumb" />
    </button>`;
}

function voteMemberChips(session, editable) {
  const members = Array.isArray(session.members) ? session.members : [];
  if (!members.length) return `<span class="vote-empty">Chưa có ai trong danh sách.</span>`;
  const order = { yes: 0, pending: 1, no: 2 };
  return [...members]
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, "vi"))
    .map((member) => {
      const label = escapeHtmlText(member.name);
      const cls = `vote-chip is-${member.status}`;
      if (!editable) return `<span class="${cls}">${label}</span>`;
      return `<button type="button" class="${cls}" data-action="toggle-member" data-session="${escapeHtmlText(session.sessionId)}" data-member="${label}" data-status="${member.status}">${label}</button>`;
    })
    .join("");
}

function renderAdminVoteList(sessions) {
  const container = document.getElementById("voteSessionList");
  if (!container) return;
  state.voteSessions = Array.isArray(sessions) ? sessions : [];
  if (!state.voteSessions.length) {
    container.innerHTML = `<p class="text-sm text-slate-500">Chưa có buổi vote nào.</p>`;
    return;
  }

  container.innerHTML = state.voteSessions
    .map((session) => {
      const status = String(session.voteStatus || "open").toLowerCase();
      const sid = escapeHtmlText(session.sessionId);
      const active = status !== "cancelled";
      const actions = active
        ? `<div class="vote-actions">
            <button type="button" class="vote-btn vote-btn-primary" data-action="charge-vote" data-session="${sid}">${session.basicSessionId ? "Tính thêm" : "Tính tiền"}</button>
            <label class="vote-upload">
              <span>${status === "booked" ? "Đổi ảnh sân" : "Đã đặt sân"}</span>
              <input type="file" accept="image/*" data-action="book-vote" data-session="${sid}" />
            </label>
            ${status === "open" ? `<button type="button" class="vote-btn vote-btn-danger" data-action="cancel-vote" data-session="${sid}">Hủy</button>` : ""}
          </div>`
        : "";
      return `<article class="vote-card${active ? "" : " is-muted"}" data-session="${sid}">
        ${voteCardHead(session)}
        <div class="vote-yes">${voteMemberChips(session, active)}</div>
        ${voteBookingImage(session)}
        ${actions}
      </article>`;
    })
    .join("");
}

function renderUserVoteList(sessions) {
  const container = document.getElementById("userVoteList");
  if (!container) return;
  const list = (Array.isArray(sessions) ? sessions : []).filter(
    (session) => String(session.voteStatus || "open").toLowerCase() !== "cancelled"
  );
  if (!list.length) {
    container.innerHTML = `<p class="text-sm text-slate-500">Chưa có buổi vote nào.</p>`;
    return;
  }

  container.innerHTML = list
    .map((session) => {
      const myStatus = String(session.myStatus || "pending").toLowerCase();
      const sid = escapeHtmlText(session.sessionId);
      const pick = (value, label) =>
        `<button type="button" class="vote-btn vote-pick${myStatus === value ? " is-on" : ""}" data-action="user-respond" data-status="${value}" data-session="${sid}">${label}</button>`;
      return `<article class="vote-card">
        ${voteCardHead(session)}
        <div class="vote-yes">${voteMemberChips(session, false)}</div>
        ${voteBookingImage(session)}
        <div class="vote-actions">${pick("yes", "Tham gia")}${pick("no", "Không")}</div>
      </article>`;
    })
    .join("");
}

function openBookingImage(url) {
  const image = document.getElementById("bookingImagePreview");
  if (!image || !url) return;
  image.src = url;
  toggleModal("bookingImageModal", true);
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Chưa chọn ảnh."));
      return;
    }
    if (!String(file.type || "").startsWith("image/")) {
      reject(new Error("File phải là ảnh."));
      return;
    }
    if (file.size > 1.4 * 1024 * 1024) {
      reject(new Error("Ảnh quá lớn (tối đa ~1.4MB)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Không đọc được ảnh."));
    reader.readAsDataURL(file);
  });
}

async function cancelVoteSession(sessionId) {
  if (!window.confirm("Hủy vote sân này? User sẽ không cần phản hồi nữa.")) return;
  const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: "POST" });
  setMessage("voteListMessage", data.message || "Đã hủy vote.");
  await loadAdminDashboard();
}

async function bookVoteSession(sessionId, file) {
  const imageDataUrl = await readImageAsDataUrl(file);
  const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/book`, {
    method: "POST",
    body: JSON.stringify({ imageDataUrl })
  });
  setMessage("voteListMessage", data.message || "Đã đánh dấu đặt sân.");
  await loadAdminDashboard();
}

function summarizeBasicDebt(payload, memberName) {
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const nameCi = String(memberName || "").trim().toLowerCase();
  const mine = sessions.flatMap((session) => session.shares || []).filter((share) => {
    return String(share.memberName || "").trim().toLowerCase() === nameCi;
  });
  const totalDue = mine.reduce((sum, share) => sum + Number(share.shareAmount || 0), 0);
  const totalPaid = mine
    .filter((share) => share.paid)
    .reduce((sum, share) => sum + Number(share.shareAmount || 0), 0);
  const balance = mine
    .filter((share) => !share.paid)
    .reduce((sum, share) => sum + Number(share.shareAmount || 0), 0);
  return { totalDue, totalPaid, balance, count: mine.length };
}

function renderUserDebt(myDebt, creditBalance = 0) {
  const el = document.getElementById("myDebtCard");
  const actionEl = document.getElementById("myDebtQrActions");
  if (!el || !actionEl) return;
  const totalDue = Number(myDebt?.totalDue || 0);
  const paidOnBook = Number(myDebt?.totalPaid || 0);
  const credit = Math.max(0, Number(creditBalance || 0));
  const totalPaid = paidOnBook + credit;
  const remaining = totalDue - totalPaid;
  if ((!myDebt || !myDebt.count) && !credit) {
    el.textContent = "Chưa có công nợ trên sổ sân.";
    actionEl.innerHTML = "";
    state.userBasicBalance = 0;
    return;
  }
  state.userBasicBalance = Math.max(0, remaining);
  el.innerHTML = `
    <div>Tổng tiền cần thanh toán: <strong>${formatMoney(totalDue)}</strong></div>
    <div>Đã thanh toán: <strong>${formatMoney(totalPaid)}</strong></div>
    <div>Số tiền cần thanh toán: <strong class="${remaining > 0 ? "text-red-600" : "text-emerald-600"}">${formatMoney(remaining)}</strong></div>
  `;
  if (remaining > 0) {
    actionEl.innerHTML = `<button id="openQrBtn" class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">Thanh toán bằng QR</button>`;
  } else {
    actionEl.innerHTML = `<p class="text-sm text-slate-500">Bạn không có công nợ cần thanh toán.</p>`;
  }
}

function openVoteModal(vote) {
  if (!vote) return;
  state.activeVote = vote;
  document.getElementById("voteSessionText").textContent = `Phiên: ${vote.date} ${vote.time || ""} ${vote.location ? `- ${vote.location}` : ""}`;
  document.getElementById("voteQuestionText").textContent = vote.question || "Bạn vui lòng bỏ phiếu.";
  document.getElementById("voteAnswerInput").value = vote.myAnswer || "";
  setMessage("voteMessage", "");
  toggleModal("voteModal", true);
}

function openQrModal(memberName, balance) {
  const qrUrl = buildVietQrUrl(memberName, balance);
  document.getElementById("qrDebtInfo").textContent = `${memberName} - Số tiền cần thanh toán: ${formatMoney(balance)} VNĐ`;
  document.getElementById("qrImage").src = qrUrl;
  document.getElementById("qrOpenTabLink").href = qrUrl;
  toggleModal("qrModal", true);
}

async function submitAttendance(status, sessionIdOverride = "") {
  const sessionId = String(sessionIdOverride || state.upcomingSessionId || "").trim();
  if (!sessionId) {
    setMessage("attendanceModalMessage", "Chưa có buổi upcoming để phản hồi.", true);
    return;
  }
  try {
    state.upcomingSessionId = sessionId;
    await api(`/api/sessions/${encodeURIComponent(sessionId)}/respond`, {
      method: "POST",
      body: JSON.stringify({ status })
    });
    setMessage("attendanceModalMessage", "Đã gửi phản hồi.");
    setTimeout(() => toggleModal("attendanceModal", false), 500);
    await loadUserDashboard();
  } catch (error) {
    setMessage("attendanceModalMessage", error.message, true);
    setMessage("userVoteMessage", error.message, true);
  }
}

function renderMatchTables(rounds = []) {
  const container = document.getElementById("matchResultTables");
  if (!container) return;
  container.innerHTML = "";
  if (!rounds.length) {
    container.innerHTML =
      '<div class="rounded-lg border border-slate-200 p-3 text-sm text-slate-500">Chưa có dữ liệu trận.</div>';
    return;
  }
  rounds.forEach((roundItem) => {
    const wrapper = document.createElement("div");
    wrapper.className = "overflow-x-auto rounded-lg border border-slate-200";
    const rows = (roundItem.matches || [])
      .map((match, index) => {
        const teamA = `${match.teamA?.[0]?.name || "-"} (${match.teamA?.[0]?.level || "-"}) + ${match.teamA?.[1]?.name || "-"} (${match.teamA?.[1]?.level || "-"})`;
        const teamB = `${match.teamB?.[0]?.name || "-"} (${match.teamB?.[0]?.level || "-"}) + ${match.teamB?.[1]?.name || "-"} (${match.teamB?.[1]?.level || "-"})`;
        return `<tr>
          <td class="border border-slate-200 px-2 py-1 text-center">${index + 1}</td>
          <td class="border border-slate-200 px-2 py-1">${teamA}</td>
          <td class="border border-slate-200 px-2 py-1">${teamB}</td>
          <td class="border border-slate-200 px-2 py-1 text-right">${match.levelDiff ?? "-"}</td>
        </tr>`;
      })
      .join("");
    wrapper.innerHTML = `
      <div class="bg-slate-100 px-3 py-2 text-sm font-medium">Round ${roundItem.round}</div>
      <table class="min-w-full text-sm">
        <thead class="bg-slate-50">
          <tr>
            <th class="border border-slate-200 px-2 py-1 text-center">#</th>
            <th class="border border-slate-200 px-2 py-1 text-left">Team A</th>
            <th class="border border-slate-200 px-2 py-1 text-left">Team B</th>
            <th class="border border-slate-200 px-2 py-1 text-right">Chênh lệch</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="4" class="border border-slate-200 px-2 py-2 text-center text-slate-500">Không đủ người để xếp trận.</td></tr>'}</tbody>
      </table>
      <div class="px-3 py-2 text-xs text-slate-500">Ngồi chờ: ${(roundItem.waiting || []).join(", ") || "-"}</div>
    `;
    container.appendChild(wrapper);
  });
}

function groupMatchesToRounds(matches = []) {
  const map = new Map();
  matches.forEach((match) => {
    const key = Number(match.round || 1);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({
      teamA: match.teamA || [],
      teamB: match.teamB || [],
      levelDiff: Number(match.levelDiff || 0)
    });
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([round, matchRows]) => ({
      round,
      matches: matchRows,
      waiting: []
    }));
}

async function loadMatchesForDate(date) {
  if (!date) return [];
  const data = await api(`/api/matches?date=${encodeURIComponent(date)}`);
  return data.matches || [];
}

function renderReportTables(report) {
  document.getElementById("reportMonthValue").textContent = report?.month || "-";
  document.getElementById("reportTotalCost").textContent = formatMoney(report?.totalMonthlyCost || 0);
  document.getElementById("reportTotalSessions").textContent = String(report?.totalSessions || 0);

  const attendanceBody = document.getElementById("reportAttendanceBody");
  const debtBody = document.getElementById("reportTopDebtorsBody");
  const payerBody = document.getElementById("reportTopPayersBody");
  attendanceBody.innerHTML = "";
  debtBody.innerHTML = "";
  payerBody.innerHTML = "";

  (report?.attendanceByMember || []).forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="border border-slate-200 px-2 py-1">${item.memberName}</td>
      <td class="border border-slate-200 px-2 py-1 text-right">${item.attendedSessions}</td>
      <td class="border border-slate-200 px-2 py-1 text-right">${item.totalSessions}</td>
      <td class="border border-slate-200 px-2 py-1 text-right">${Math.round(Number(item.attendanceRate || 0) * 100)}%</td>
    `;
    attendanceBody.appendChild(tr);
  });

  (report?.topDebtors || []).forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="border border-slate-200 px-2 py-1">${item.memberName}</td>
      <td class="border border-slate-200 px-2 py-1 text-right text-red-600">${formatMoney(item.balance)}</td>
    `;
    debtBody.appendChild(tr);
  });

  (report?.topPayers || []).forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="border border-slate-200 px-2 py-1">${item.memberName}</td>
      <td class="border border-slate-200 px-2 py-1 text-right text-emerald-600">${formatMoney(item.amount)}</td>
    `;
    payerBody.appendChild(tr);
  });
}

async function mountTournamentPanel(role) {
  const mountId = role === "admin" ? "adminTournamentMount" : "userTournamentMount";
  const mount = document.getElementById(mountId);
  if (!mount || !window.TournamentPanel) return;
  const key = `${role}:${state.auth?.memberName || role}`;
  if (state.tournamentMountedFor === key && mount.dataset.ready === "1") {
    await window.TournamentPanel.refresh().catch(() => {});
    return;
  }
  mount.dataset.ready = "0";
  await window.TournamentPanel.mount(mount);
  mount.dataset.ready = "1";
  state.tournamentMountedFor = key;
}

function formatNoticeTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function renderNoticeList(containerId, notices) {
  const box = document.getElementById(containerId);
  if (!box) return;
  const list = Array.isArray(notices) ? notices : [];
  if (!list.length) {
    box.innerHTML = `<p class="text-sm text-slate-500">Chưa có thông báo nào.</p>`;
    return;
  }
  box.innerHTML = list
    .map(
      (item) => `<article class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p class="whitespace-pre-wrap text-sm text-slate-800">${escapeHtmlText(item.content || "")}</p>
        <p class="mt-2 text-xs text-slate-500">${escapeHtmlText(formatNoticeTime(item.createdAt))}</p>
      </article>`
    )
    .join("");
}

async function loadNotices(containerId) {
  const data = await api("/api/notices");
  renderNoticeList(containerId, data.notices || []);
}

function activateUserTab(tabId) {
  state.activeUserTab = tabId;
  const home = document.getElementById("userHomeTabContent");
  const tournament = document.getElementById("userTournamentTabContent");
  const notices = document.getElementById("userNoticeTabContent");
  home?.classList.toggle("hidden", tabId !== "home");
  tournament?.classList.toggle("hidden", tabId !== "tournament");
  notices?.classList.toggle("hidden", tabId !== "notices");
  document.getElementById("userTabHomeBtn")?.classList.toggle("is-active", tabId === "home");
  document.getElementById("userTabTournamentBtn")?.classList.toggle("is-active", tabId === "tournament");
  document.getElementById("userTabNoticeBtn")?.classList.toggle("is-active", tabId === "notices");
  if (tabId === "tournament") {
    mountTournamentPanel("user").catch((error) => {
      const mount = document.getElementById("userTournamentMount");
      if (mount) mount.innerHTML = `<p class="text-sm text-rose-600">${error.message}</p>`;
    });
  }
  if (tabId === "notices") {
    loadNotices("userNoticeList").catch((error) => {
      const box = document.getElementById("userNoticeList");
      if (box) box.innerHTML = `<p class="text-sm text-rose-600">${escapeHtmlText(error.message)}</p>`;
    });
  }
}

function activateAdminTab(tabId) {
  state.activeAdminTab = tabId;

  const contentDefs = {
    court: "courtTabContent",
    expenses: "expensesTabContent",
    ledger: "ledgerTabContent",
    games: "gamesTabContent",
    tools: "toolsTabContent",
    credit: "creditTabContent",
    tournament: "tournamentTabContent",
    notices: "noticeTabContent"
  };
  Object.entries(contentDefs).forEach(([key, contentId]) => {
    const el = document.getElementById(contentId);
    if (!el) return;
    el.classList.toggle("hidden", key !== tabId);
  });

  const btnDefs = {
    court: "adminTabCourtBtn",
    expenses: "adminTabExpensesBtn",
    ledger: "adminTabLedgerBtn",
    games: "adminTabGamesBtn",
    tools: "adminTabToolsBtn",
    credit: "adminTabCreditBtn",
    tournament: "adminTabTournamentBtn",
    notices: "adminTabNoticeBtn"
  };
  Object.entries(btnDefs).forEach(([key, btnId]) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const active = key === tabId;

    btn.classList.toggle("is-active", active);
  });

  if (tabId === "credit") loadCreditBoard().catch((error) => setMessage("creditMessage", error.message, true));

  if (tabId === "expenses" || tabId === "ledger") {
    window.BasicLedger.mountEntry(document.getElementById("adminEntryMount"));
    window.BasicLedger.mountLedger(document.getElementById("adminLedgerMount"));
    window.BasicLedger.load().catch((error) => setMessage("voteListMessage", error.message, true));
  }

  if (tabId === "notices") {
    loadNotices("adminNoticeList").catch((error) => setMessage("noticeMessage", error.message, true));
  }

  if (tabId === "tournament") {
    mountTournamentPanel("admin").catch((error) => {
      const mount = document.getElementById("adminTournamentMount");
      if (mount) mount.innerHTML = `<p class="text-sm text-rose-600">${error.message}</p>`;
    });
  }
}

async function loadLoginOptions() {
  const data = await api("/api/tournament/login-options").catch(() => api("/api/login-options"));
  state.loginOptions = data.members || [];
  renderLoginOptions();
}

async function loadAdminDashboard() {
  const data = await api("/api/bootstrap");
  state.auth = data.auth;
  state.members = data.members || [];
  renderRoleHeader(data.auth);
  renderMemberLevels(state.members);
  renderSessionSelect(data.sessions || []);
  state.voteSessions = data.voteSessions || [];
  renderAdminVoteList(state.voteSessions);
  activateAdminTab(state.activeAdminTab || "court");

  const selectedSessionId = document.getElementById("matchSessionSelect")?.value || "";
  const selectedSession = state.sessions.find((item) => item.sessionId === selectedSessionId);
  if (selectedSession?.date) {
    const matches = await loadMatchesForDate(selectedSession.date);
    renderMatchTables(groupMatchesToRounds(matches));
  } else {
    renderMatchTables([]);
  }
  const dateInput = document.getElementById("preDateInput");
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
}

async function loadUserDashboard() {
  const data = await api("/api/bootstrap");
  state.auth = data.auth;
  state.voteSessions = data.voteSessions || [];
  renderRoleHeader(data.auth);
  activateUserTab(state.activeUserTab || "home");
  renderUpcoming(data.upcomingSession);
  renderUserVoteList(state.voteSessions);
  await loadUserBasicLedger(data.auth?.memberName || "");
  if (data.activeVote) {
    openVoteModal(data.activeVote);
  }
}

async function loadUserBasicLedger(memberName = "") {
  window.BasicLedger.mountLedger(document.getElementById("userLedgerMount"));
  try {
    const data = await window.BasicLedger.load();
    const name = memberName || state.auth?.memberName || data.memberName || "";
    const mine = (data.members || []).find((item) => item.name.toLowerCase() === name.toLowerCase());
    const credit = (data.credits || []).find((item) => item.memberId === mine?.memberId);
    renderUserDebt(summarizeBasicDebt(data, name), Number(credit?.balance || 0));
  } catch (error) {
    const el = document.getElementById("myDebtCard");
    if (el) el.textContent = error.message;
  }
}

async function loadDashboard() {
  const data = await api("/api/bootstrap");
  if (data.auth.role === "admin") return loadAdminDashboard();
  return loadUserDashboard();
}

function bindEvents() {
  document.querySelectorAll("#authModeSegment .login-segment-btn").forEach((btn) => {
    btn.addEventListener("click", () => setLoginAuthMode(btn.dataset.mode));
  });
  setLoginAuthMode("login");

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorEl = document.getElementById("loginError");
    errorEl.classList.add("hidden");
    try {
      const mode = state.loginAuthMode || "login";
      const isUserFlow = mode === "login" || mode === "register";
      const permissionPromise =
        isUserFlow && window.preparePushPermission ? window.preparePushPermission() : Promise.resolve();

      if (mode === "admin") {
        await api("/api/tournament/login", {
          method: "POST",
          body: JSON.stringify({
            mode: "admin",
            password: document.getElementById("passwordInput").value
          })
        });
      } else if (mode === "register") {
        await api("/api/tournament/register", {
          method: "POST",
          body: JSON.stringify({
            name: document.getElementById("registerName").value.trim(),
            phoneNumber: document.getElementById("registerPhone").value.trim()
          })
        });
      } else {
        await api("/api/tournament/login", {
          method: "POST",
          body: JSON.stringify({
            mode: "user",
            memberName: document.getElementById("memberSelectInput").value,
            phoneNumber: document.getElementById("phoneInput").value.trim()
          })
        });
      }

      await permissionPromise.catch(() => {});
      showAppMode();
      await loadDashboard();
      if (isUserFlow) window.registerPush?.({ prompt: false }).catch(() => {});
      if (mode === "register") await loadLoginOptions().catch(() => {});
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.classList.remove("hidden");
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    showLoginMode();
  });

  document.getElementById("adminTabCourtBtn")?.addEventListener("click", () => activateAdminTab("court"));
  document.getElementById("adminTabExpensesBtn")?.addEventListener("click", () => activateAdminTab("expenses"));
  document.getElementById("adminTabLedgerBtn")?.addEventListener("click", () => activateAdminTab("ledger"));
  document.getElementById("adminTabGamesBtn")?.addEventListener("click", () => activateAdminTab("games"));
  document.getElementById("adminTabToolsBtn")?.addEventListener("click", () => activateAdminTab("tools"));
  document.getElementById("adminTabTournamentBtn")?.addEventListener("click", () => activateAdminTab("tournament"));
  document.getElementById("adminTabNoticeBtn")?.addEventListener("click", () => activateAdminTab("notices"));
  document.getElementById("userTabHomeBtn")?.addEventListener("click", () => activateUserTab("home"));
  document.getElementById("userTabTournamentBtn")?.addEventListener("click", () => activateUserTab("tournament"));
  document.getElementById("userTabNoticeBtn")?.addEventListener("click", () => activateUserTab("notices"));

  document.getElementById("noticeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = document.getElementById("noticeContentInput")?.value.trim() || "";
    if (!content) {
      setMessage("noticeMessage", "Nội dung không được để trống.", true);
      return;
    }
    try {
      const data = await api("/api/notices", {
        method: "POST",
        body: JSON.stringify({ content })
      });
      document.getElementById("noticeContentInput").value = "";
      setMessage("noticeMessage", data.message || "Đã gửi thông báo.");
      await loadNotices("adminNoticeList");
    } catch (error) {
      setMessage("noticeMessage", error.message, true);
    }
  });

  document.getElementById("refreshMembersBtn")?.addEventListener("click", loadAdminDashboard);
}

function fillCreditMembers() {
  const select = document.getElementById("creditMemberSelect");
  if (!select) return;
  const current = select.value;
  const members = (state.members || []).filter((member) => member.active !== false);
  select.innerHTML = members.length
    ? members
        .map((member) => `<option value="${escapeHtmlText(member.memberId)}">${escapeHtmlText(member.name)}</option>`)
        .join("")
    : `<option value="">Chưa có thành viên</option>`;
  if (current && members.some((member) => member.memberId === current)) select.value = current;
}

function renderCreditBoard(payload) {
  const balances = payload?.balances || [];
  const entries = payload?.entries || [];
  const balanceBody = document.getElementById("creditBalanceBody");
  const entryBody = document.getElementById("creditEntryBody");
  if (balanceBody) {
    balanceBody.innerHTML = balances.length
      ? balances
          .map(
            (item) =>
              `<tr><td>${escapeHtmlText(item.memberName)}</td><td class="text-right">${formatMoney(item.balance)}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="2" class="text-slate-500">Chưa có tiền thừa.</td></tr>`;
  }
  if (entryBody) {
    entryBody.innerHTML = entries.length
      ? entries
          .map((item) => {
            const sign = item.amount > 0 ? "+" : "";
            return `<tr><td>${escapeHtmlText(item.memberName)}</td><td class="text-right">${sign}${formatMoney(item.amount)}</td><td>${escapeHtmlText(item.note || "-")}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="3" class="text-slate-500">Chưa có ghi nhận.</td></tr>`;
  }
}

async function loadCreditBoard() {
  fillCreditMembers();
  const data = await api("/api/credits");
  renderCreditBoard(data);
}

document.getElementById("adminTabCreditBtn")?.addEventListener("click", () => activateAdminTab("credit"));
document.getElementById("creditForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = Number(String(document.getElementById("creditAmountInput")?.value || "").replace(/[^\d]/g, ""));
  if (!amount) {
    setMessage("creditMessage", "Nhập số tiền lớn hơn 0.", true);
    return;
  }
  try {
    const data = await api("/api/credits", {
      method: "POST",
      body: JSON.stringify({
        memberId: document.getElementById("creditMemberSelect")?.value,
        amount,
        direction: document.getElementById("creditDirectionInput")?.value || "add",
        note: document.getElementById("creditNoteInput")?.value || ""
      })
    });
    document.getElementById("creditAmountInput").value = "";
    document.getElementById("creditNoteInput").value = "";
    renderCreditBoard(data);
    setMessage("creditMessage", data.message || "Đã lưu.");
  } catch (error) {
    setMessage("creditMessage", error.message, true);
  }
});

  document.getElementById("migrateSheetsBtn")?.addEventListener("click", async () => {
    const ok = window.confirm(
      "Migrate từ Google Sheets sẽ ghi đè dữ liệu hiện có trong Postgres. Bạn có chắc muốn tiếp tục?"
    );
    if (!ok) return;
    try {
      const data = await api("/api/admin/migrate-from-sheets", { method: "POST" });
      const rows = data.rows || {};
      setMessage(
        "dataOpsMessage",
        `Migrate thành công. Members: ${rows.members || 0}, Sessions: ${rows.sessions || 0}, Payments: ${rows.payments || 0}.`
      );
      await loadDashboard();
    } catch (error) {
      setMessage("dataOpsMessage", error.message, true);
    }
  });
  document.getElementById("testPushBtn")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/push/test", { method: "POST" });
      const session = data.session?.date ? ` Lịch gần nhất: ${data.session.date}.` : "";
      const summary = data.configured
        ? `Đã gửi ${data.sent || 0} thông báo, ${data.withToken || 0} người có token.${session}`
        : data.message || "Firebase chưa cấu hình service account.";
      setMessage("dataOpsMessage", summary, !data.configured);
    } catch (error) {
      setMessage("dataOpsMessage", error.message, true);
    }
  });
  document.getElementById("syncSheetsBtn")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/admin/sync-sheets", { method: "POST" });
      const rows = data.rows || {};
      setMessage(
        "dataOpsMessage",
        `Sync thành công lúc ${data.syncedAt || ""}. Sessions: ${rows.sessions || 0}, Participants: ${rows.participants || 0}.`
      );
    } catch (error) {
      setMessage("dataOpsMessage", error.message, true);
    }
  });
  document.getElementById("openAddMemberBtn")?.addEventListener("click", () => openMemberModal(null));
  document.getElementById("memberModalCloseBtn")?.addEventListener("click", () => toggleModal("memberModal", false));
  document.getElementById("memberLevelTable").addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const memberId = String(target.dataset.memberId || "");
    if (!memberId) return;

    if (target.classList.contains("edit-member-btn")) {
      const member = state.members.find((item) => item.memberId === memberId);
      if (!member) {
        setMessage("memberManageMessage", "Không tìm thấy thông tin member để chỉnh sửa.", true);
        return;
      }
      openMemberModal(member);
      return;
    }

    if (!target.classList.contains("delete-member-btn")) return;
    const member = state.members.find((item) => item.memberId === memberId);
    const memberName = member?.name || memberId;
    if (!window.confirm(`Xóa thành viên "${memberName}"? Thao tác này không hoàn tác.`)) return;
    try {
      await api(`/api/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
      setMessage("memberManageMessage", `Đã xóa member ${memberName}.`);
      await loadAdminDashboard();
    } catch (error) {
      setMessage("memberManageMessage", error.message, true);
    }
  });
  document.getElementById("memberForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const memberId = document.getElementById("memberModalIdInput").value.trim();
    const payload = {
      name: document.getElementById("memberNameInput").value.trim(),
      type: document.getElementById("memberTypeInput").value,
      gender: document.getElementById("memberGenderInput").value,
      birthday: document.getElementById("memberBirthdayInput").value,
      phoneNumber: document.getElementById("memberPhoneInput").value.trim(),
      level: Number(document.getElementById("memberLevelInput").value || 5),
      active: document.getElementById("memberActiveInput").checked
    };
    try {
      if (!payload.name) {
        setMessage("memberModalMessage", "Tên member không được để trống.", true);
        return;
      }
      if (memberId) {
        await api(`/api/members/${encodeURIComponent(memberId)}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        setMessage("memberManageMessage", `Đã cập nhật member ${payload.name}.`);
      } else {
        await api("/api/members", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setMessage("memberManageMessage", `Đã thêm member ${payload.name}.`);
      }
      toggleModal("memberModal", false);
      await loadAdminDashboard();
    } catch (error) {
      setMessage("memberModalMessage", error.message, true);
    }
  });

  document.getElementById("resendSessionPushBtn")?.addEventListener("click", async () => {
    const button = document.getElementById("resendSessionPushBtn");
    button.disabled = true;
    try {
      const data = await api("/api/sessions/notify", { method: "POST" });
      const pushFailed = Boolean(data.push && ((!data.push.configured) || (!data.push.sent && data.push.failed)));
      setMessage("preSessionMessage", data.message, pushFailed);
    } catch (error) {
      setMessage("preSessionMessage", error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById("preSessionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          date: document.getElementById("preDateInput").value,
          time: document.getElementById("preTimeInput").value,
          location: document.getElementById("preLocationInput").value.trim(),
          note: document.getElementById("preNoteInput").value.trim()
        })
      });
      const pushFailed = Boolean(data.push && ((!data.push.configured) || (!data.push.sent && data.push.failed)));
      setMessage("preSessionMessage", data.message || "Đã tạo buổi vote thành công.", pushFailed);
      await loadAdminDashboard();
    } catch (error) {
      setMessage("preSessionMessage", error.message, true);
    }
  });

  document.getElementById("generateMatchesBtn").addEventListener("click", async () => {
    const sessionId = document.getElementById("matchSessionSelect").value;
    const roundCount = Number(document.getElementById("roundCountInput").value || 2);
    try {
      const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/matches`, {
        method: "POST",
        body: JSON.stringify({ roundCount })
      });
      renderMatchTables(data.rounds || []);
      setMessage("matchMessage", `Đã generate xếp trận cho ngày ${data.matchDate}.`);
    } catch (error) {
      renderMatchTables([]);
      setMessage("matchMessage", error.message, true);
    }
  });
  document.getElementById("matchSessionSelect")?.addEventListener("change", async () => {
    try {
      const sessionId = document.getElementById("matchSessionSelect").value;
      const selectedSession = state.sessions.find((item) => item.sessionId === sessionId);
      if (!selectedSession?.date) {
        renderMatchTables([]);
        return;
      }
      const matches = await loadMatchesForDate(selectedSession.date);
      renderMatchTables(groupMatchesToRounds(matches));
    } catch (error) {
      renderMatchTables([]);
      setMessage("matchMessage", error.message, true);
    }
  });

  document.getElementById("htmlConvertForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const htmlInput = document.getElementById("htmlConvertInput")?.value || "";
      const buttonTextCTA1 = document.getElementById("htmlConvertTextInputCTA1")?.value?.trim() || "";
      const buttonTextCTA2 = document.getElementById("htmlConvertTextInputCTA2")?.value?.trim() || "";
      const variantId = document.getElementById("htmlConvertVariantIdInput")?.value?.trim() || "";

      if (!htmlInput.trim()) throw new Error("Vui lòng nhập HTML input.");
      if (!buttonTextCTA1) throw new Error("Vui lòng nhập text button CTA 1.");
      if (!buttonTextCTA2) throw new Error("Vui lòng nhập text button CTA 2.");
      if (!variantId) throw new Error("Vui lòng nhập variant ID.");

      const safeTextCTA1 = escapeHtmlText(buttonTextCTA1);
      const safeTextCTA2 = escapeHtmlText(buttonTextCTA2);
      const safeVariantId = escapeHtmlText(variantId);

      const buttonBlockCTA1 = `<button class="cta ink-button ink-button-yellow ink-animate-custom" data-variant-id="${safeVariantId}" data-qty="1" onclick="addToCart(this)">\n  <span class="ink-text">${safeTextCTA1}</span>\n  <span class="ink-loading" style="display:none;">\n    <span class="ink-spinner"></span>\n  </span>\n</button>`;
      const buttonBlockCTA2 = `<button class="cta ink-button ink-button-yellow ink-animate-custom" data-variant-id="${safeVariantId}" data-qty="1" onclick="addToCart(this)">\n  <span class="ink-text">${safeTextCTA2}</span>\n  <span class="ink-loading" style="display:none;">\n    <span class="ink-spinner"></span>\n  </span>\n</button>`;

      const scriptBlock = `<script>\nfunction addToCart(btn) {\n  const variantId = btn.dataset.variantId;\n  const qty = btn.dataset.qty || 1;\n  if (!variantId) {\n    console.error('Missing variant ID');\n    return;\n  }\n\n  // loading UI\n  const text = btn.querySelector('.ink-text');\n  const loading = btn.querySelector('.ink-loading');\n  if (text) text.style.display = 'none';\n  if (loading) loading.style.display = 'inline-flex';\n  btn.disabled = true;\n\n  fetch('/cart/add.js', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ id: variantId, quantity: qty })\n  })\n    .then(res => res.json())\n    .then(() => {\n      // 👉 mở cart hoặc redirect\n      window.location.href = '/cart';\n    })\n    .catch(err => {\n      console.error(err);\n    })\n    .finally(() => {\n      if (text) text.style.display = 'inline';\n      if (loading) loading.style.display = 'none';\n      btn.disabled = false;\n    });\n}\n</script>`;

      // Ưu tiên thay đúng block có comment CTA: <!-- CTA #x --> + <a class="cta">...</a>
      const ctaWithCommentPattern =
        /(<!--\s*CTA\s*#\d+\s*-->)\s*<a\b[^>]*class=["'][^"']*\bcta\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
      let replacedCount = 0;
      let transformedHtml = htmlInput.replace(ctaWithCommentPattern, (_match, comment) => {
        replacedCount += 1;
        if (replacedCount === 1) {
          return `${comment}\n${buttonBlockCTA1}`;
        } else {
          return `${comment}\n${buttonBlockCTA2}`;
        }
      });

      // Fallback: nếu không có comment CTA thì thay toàn bộ <a class="cta">...</a>
      if (replacedCount === 0) {
        const ctaAnchorPattern = /<a\b[^>]*class=["'][^"']*\bcta\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
        transformedHtml = transformedHtml.replace(ctaAnchorPattern, () => {
          replacedCount += 1;
          return buttonBlock;
        });
      }

      const output = `${transformedHtml.trim()}\n\n${scriptBlock}`;
      const outEl = document.getElementById("htmlConvertOutput");
      if (outEl) outEl.value = output;
      setMessage(
        "htmlConvertMessage",
        replacedCount > 0
          ? `Đã convert thành công. Đã thay ${replacedCount} CTA.`
          : "Không tìm thấy thẻ <a class=\"cta\"> nào để thay thế."
      );
    } catch (error) {
      setMessage("htmlConvertMessage", error.message || "Convert thất bại.", true);
    }
  });

  document.getElementById("loadReportBtn").addEventListener("click", async () => {
    try {
      const month = document.getElementById("reportMonthInput").value;
      const data = await api(`/api/reports/monthly?month=${encodeURIComponent(month)}`);
      renderReportTables(data);
      setMessage("reportMessage", "Đã tải báo cáo tháng.");
    } catch (error) {
      setMessage("reportMessage", error.message, true);
    }
  });

  document.getElementById("downloadCsvBtn").addEventListener("click", () => {
    const month = document.getElementById("reportMonthInput").value;
    if (!month) return;
    window.open(`/api/reports/monthly?month=${encodeURIComponent(month)}&format=csv`, "_blank");
  });

  document.getElementById("attendanceCloseBtn")?.addEventListener("click", () => toggleModal("attendanceModal", false));
  document.getElementById("attendanceYesBtn")?.addEventListener("click", () => submitAttendance("yes"));
  document.getElementById("attendanceNoBtn")?.addEventListener("click", () => submitAttendance("no"));
  document.getElementById("bookingImageCloseBtn")?.addEventListener("click", () => {
    toggleModal("bookingImageModal", false);
    const image = document.getElementById("bookingImagePreview");
    if (image) image.removeAttribute("src");
  });

  document.getElementById("voteSessionList")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const sessionId = String(button.dataset.session || "").trim();
    if (action === "preview-booking" && sessionId) {
      const session = state.voteSessions.find((item) => item.sessionId === sessionId);
      if (session?.bookingImageUrl) openBookingImage(session.bookingImageUrl);
      return;
    }
    if (action === "cancel-vote" && sessionId) {
      try {
        await cancelVoteSession(sessionId);
      } catch (error) {
        setMessage("voteListMessage", error.message, true);
      }
      return;
    }
    if (action === "toggle-member" && sessionId) {
      const status = button.dataset.status === "yes" ? "no" : "yes";
      button.disabled = true;
      try {
        await api(`/api/sessions/${encodeURIComponent(sessionId)}/respond`, {
          method: "POST",
          body: JSON.stringify({ memberName: button.dataset.member, status })
        });
        const data = await api("/api/sessions/votes");
        renderAdminVoteList(data.sessions || []);
      } catch (error) {
        button.disabled = false;
        setMessage("voteListMessage", error.message, true);
      }
      return;
    }
    if (action === "charge-vote" && sessionId) {
      const session = state.voteSessions.find((item) => item.sessionId === sessionId);
      if (!session) return;
      activateAdminTab("expenses");
      await window.BasicLedger.load().catch(() => {});
      window.BasicLedger.prefill({
        date: session.date,
        court: session.location,
        memberIds: (session.members || []).filter((m) => m.status === "yes").map((m) => m.memberId),
        voteSessionId: session.sessionId,
        label: `${session.date} ${session.time || ""}`.trim()
      });
    }
  });

  document.getElementById("voteSessionList")?.addEventListener("change", async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
    if (input.dataset.action !== "book-vote") return;
    const sessionId = String(input.dataset.session || "").trim();
    const file = input.files?.[0];
    input.value = "";
    if (!sessionId || !file) return;
    try {
      setMessage("voteListMessage", "Đang upload ảnh đặt sân...");
      await bookVoteSession(sessionId, file);
    } catch (error) {
      setMessage("voteListMessage", error.message, true);
    }
  });

  document.getElementById("userVoteList")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const sessionId = String(button.dataset.session || "").trim();
    if (action === "preview-booking" && sessionId) {
      const session = state.voteSessions.find((item) => item.sessionId === sessionId);
      if (session?.bookingImageUrl) openBookingImage(session.bookingImageUrl);
      return;
    }
    if (action === "user-respond" && sessionId) {
      button.disabled = true;
      await submitAttendance(button.dataset.status, sessionId);
      button.disabled = false;
    }
  });

  document.getElementById("myDebtQrActions")?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id !== "openQrBtn") return;
    const amount = Number(state.userBasicBalance || 0);
    if (amount > 0) {
      openQrModal(state.auth?.memberName || "", amount);
    }
  });

  document.getElementById("qrCloseBtn")?.addEventListener("click", () => toggleModal("qrModal", false));

  document.getElementById("voteCloseBtn")?.addEventListener("click", () => toggleModal("voteModal", false));
  document.getElementById("voteSkipBtn")?.addEventListener("click", () => toggleModal("voteModal", false));
  document.getElementById("voteSubmitBtn")?.addEventListener("click", async () => {
    if (!state.activeVote?.sessionId) {
      setMessage("voteMessage", "Không có vote đang mở.", true);
      return;
    }
    const answer = document.getElementById("voteAnswerInput").value.trim();
    if (!answer) {
      setMessage("voteMessage", "Bạn cần nhập câu trả lời trước khi gửi.", true);
      return;
    }
    try {
      await api(`/api/sessions/${encodeURIComponent(state.activeVote.sessionId)}/poll-answer`, {
        method: "POST",
        body: JSON.stringify({ answer })
      });
      setMessage("voteMessage", "Đã ghi nhận vote.");
      setTimeout(() => toggleModal("voteModal", false), 500);
      await loadUserDashboard();
    } catch (error) {
      setMessage("voteMessage", error.message, true);
    }
  });

async function init() {
  bindEvents();
  window.BasicLedger.onChange(async (change) => {
    if (state.auth?.role !== "admin" || change.type !== "saved") return;
    activateAdminTab("ledger");
    const data = await api("/api/sessions/votes").catch(() => null);
    if (data) renderAdminVoteList(data.sessions || []);
  });
  toggleLoginMode();
  try {
    await loadLoginOptions();
    await loadDashboard();
    showAppMode();
    if (state.auth?.role === "user") window.registerPush?.({ prompt: false }).catch(() => {});
  } catch (_error) {
    showLoginMode();
  }
}

init();
