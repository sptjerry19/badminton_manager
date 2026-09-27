const state = {
  role: "",
  memberName: "",
  members: [],
  sessions: [],
  selected: new Set(),
  guests: [],
  loginMode: "admin",
  highlightId: ""
};

const loginView = document.querySelector("#loginView");
const appView = document.querySelector("#appView");
const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");
const memberSelect = document.querySelector("#memberSelect");
const passwordInput = document.querySelector("#passwordInput");
const phoneInput = document.querySelector("#phoneInput");
const adminFields = document.querySelector("#adminFields");
const userFields = document.querySelector("#userFields");
const identity = document.querySelector("#identity");
const formMessage = document.querySelector("#formMessage");
const totalValue = document.querySelector("#totalValue");
const memberFilter = document.querySelector("#memberFilter");
const memberList = document.querySelector("#memberList");
const guestInput = document.querySelector("#guestInput");
const guestList = document.querySelector("#guestList");
const sharePreview = document.querySelector("#sharePreview");
const sessionList = document.querySelector("#sessionList");
const peopleTotals = document.querySelector("#peopleTotals");
const peopleTotalsBody = document.querySelector("#peopleTotalsBody");
const unpaidValue = document.querySelector("#unpaidValue");
const unpaidMeta = document.querySelector("#unpaidMeta");
const viewerNote = document.querySelector("#viewerNote");
const dateInput = document.querySelector("#dateInput");
const courtInput = document.querySelector("#courtInput");
const courtFeeInput = document.querySelector("#courtFeeInput");
const shuttleFeeInput = document.querySelector("#shuttleFeeInput");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value) {
  return `${new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0))}đ`;
}

function parseMoney(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function formatPlayDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return iso || "";
  return `${Number(match[3])}/${Number(match[2])}`;
}

function equalShares(total, count) {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function participants() {
  const members = state.members
    .filter((member) => state.selected.has(member.memberId))
    .map((member) => ({ name: member.name, guest: false }));
  const guests = state.guests.map((name) => ({ name, guest: true }));
  return [...members, ...guests].sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));
}

function fees() {
  return {
    courtFee: parseMoney(courtFeeInput.value),
    shuttleFee: parseMoney(shuttleFeeInput.value)
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Không gọi được máy chủ.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function setNote(node, message, isError) {
  node.hidden = !message;
  node.textContent = message || "";
  node.classList.toggle("is-error", Boolean(isError));
}

function showLogin() {
  loginView.hidden = false;
  appView.hidden = true;
  document.body.dataset.role = "";
}

function showApp() {
  loginView.hidden = true;
  appView.hidden = false;
  document.body.dataset.role = state.role;
  identity.textContent = state.role === "admin" ? "Admin" : state.memberName || "Thành viên";
  viewerNote.hidden = state.role === "admin";
  const notifyCourtBtn = document.querySelector("#notifyCourtBtn");
  if (notifyCourtBtn) notifyCourtBtn.hidden = state.role !== "admin";
  if (state.role !== "admin") showView("ledger");
}

function showView(name) {
  if (name === "entry" && state.role !== "admin") name = "ledger";
  document.querySelectorAll(".screen").forEach((screen) => {
    const active = screen.dataset.screen === name;
    screen.hidden = !active;
    screen.classList.toggle("is-active", active);
  });
  document.querySelectorAll("#viewSwitch button").forEach((button) => {
    button.classList.toggle("is-on", button.dataset.view === name);
  });
}

function paintMoneyInputs() {
  [courtFeeInput, shuttleFeeInput].forEach((input) => {
    const amount = parseMoney(input.value);
    input.value = amount ? new Intl.NumberFormat("vi-VN").format(amount) : "";
  });
}

function paintTotal() {
  const { courtFee, shuttleFee } = fees();
  const next = money(courtFee + shuttleFee);
  if (totalValue.textContent !== next) {
    totalValue.textContent = next;
    totalValue.classList.remove("is-bump");
    void totalValue.offsetWidth;
    totalValue.classList.add("is-bump");
  }
  paintPreview();
}

function paintMembers() {
  const query = memberFilter.value.trim().toLowerCase();
  const visible = state.members.filter((member) => member.name.toLowerCase().includes(query));
  if (!visible.length) {
    memberList.innerHTML = `<p class="empty">Không có thành viên khớp.</p>`;
    paintPreview();
    return;
  }
  memberList.innerHTML = visible
    .map(
      (member) => `
        <button type="button" class="chip${state.selected.has(member.memberId) ? " is-on" : ""}" data-member="${escapeHtml(member.memberId)}">
          ${escapeHtml(member.name)}
        </button>
      `
    )
    .join("");
  paintPreview();
}

function paintGuests() {
  if (!state.guests.length) {
    guestList.innerHTML = "";
    return;
  }
  guestList.innerHTML = state.guests
    .map(
      (name) => `
        <button type="button" class="chip is-guest" data-guest="${escapeHtml(name)}">
          ${escapeHtml(name)} <span class="tag">Giao lưu</span>
        </button>
      `
    )
    .join("");
}

function paintPreview() {
  const people = participants();
  const total = fees().courtFee + fees().shuttleFee;
  if (!people.length || total <= 0) {
    sharePreview.hidden = true;
    sharePreview.innerHTML = "";
    return;
  }
  const shares = equalShares(total, people.length);
  sharePreview.hidden = false;
  sharePreview.innerHTML = people
    .map(
      (person, index) => `
        <li>
          <span>${escapeHtml(person.name)}${person.guest ? '<span class="tag">Giao lưu</span>' : ""}</span>
          <b>${money(shares[index])}</b>
        </li>
      `
    )
    .join("");
}

function unpaidStats() {
  const shares = state.sessions.flatMap((session) => session.shares || []);
  const due = shares.filter((share) => !share.paid);
  return {
    count: due.length,
    amount: due.reduce((sum, share) => sum + share.shareAmount, 0),
    people: shares.length
  };
}

function paintSummary() {
  const stats = unpaidStats();
  unpaidValue.textContent = money(stats.amount);
  if (!state.sessions.length) {
    unpaidMeta.textContent = "Chưa có buổi nào.";
    return;
  }
  unpaidMeta.textContent = stats.count
    ? `${stats.count} lượt chưa thanh toán`
    : "Đã thu đủ mọi lượt trong sổ.";
}

function shareStatusHtml(share) {
  const label = share.paid ? "Đã thanh toán" : "Chưa thanh toán";
  const tone = share.paid ? "is-paid" : "is-due";
  if (state.role !== "admin") {
    return `<span class="badge ${tone}">${label}</span>`;
  }
  return `<button type="button" class="status ${tone}" data-share="${escapeHtml(share.id)}" data-paid="${share.paid ? "true" : "false"}">${label}</button>`;
}

function personGroups() {
  const groups = new Map();
  state.sessions.forEach((session) => {
    (session.shares || []).forEach((share) => {
      const key = share.memberId ? `m:${share.memberId}` : `g:${share.memberName.toLowerCase()}`;
      if (!groups.has(key)) {
        groups.set(key, {
          memberId: share.memberId || "",
          memberName: share.memberName,
          due: 0,
          unpaidCount: 0
        });
      }
      const group = groups.get(key);
      if (!share.paid) {
        group.due += share.shareAmount;
        group.unpaidCount += 1;
      }
    });
  });
  return [...groups.values()].sort(
    (a, b) => b.due - a.due || a.memberName.localeCompare(b.memberName, "vi", { sensitivity: "base" })
  );
}

function renderPeopleTotals() {
  const people = personGroups();
  if (!people.length) {
    peopleTotals.hidden = true;
    peopleTotalsBody.innerHTML = "";
    return;
  }
  peopleTotals.hidden = false;
  peopleTotalsBody.innerHTML = people
    .map((person) => {
      const done = person.due <= 0;
      const action = done
        ? `<span class="badge is-paid">Đã thanh toán</span>`
        : state.role === "admin"
          ? `<button type="button" class="status is-due" data-settle-id="${escapeHtml(person.memberId)}" data-settle-name="${escapeHtml(person.memberName)}">Đã hoàn thành thanh toán</button>`
          : `<span class="badge is-due">${person.unpaidCount} buổi chưa trả</span>`;
      return `
        <tr>
          <td>
            <b>${escapeHtml(person.memberName)}</b>
            ${person.memberId ? "" : '<span class="tag">Giao lưu</span>'}
          </td>
          <td>${money(person.due)}</td>
          <td>${action}</td>
        </tr>
      `;
    })
    .join("");
}

function renderLedger() {
  paintSummary();
  renderPeopleTotals();
  if (!state.sessions.length) {
    sessionList.innerHTML = `<p class="empty">Khi admin lưu một buổi, sổ sẽ hiện theo ngày, sân và từng người.</p>`;
    return;
  }
  sessionList.innerHTML = state.sessions
    .map((session, index) => {
      const shares = session.shares || [];
      return `
        <article class="session bezel${session.id === state.highlightId ? " is-fresh" : ""}" style="animation-delay:${index * 60}ms" data-session="${escapeHtml(session.id)}">
          <div class="core">
            <button type="button" class="session-toggle" aria-expanded="false">
              <span class="session-summary">
                <span class="eyebrow">Ngày ${escapeHtml(formatPlayDate(session.date))}</span>
                <span class="session-title">${escapeHtml(session.court)}</span>
                <span class="meta">
                  <span>Tiền sân <b>${money(session.courtFee)}</b></span>
                  <span>Tiền cầu <b>${money(session.shuttleFee)}</b></span>
                  <span>Tổng <b>${money(session.totalFee)}</b></span>
                </span>
              </span>
              <span class="session-chevron" aria-hidden="true"></span>
            </button>
            <div class="session-detail">
              <div class="session-detail-inner">
                <div class="shares">
                  ${shares
                    .map(
                      (share) => `
                        <div class="share" data-share-row="${escapeHtml(share.id)}">
                          <div class="who">
                            <b>${escapeHtml(share.memberName)}${share.memberId ? "" : '<span class="tag">Giao lưu</span>'}</b>
                            <small>${escapeHtml(formatPlayDate(session.date))} · ${money(share.shareAmount)}</small>
                          </div>
                          ${shareStatusHtml(share)}
                        </div>
                      `
                    )
                    .join("")}
                </div>
                ${
                  state.role === "admin"
                    ? `<div class="session-tools"><button type="button" class="danger" data-delete="${escapeHtml(session.id)}">Xóa buổi</button></div>`
                    : ""
                }
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function applyPayload(data) {
  state.role = data.role || "";
  state.memberName = data.memberName || "";
  state.members = Array.isArray(data.members) ? data.members : [];
  state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
  showApp();
  paintMembers();
  paintGuests();
  renderLedger();
  if (state.role === "user") window.registerPush?.({ prompt: false }).catch(() => {});
}

async function loadLedger() {
  const data = await api("/api/basic");
  applyPayload(data);
}

async function loadLoginOptions() {
  const data = await api("/api/login-options");
  const members = Array.isArray(data.members) ? data.members : [];
  memberSelect.innerHTML = members
    .map((member) => `<option value="${escapeHtml(member.name)}">${escapeHtml(member.name)}</option>`)
    .join("");
}

function setLoginMode(mode) {
  state.loginMode = mode === "user" ? "user" : "admin";
  document.querySelectorAll(".segment-btn").forEach((button) => {
    button.classList.toggle("is-on", button.dataset.mode === state.loginMode);
  });
  const isUser = state.loginMode === "user";
  adminFields.hidden = isUser;
  userFields.hidden = !isUser;
  passwordInput.required = !isUser;
  phoneInput.required = isUser;
}

document.querySelectorAll(".segment-btn").forEach((button) => {
  button.addEventListener("click", () => setLoginMode(button.dataset.mode));
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setNote(loginError, "");
  const submit = loginForm.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const permissionPromise =
      state.loginMode === "user" && window.preparePushPermission ? window.preparePushPermission() : Promise.resolve();
    const body =
      state.loginMode === "admin"
        ? { mode: "admin", password: passwordInput.value }
        : { mode: "user", memberName: memberSelect.value, phoneNumber: phoneInput.value.trim() };
    await api("/api/login", { method: "POST", body });
    await permissionPromise.catch(() => {});
    await loadLedger();
  } catch (error) {
    setNote(loginError, error.message, true);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#notifyCourtBtn")?.addEventListener("click", async () => {
  const button = document.querySelector("#notifyCourtBtn");
  const status = document.querySelector("#notifyStatus");
  button.disabled = true;
  setNote(status, "Đang gửi thông báo...");
  try {
    const data = await api("/api/basic/notify", { method: "POST" });
    const failed = Boolean(data.push && ((!data.push.configured) || (!data.push.sent && data.push.failed)));
    setNote(status, data.message, failed);
  } catch (error) {
    setNote(status, error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logoutBtn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  state.selected.clear();
  state.guests = [];
  showLogin();
});

document.querySelector("#viewSwitch").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  showView(button.dataset.view);
});

[courtFeeInput, shuttleFeeInput].forEach((input) => {
  input.addEventListener("input", () => {
    const end = input.value.length;
    paintMoneyInputs();
    paintTotal();
    input.setSelectionRange(input.value.length, input.value.length);
    void end;
  });
});

memberFilter.addEventListener("input", paintMembers);

memberList.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-member]");
  if (!chip) return;
  const id = chip.dataset.member;
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  paintMembers();
});

function addGuest() {
  const name = guestInput.value.trim().replace(/\s+/g, " ");
  if (!name) return;
  const existing = state.members.find((member) => member.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    state.selected.add(existing.memberId);
    guestInput.value = "";
    setNote(formMessage, `${existing.name} đã có trong danh sách thành viên, nên ô này đã chọn sẵn.`);
    paintMembers();
    return;
  }
  if (state.guests.some((guest) => guest.toLowerCase() === name.toLowerCase())) {
    guestInput.value = "";
    return;
  }
  state.guests.push(name);
  guestInput.value = "";
  setNote(formMessage, "");
  paintGuests();
  paintPreview();
}

guestInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addGuest();
});

document.querySelector("#addGuestBtn").addEventListener("click", addGuest);

guestList.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-guest]");
  if (!chip) return;
  const name = chip.dataset.guest.toLowerCase();
  state.guests = state.guests.filter((guest) => guest.toLowerCase() !== name);
  paintGuests();
  paintPreview();
});

document.querySelector("#sessionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setNote(formMessage, "");
  const { courtFee, shuttleFee } = fees();
  if (courtFee + shuttleFee <= 0) {
    setNote(formMessage, "Tổng tiền phải lớn hơn 0.", true);
    return;
  }
  if (!state.selected.size && !state.guests.length) {
    setNote(formMessage, "Chọn thành viên hoặc thêm người giao lưu.", true);
    return;
  }
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const data = await api("/api/basic/sessions", {
      method: "POST",
      body: {
        date: dateInput.value,
        court: courtInput.value.trim(),
        courtFee,
        shuttleFee,
        memberIds: [...state.selected],
        guestNames: [...state.guests]
      }
    });
    state.highlightId = data.session?.id || "";
    state.selected.clear();
    state.guests = [];
    courtInput.value = "";
    courtFeeInput.value = "";
    shuttleFeeInput.value = "";
    memberFilter.value = "";
    guestInput.value = "";
    paintGuests();
    paintTotal();
    await loadLedger();
    showView("ledger");
    setNote(document.querySelector("#notifyStatus"), data.message || "Đã lưu buổi.", Boolean(data.push && !data.push.sent && data.push.failed));
  } catch (error) {
    setNote(formMessage, error.message, true);
  } finally {
    submit.disabled = false;
  }
});

peopleTotals.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-settle-name]");
  if (!button) return;
  if (button.dataset.armed !== "true") {
    peopleTotalsBody.querySelectorAll("[data-settle-name]").forEach((item) => {
      item.dataset.armed = "false";
      item.classList.remove("is-armed");
      item.textContent = "Đã hoàn thành thanh toán";
    });
    button.dataset.armed = "true";
    button.classList.add("is-armed");
    button.textContent = "Xác nhận hoàn thành";
    return;
  }
  button.disabled = true;
  try {
    const data = await api("/api/basic/people/paid", {
      method: "PATCH",
      body: {
        memberId: button.dataset.settleId || "",
        memberName: button.dataset.settleName || ""
      }
    });
    state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    renderLedger();
  } catch (error) {
    button.disabled = false;
    unpaidMeta.textContent = error.message;
  }
});

sessionList.addEventListener("click", async (event) => {
  const toggle = event.target.closest(".session-toggle");
  if (toggle) {
    const article = toggle.closest(".session");
    const open = article.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    return;
  }

  const status = event.target.closest("[data-share]");
  if (status) {
    const shareId = status.dataset.share;
    const paid = status.dataset.paid !== "true";
    status.disabled = true;
    try {
      const data = await api(`/api/basic/shares/${shareId}`, {
        method: "PATCH",
        body: { paid }
      });
      state.sessions.forEach((session) => {
        const share = (session.shares || []).find((item) => item.id === shareId);
        if (share) Object.assign(share, data.share);
      });
      const row = sessionList.querySelector(`[data-share-row="${shareId}"]`);
      if (row) row.querySelector(".status, .badge").outerHTML = shareStatusHtml(data.share);
      paintSummary();
    } catch (error) {
      status.disabled = false;
      unpaidMeta.textContent = error.message;
    }
    return;
  }

  const remove = event.target.closest("[data-delete]");
  if (!remove) return;
  if (remove.dataset.armed !== "true") {
    sessionList.querySelectorAll("[data-delete]").forEach((button) => {
      button.dataset.armed = "false";
      button.classList.remove("is-armed");
      button.textContent = "Xóa buổi";
    });
    remove.dataset.armed = "true";
    remove.classList.add("is-armed");
    remove.textContent = "Xác nhận xóa";
    return;
  }
  remove.disabled = true;
  try {
    await api(`/api/basic/sessions/${remove.dataset.delete}`, { method: "DELETE" });
    state.sessions = state.sessions.filter((session) => session.id !== remove.dataset.delete);
    renderLedger();
  } catch (error) {
    remove.disabled = false;
    unpaidMeta.textContent = error.message;
  }
});

function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

dateInput.value = localToday();
paintTotal();
setLoginMode("admin");

loadLoginOptions().catch((error) => setNote(loginError, error.message, true));

loadLedger()
  .catch((error) => {
    if (error.status === 401) showLogin();
    else {
      showLogin();
      setNote(loginError, error.message, true);
    }
  });
