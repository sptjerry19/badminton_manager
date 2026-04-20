const state = {
  loginOptions: [],
  auth: null,
  sessions: [],
  members: [],
  pendingApiCalls: 0
};

function formatMoney(value) {
  return new Intl.NumberFormat("vi-VN").format(Number(value || 0));
}

function setLoading(isLoading) {
  const modal = document.getElementById("loadingModal");
  if (!modal) return;
  modal.classList.toggle("hidden", !isLoading);
  modal.classList.toggle("flex", isLoading);
}

async function api(path, options = {}) {
  state.pendingApiCalls += 1;
  setLoading(true);
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
    state.pendingApiCalls = Math.max(0, state.pendingApiCalls - 1);
    setLoading(state.pendingApiCalls > 0);
  }
}

function showLoginMode() {
  document.getElementById("loginSection").classList.remove("hidden");
  document.getElementById("appSection").classList.add("hidden");
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

function toggleLoginMode() {
  const mode = document.getElementById("loginModeInput").value;
  document.getElementById("adminLoginFields").classList.toggle("hidden", mode !== "admin");
  document.getElementById("userLoginFields").classList.toggle("hidden", mode !== "user");
}

function renderLoginOptions() {
  const select = document.getElementById("memberSelectInput");
  select.innerHTML = "";
  state.loginOptions.forEach((member) => {
    const option = document.createElement("option");
    option.value = member.name;
    option.textContent = member.name;
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

function createGuestRow() {
  const row = document.createElement("div");
  row.className = "grid grid-cols-12 gap-2";
  row.innerHTML = `
    <input class="guest-name col-span-6 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Tên GL" />
    <select class="guest-gender col-span-4 rounded-lg border border-slate-300 px-2 py-2 text-sm">
      <option value="Nam">Nam</option>
      <option value="Nữ">Nữ</option>
    </select>
    <button type="button" class="guest-remove col-span-2 rounded-lg border border-slate-300 px-2 py-2 text-sm hover:bg-slate-100">Xóa</button>
  `;
  row.querySelector(".guest-remove")?.addEventListener("click", () => row.remove());
  return row;
}

function renderSettleFixedMembers(members) {
  const container = document.getElementById("settleFixedMembersContainer");
  if (!container) return;
  container.innerHTML = "";
  members
    .filter((member) => member.active && member.type === "Cố định")
    .forEach((member) => {
      const id = `fixed_${member.memberId}`;
      const wrapper = document.createElement("label");
      wrapper.className = "flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2";
      wrapper.dataset.name = member.name;
      wrapper.innerHTML = `
        <input id="${id}" type="checkbox" class="fixed-present h-4 w-4" />
        <span class="text-sm">${member.name}</span>
      `;
      container.appendChild(wrapper);
    });
}

function renderMemberLevels(members) {
  const tbody = document.getElementById("memberLevelTable");
  tbody.innerHTML = "";
  members
    .filter((member) => member.active && member.type === "Cố định")
    .forEach((member) => {
      const tr = document.createElement("tr");
      const options = Array.from({ length: 10 }, (_, index) => index + 1)
        .map((level) => `<option value="${level}" ${Number(member.level) === level ? "selected" : ""}>${level}</option>`)
        .join("");
      tr.innerHTML = `
        <td class="border border-slate-200 px-2 py-1">${member.name}</td>
        <td class="border border-slate-200 px-2 py-1">${member.phoneNumber || "-"}</td>
        <td class="border border-slate-200 px-2 py-1"><select data-name="${member.name}" class="member-level-input rounded border border-slate-300 px-2 py-1">${options}</select></td>
        <td class="border border-slate-200 px-2 py-1"><button data-name="${member.name}" class="save-level-btn rounded bg-blue-600 px-2 py-1 text-white">Lưu</button></td>
      `;
      tbody.appendChild(tr);
    });
}

function renderSessionSelect(sessions) {
  state.sessions = sessions;
  const matchSelect = document.getElementById("matchSessionSelect");
  const settleSelect = document.getElementById("settleSessionSelect");
  const attendanceSelect = document.getElementById("attendanceSessionSelect");
  matchSelect.innerHTML = "";
  settleSelect.innerHTML = "";
  attendanceSelect.innerHTML = "";
  sessions.forEach((session) => {
    const optionText = `${session.date} ${session.time} - ${session.sessionId}${session.settled ? " (đã chốt)" : ""}`;
    const matchOption = document.createElement("option");
    matchOption.value = session.sessionId;
    matchOption.textContent = optionText;
    matchSelect.appendChild(matchOption);

    const settleOption = document.createElement("option");
    settleOption.value = session.sessionId;
    settleOption.textContent = optionText;
    settleSelect.appendChild(settleOption);

    const attendanceOption = document.createElement("option");
    attendanceOption.value = session.sessionId;
    attendanceOption.textContent = optionText;
    attendanceSelect.appendChild(attendanceOption);
  });
}

function renderUpcoming(session) {
  const info = document.getElementById("upcomingInfo");
  const pollInput = document.getElementById("pollAnswerInput");
  if (!session) {
    info.textContent = "Hiện chưa có buổi upcoming.";
    pollInput.placeholder = "Không có poll";
    pollInput.disabled = true;
    return;
  }
  info.innerHTML = [
    `Buổi: ${session.date} ${session.time}`,
    session.location ? `Địa điểm: ${session.location}` : "",
    `Trạng thái hiện tại: ${session.myStatus || "pending"}`,
    session.poll ? `Poll: ${session.poll.question}` : "Không có poll"
  ]
    .filter(Boolean)
    .join(" | ");
  document.getElementById("attendanceInput").value = session.myStatus === "no" ? "no" : "yes";
  pollInput.disabled = !session.poll;
  pollInput.placeholder = session.poll ? "Nhập câu trả lời poll" : "Không có poll";
  pollInput.value = session.poll?.myAnswer || "";
  pollInput.dataset.sessionId = session.sessionId;
}

function renderUserDebt(myDebt) {
  const el = document.getElementById("myDebtCard");
  if (!myDebt) {
    el.textContent = "Chưa có dữ liệu công nợ.";
    return;
  }
  el.innerHTML = `
    <div>Tổng phải trả: <strong>${formatMoney(myDebt.totalDue)}</strong></div>
    <div>Đã thanh toán: <strong>${formatMoney(myDebt.totalPaid)}</strong></div>
    <div>Số dư: <strong class="${myDebt.balance > 0 ? "text-red-600" : "text-emerald-600"}">${formatMoney(myDebt.balance)}</strong></div>
  `;
}

function formatAttendanceStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "yes") return "Có tham gia";
  if (value === "no") return "Không tham gia";
  return "Chưa phản hồi";
}

function renderAdminAttendanceTable(participants = [], pollQuestion = "") {
  const tbody = document.getElementById("attendanceTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!participants.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="border border-slate-200 px-2 py-2 text-center text-slate-500">Chưa có dữ liệu xác nhận.</td>`;
    tbody.appendChild(tr);
    return;
  }
  participants.forEach((item) => {
    const tr = document.createElement("tr");
    const typeLabel = item.participantType || "Cố định";
    const level = item.level ?? "-";
    tr.innerHTML = `
      <td class="border border-slate-200 px-2 py-1">${item.memberName || "-"}</td>
      <td class="border border-slate-200 px-2 py-1">${typeLabel}</td>
      <td class="border border-slate-200 px-2 py-1 text-right">${level}</td>
      <td class="border border-slate-200 px-2 py-1">${formatAttendanceStatus(item.status)}</td>
      <td class="border border-slate-200 px-2 py-1">${item.pollAnswer || (pollQuestion ? "-" : "Không có poll")}</td>
      <td class="border border-slate-200 px-2 py-1">${item.respondedAt || "-"}</td>
    `;
    tbody.appendChild(tr);
  });
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

function renderMyHistoryTable(rows = []) {
  const tbody = document.getElementById("myHistoryTableBody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="border border-slate-200 px-2 py-2 text-center text-slate-500">Chưa có dữ liệu.</td></tr>';
    return;
  }
  rows.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="border border-slate-200 px-2 py-1">${item.date || "-"}</td>
      <td class="border border-slate-200 px-2 py-1">${item.time || "-"}</td>
      <td class="border border-slate-200 px-2 py-1">${item.location || "-"}</td>
      <td class="border border-slate-200 px-2 py-1">${formatAttendanceStatus(item.status)}</td>
      <td class="border border-slate-200 px-2 py-1 text-right">${formatMoney(item.totalCost || 0)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderMyPaymentsTable(rows = []) {
  const tbody = document.getElementById("myPaymentsTableBody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="border border-slate-200 px-2 py-2 text-center text-slate-500">Chưa có dữ liệu.</td></tr>';
    return;
  }
  rows.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="border border-slate-200 px-2 py-1">${item.date || "-"}</td>
      <td class="border border-slate-200 px-2 py-1 text-right">${formatMoney(item.amount || 0)}</td>
      <td class="border border-slate-200 px-2 py-1">${item.note || "-"}</td>
      <td class="border border-slate-200 px-2 py-1">${item.createdAt || "-"}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadAdminAttendanceTable() {
  const sessionId = document.getElementById("attendanceSessionSelect")?.value;
  if (!sessionId) {
    renderAdminAttendanceTable([], "");
    setMessage("attendanceMessage", "Chưa có session để xem.");
    return;
  }
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/participants`);
    renderAdminAttendanceTable(data.participants || [], data.pollQuestion || "");
    setMessage("attendanceMessage", `Đã tải danh sách xác nhận cho session ${sessionId}.`);
  } catch (error) {
    renderAdminAttendanceTable([], "");
    setMessage("attendanceMessage", error.message, true);
  }
}

async function loadLoginOptions() {
  const data = await api("/api/login-options");
  state.loginOptions = data.members || [];
  renderLoginOptions();
}

async function loadAdminDashboard() {
  const data = await api("/api/bootstrap");
  state.members = data.members || [];
  renderRoleHeader(data.auth);
  renderMemberLevels(state.members);
  renderSettleFixedMembers(state.members);
  renderSessionSelect(data.sessions || []);
  await loadAdminAttendanceTable();
  document.getElementById("preDateInput").value = new Date().toISOString().slice(0, 10);
  document.getElementById("paymentDateInput").value = new Date().toISOString().slice(0, 10);
}

async function loadUserDashboard() {
  const data = await api("/api/bootstrap");
  renderRoleHeader(data.auth);
  renderUpcoming(data.upcomingSession);
  renderUserDebt(data.myDebt);
  renderMyHistoryTable(data.myHistory || []);
  renderMyPaymentsTable(data.myPayments || []);
}

async function loadDashboard() {
  const data = await api("/api/bootstrap");
  state.auth = data.auth;
  if (data.auth.role === "admin") {
    state.members = data.members || [];
    renderRoleHeader(data.auth);
    renderMemberLevels(state.members);
    renderSettleFixedMembers(state.members);
    renderSessionSelect(data.sessions || []);
    await loadAdminAttendanceTable();
    document.getElementById("preDateInput").value = new Date().toISOString().slice(0, 10);
    document.getElementById("paymentDateInput").value = new Date().toISOString().slice(0, 10);
  } else {
    renderRoleHeader(data.auth);
    renderUpcoming(data.upcomingSession);
    renderUserDebt(data.myDebt);
    renderMyHistoryTable(data.myHistory || []);
    renderMyPaymentsTable(data.myPayments || []);
  }
}

function bindEvents() {
  document.getElementById("loginModeInput").addEventListener("change", toggleLoginMode);

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorEl = document.getElementById("loginError");
    errorEl.classList.add("hidden");
    try {
      const mode = document.getElementById("loginModeInput").value;
      const payload =
        mode === "admin"
          ? { mode, password: document.getElementById("passwordInput").value }
          : {
              mode,
              memberName: document.getElementById("memberSelectInput").value,
              phoneNumber: document.getElementById("phoneInput").value.trim()
            };
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      showAppMode();
      await loadDashboard();
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.classList.remove("hidden");
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    showLoginMode();
  });

  document.getElementById("refreshMembersBtn")?.addEventListener("click", loadAdminDashboard);
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
  document.getElementById("loadAttendanceBtn")?.addEventListener("click", loadAdminAttendanceTable);
  document.getElementById("attendanceSessionSelect")?.addEventListener("change", loadAdminAttendanceTable);
  document.getElementById("addAttendanceGuestForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const sessionId = document.getElementById("attendanceSessionSelect")?.value;
    if (!sessionId) {
      setMessage("attendanceMessage", "Vui lòng chọn session trước khi thêm GL.", true);
      return;
    }
    try {
      await api(`/api/sessions/${encodeURIComponent(sessionId)}/guests`, {
        method: "POST",
        body: JSON.stringify({
          guestName: document.getElementById("attendanceGuestNameInput")?.value?.trim() || "",
          level: Number(document.getElementById("attendanceGuestLevelInput")?.value || 5),
          status: document.getElementById("attendanceGuestStatusInput")?.value || "yes"
        })
      });
      setMessage("attendanceMessage", "Đã thêm/cập nhật GL vào danh sách xác nhận.");
      document.getElementById("attendanceGuestNameInput").value = "";
      document.getElementById("attendanceGuestLevelInput").value = "5";
      document.getElementById("attendanceGuestStatusInput").value = "yes";
      await loadAdminAttendanceTable();
    } catch (error) {
      setMessage("attendanceMessage", error.message, true);
    }
  });
  document.getElementById("addSettleGuestBtn")?.addEventListener("click", () => {
    document.getElementById("settleGuestContainer")?.appendChild(createGuestRow());
  });

  document.getElementById("memberLevelTable").addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("save-level-btn")) return;
    const memberName = target.dataset.name;
    const select = document.querySelector(`select.member-level-input[data-name="${memberName}"]`);
    const level = Number(select?.value || 5);
    try {
      await api("/api/members/level", {
        method: "PATCH",
        body: JSON.stringify({ memberName, level })
      });
      setMessage("preSessionMessage", `Đã cập nhật level cho ${memberName}.`);
      await loadAdminDashboard();
    } catch (error) {
      setMessage("preSessionMessage", error.message, true);
    }
  });

  document.getElementById("preSessionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          date: document.getElementById("preDateInput").value,
          time: document.getElementById("preTimeInput").value,
          location: document.getElementById("preLocationInput").value.trim(),
          note: document.getElementById("preNoteInput").value.trim(),
          pollQuestion: document.getElementById("prePollQuestionInput").value.trim()
        })
      });
      setMessage("preSessionMessage", "Đã tạo buổi vote thành công.");
      await loadAdminDashboard();
    } catch (error) {
      setMessage("preSessionMessage", error.message, true);
    }
  });

  document.getElementById("settleSessionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const fixedMembers = [];
      document.querySelectorAll("#settleFixedMembersContainer label").forEach((label) => {
        const name = label.getAttribute("data-name");
        const checkbox = label.querySelector("input");
        if (!name || !checkbox) return;
        fixedMembers.push({ name, present: checkbox.checked });
      });
      const guests = [];
      document.querySelectorAll("#settleGuestContainer > div").forEach((row) => {
        const name = row.querySelector(".guest-name")?.value?.trim() || "";
        const gender = row.querySelector(".guest-gender")?.value || "Nam";
        if (name) guests.push({ name, gender });
      });

      const sessionId = document.getElementById("settleSessionSelect").value;
      await api(`/api/sessions/${encodeURIComponent(sessionId)}/settle`, {
        method: "POST",
        body: JSON.stringify({
          fixedCourtCost: Number(document.getElementById("fixedCourtCostInput").value || 0),
          extraCourts: Number(document.getElementById("extraCourtsInput").value || 0),
          shuttlecockCost: Number(document.getElementById("shuttlecockCostInput").value || 0),
          fixedMembers,
          guests
        })
      });
      setMessage("settleSessionMessage", "Đã chốt buổi và tính phí thành công.");
      document.getElementById("settleGuestContainer").innerHTML = "";
      await loadAdminDashboard();
    } catch (error) {
      setMessage("settleSessionMessage", error.message, true);
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
      setMessage("matchMessage", "Đã generate xếp trận.");
    } catch (error) {
      renderMatchTables([]);
      setMessage("matchMessage", error.message, true);
    }
  });

  document.getElementById("paymentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          date: document.getElementById("paymentDateInput").value,
          memberName: document.getElementById("paymentMemberInput").value.trim(),
          amount: Number(document.getElementById("paymentAmountInput").value || 0),
          note: document.getElementById("paymentNoteInput").value.trim()
        })
      });
      setMessage("paymentMessage", "Đã lưu thanh toán.");
      document.getElementById("paymentAmountInput").value = "";
      document.getElementById("paymentNoteInput").value = "";
    } catch (error) {
      setMessage("paymentMessage", error.message, true);
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

  document.getElementById("respondForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const pollInput = document.getElementById("pollAnswerInput");
    const sessionId = pollInput.dataset.sessionId;
    if (!sessionId) {
      setMessage("respondMessage", "Chưa có buổi upcoming để phản hồi.", true);
      return;
    }
    try {
      await api(`/api/sessions/${encodeURIComponent(sessionId)}/respond`, {
        method: "POST",
        body: JSON.stringify({
          status: document.getElementById("attendanceInput").value,
          pollAnswer: pollInput.value.trim()
        })
      });
      setMessage("respondMessage", "Đã gửi phản hồi.");
      await loadUserDashboard();
    } catch (error) {
      setMessage("respondMessage", error.message, true);
    }
  });
}

async function init() {
  bindEvents();
  toggleLoginMode();
  try {
    await loadLoginOptions();
    await loadDashboard();
    showAppMode();
  } catch (_error) {
    showLoginMode();
  }
}

init();
