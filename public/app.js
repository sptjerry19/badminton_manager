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
  guestSessionId: "",
  userBasicBalance: 0,
  notices: [],
  pendingApiCalls: 0
};

const VIETQR = {
  bankBin: "970422",
  accountNo: "011911142003",
  accountName: "PHAM DUY LINH",
  template: "compact2"
};

const LEVEL_LABELS = {
  1: "Newbie",
  2: "Yếu",
  3: "Yếu+",
  4: "TBY",
  5: "TBY+",
  6: "TB-",
  7: "TB",
  8: "TB+",
  9: "TBK",
  10: "Bán chuyên"
};

const WEEKDAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const WEEKDAYS_SHORT = ["CN", "TH 2", "TH 3", "TH 4", "TH 5", "TH 6", "TH 7"];

const { icon, avatar } = window.UI;
const escapeHtmlText = window.UI.esc;
const $ = (id) => document.getElementById(id);

function formatMoney(value) {
  return new Intl.NumberFormat("vi-VN").format(Number(value || 0));
}

function money(value) {
  return `${formatMoney(Math.round(Number(value || 0)))}đ`;
}

function levelLabel(level) {
  const value = Math.round(Number(level));
  return LEVEL_LABELS[value] ? `${value} · ${LEVEL_LABELS[value]}` : "-";
}

function parseIsoDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dateBits(iso) {
  const date = parseIsoDate(iso);
  if (!date) return { day: "--", month: "", weekday: "", weekdayShort: "", short: iso || "" };
  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: String(date.getMonth() + 1),
    weekday: WEEKDAYS[date.getDay()],
    weekdayShort: WEEKDAYS_SHORT[date.getDay()],
    short: `${date.getDate()}/${date.getMonth() + 1}`
  };
}

function givenName(name) {
  const words = String(name || "").trim().split(/\s+/);
  return words[words.length - 1] || "";
}

function buildVietQrUrl(memberName, amount) {
  const safeAmount = Math.max(0, Math.round(Number(amount || 0)));
  const addInfo = encodeURIComponent(`Thu cong no cau long - ${memberName}`);
  const accountName = encodeURIComponent(VIETQR.accountName);
  return `https://img.vietqr.io/image/${VIETQR.bankBin}-${VIETQR.accountNo}-${VIETQR.template}.png?amount=${safeAmount}&addInfo=${addInfo}&accountName=${accountName}`;
}

// ---------- Overlay / toast / loading ----------

function toggleModal(id, isOpen) {
  const modal = $(id);
  if (!modal) return;
  modal.hidden = !isOpen;
}

let toastTimer = null;

function showToast(message, isError = false) {
  const toast = $("toast");
  if (!toast || !message) return;
  $("toastText").textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

let loadingHideTimer = null;

function setLoading(isLoading) {
  toggleModal("loadingModal", isLoading);
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

function setMessage(id, message, isError = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
  el.classList.add("form-note");
  el.classList.toggle("is-error", Boolean(isError));
}

// ---------- Theme ----------

function isDark() {
  return document.documentElement.classList.contains("dark");
}

function paintThemeButtons() {
  document.querySelectorAll(".icon-btn[data-theme-toggle]").forEach((button) => {
    button.innerHTML = icon(isDark() ? "sun" : "moon");
  });
}

function toggleTheme() {
  const dark = !isDark();
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch (_error) {}
  paintThemeButtons();
}

// ---------- Đăng nhập ----------

function showLoginMode() {
  $("loginSection").hidden = false;
  $("appSection").hidden = true;
  state.tournamentMountedFor = "";
  state.activeUserTab = "home";
  ["userTournamentMount", "adminTournamentMount"].forEach((id) => {
    const el = $(id);
    if (el) {
      el.innerHTML = "";
      el.dataset.ready = "0";
    }
  });
}

function showAppMode() {
  $("loginSection").hidden = true;
  $("appSection").hidden = false;
}

function setLoginAuthMode(mode) {
  state.loginAuthMode = mode;
  document.querySelectorAll("#authModeSegment .login-segment-btn").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.mode === mode);
  });
  const memberSelect = $("memberSelectInput");
  const phoneInput = $("phoneInput");
  const registerPhone = $("registerPhone");
  $("loginFields").hidden = mode !== "login";
  $("registerFields").hidden = mode !== "register";
  $("adminFields").hidden = mode !== "admin";
  if (memberSelect) memberSelect.required = mode === "login";
  if (phoneInput) phoneInput.required = mode === "login";
  if (registerPhone) {
    registerPhone.required = mode === "register";
    // Browser đôi khi nhét email vào ô SĐT của form đăng ký.
    if (mode === "register" && String(registerPhone.value || "").includes("@")) {
      registerPhone.value = "";
    }
  }
  $("authSubmitLabel").textContent =
    mode === "register" ? "Đăng ký thành viên" : mode === "admin" ? "Vào trang quản trị" : "Đăng nhập";
  $("loginTitle").textContent =
    mode === "register" ? "Tạo tài khoản" : mode === "admin" ? "Quản trị nhóm" : "Trở lại sân cầu";
  $("loginLead").textContent =
    mode === "admin"
      ? "Nhập mật khẩu quản trị để tiếp tục."
      : mode === "register"
        ? "Điền họ tên và số điện thoại để tham gia nhóm."
        : "Chọn tài khoản và xác nhận số điện thoại.";
}

function renderLoginOptions() {
  const select = $("memberSelectInput");
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
  const isAdmin = auth.role === "admin";
  $("adminSection").hidden = !isAdmin;
  $("userSection").hidden = isAdmin;
  $("accountName").textContent = isAdmin ? "Quản trị viên" : auth.memberName || "Thành viên";
  $("loginIdentity").textContent = isAdmin ? "Bạn đang đăng nhập bằng quyền admin." : `Xin chào ${auth.memberName}.`;
  if (!isAdmin) {
    const userAvatar = $("userAvatar");
    userAvatar.textContent = window.UI.initial(auth.memberName);
    userAvatar.className = `avatar avatar-md avatar-tone-${window.UI.tone(auth.memberName)}`;
    paintUserHeader();
  }
}

function paintUserHeader() {
  const tab = state.activeUserTab;
  const title = $("userHeaderTitle");
  const eyebrow = $("userHeaderEyebrow");
  if (tab === "home") {
    const now = new Date();
    eyebrow.textContent = `${WEEKDAYS[now.getDay()]}, ${now.getDate()} tháng ${now.getMonth() + 1}`.toUpperCase();
    title.textContent = `Xin chào, ${givenName(state.auth?.memberName) || "bạn"}`;
    return;
  }
  eyebrow.textContent = "NHÓM CẦU LÔNG";
  title.textContent = { ranking: "Bảng xếp hạng", tournament: "Giải đấu", notices: "Thông báo" }[tab] || "";
}

// ---------- Thành viên (admin) ----------

function memberRowHtml(member) {
  const level = Math.round(Number(member.level));
  const levelText = LEVEL_LABELS[level] ? `Lv ${level} ${LEVEL_LABELS[level]}` : "";
  const meta = [member.gender, levelText, member.type].filter(Boolean).join(" · ");
  const id = escapeHtmlText(member.memberId);
  return `<div data-member-row="${escapeHtmlText(String(member.name || "").toLowerCase())}">
      ${avatar(member.name)}
      <span title="${escapeHtmlText(member.phoneNumber || "")}"><b>${escapeHtmlText(member.name)}</b><small>${escapeHtmlText(meta)}</small>${member.phoneNumber ? `<small>${escapeHtmlText(member.phoneNumber)}</small>` : ""}</span>
      <span class="badge ${member.active ? "badge-green" : "badge-neutral"}">${member.active ? "Active" : "Nghỉ"}</span>
      <button type="button" class="icon-btn edit-member-btn" data-member-id="${id}" aria-label="Sửa">${icon("edit", 15)}</button>
      <button type="button" class="icon-btn danger delete-member-btn" data-member-id="${id}" aria-label="Xóa">${icon("trash", 15)}</button>
    </div>`;
}

function renderMemberLevels(members) {
  const box = $("memberLevelTable");
  const active = members.filter((member) => member.active).length;
  $("memberCountLabel").textContent = `${active} thành viên hoạt động · ${members.length} tổng`;
  box.innerHTML = members.length
    ? members.map(memberRowHtml).join("")
    : `<p class="hint-line">Chưa có thành viên.</p>`;
  filterMemberRows();
}

function filterMemberRows() {
  const term = String($("memberSearchInput")?.value || "").trim().toLowerCase();
  document.querySelectorAll("#memberLevelTable [data-member-row]").forEach((row) => {
    row.hidden = Boolean(term) && !row.dataset.memberRow.includes(term);
  });
}

function resetMemberModal() {
  $("memberModalTitle").textContent = "Thêm member";
  $("memberModalIdInput").value = "";
  $("memberNameInput").value = "";
  $("memberTypeInput").value = "Cố định";
  $("memberGenderInput").value = "";
  $("memberBirthdayInput").value = "";
  $("memberPhoneInput").value = "";
  $("memberLevelInput").value = "5";
  $("memberActiveInput").checked = true;
  setMessage("memberModalMessage", "");
}

function openMemberModal(member = null) {
  if (!member) {
    resetMemberModal();
  } else {
    $("memberModalTitle").textContent = `Sửa member: ${member.name}`;
    $("memberModalIdInput").value = member.memberId || "";
    $("memberNameInput").value = member.name || "";
    $("memberTypeInput").value = member.type || "GL";
    $("memberGenderInput").value = member.gender || "";
    $("memberBirthdayInput").value = member.birthday || "";
    $("memberPhoneInput").value = member.phoneNumber || "";
    $("memberLevelInput").value = String(member.level ?? 5);
    $("memberActiveInput").checked = Boolean(member.active);
    setMessage("memberModalMessage", "");
  }
  toggleModal("memberModal", true);
}

function renderSessionSelect(sessions) {
  state.sessions = sessions;
  const matchSelect = $("matchSessionSelect");
  if (!matchSelect) return;
  matchSelect.innerHTML = sessions.length
    ? sessions
        .map((session) => {
          const bits = dateBits(session.date);
          const label = `${bits.weekday} ${bits.short} ${session.time || ""} · ${session.location || session.sessionId}`;
          return `<option value="${escapeHtmlText(session.sessionId)}">${escapeHtmlText(label)}</option>`;
        })
        .join("")
    : `<option value="">Chưa có buổi chơi</option>`;
}

// ---------- Vote ----------

function isGuest(member) {
  return Boolean(member?.guest) || String(member?.memberId || "").startsWith("g_");
}

function voteStatusBadge(status) {
  const value = String(status || "open").toLowerCase();
  if (value === "booked") return `<span class="badge badge-green">${icon("check", 13)} Đã đặt sân</span>`;
  if (value === "cancelled") return `<span class="badge badge-neutral">Đã hủy</span>`;
  return `<span class="badge badge-yellow">Đang mở vote</span>`;
}

function voteCounts(session) {
  const members = Array.isArray(session.members) ? session.members : [];
  const yes = members.filter((member) => member.status === "yes");
  const guestsYes = yes.filter(isGuest).length;
  return {
    members,
    yes,
    guestsYes,
    membersYes: yes.length - guestsYes,
    stats: session.stats || { yes: 0, no: 0, pending: 0 }
  };
}

// Popup nhắc phản hồi khi user còn "pending" ở buổi sắp tới.
function renderUpcoming(session) {
  if (!session) {
    state.upcomingSessionId = "";
    toggleModal("attendanceModal", false);
    return;
  }
  state.upcomingSessionId = session.sessionId;
  const bits = dateBits(session.date);
  $("attendanceModalInfo").innerHTML = [
    `<p>${icon("calendar", 17)} ${escapeHtmlText(`${bits.weekday}, ${bits.short}`)} · ${escapeHtmlText(session.time || "")}</p>`,
    session.location ? `<p>${icon("map", 17)} ${escapeHtmlText(session.location)}</p>` : "",
    session.note ? `<p>${icon("sparkle", 17)} ${escapeHtmlText(session.note)}</p>` : ""
  ].join("");
  setMessage("attendanceModalMessage", "");

  const voteStatus = String(session.voteStatus || "open").toLowerCase();
  const myStatus = String(session.myStatus || "pending").toLowerCase();
  const canStillVote = voteStatus === "open" || voteStatus === "booked";
  toggleModal("attendanceModal", canStillVote && myStatus === "pending");
}

function adminMemberChip(session, member, editable) {
  const guest = isGuest(member);
  const cls = `member-chip is-${member.status}${guest ? " guest" : ""}`;
  const inner = `${avatar(member.name, "sm")}${escapeHtmlText(member.name)}${
    guest ? ` <span class="badge badge-guest">GL</span>` : ""
  }${member.status === "yes" ? icon("check", 14) : ""}`;
  if (!editable) return `<span class="${cls}">${inner}</span>`;
  const title = member.status === "yes" ? "Bấm để chuyển sang Không" : "Bấm để chuyển sang Tham gia";
  return `<button type="button" class="${cls}" title="${title}" data-action="${guest ? "toggle-guest" : "toggle-member"}" data-session="${escapeHtmlText(session.sessionId)}" data-member="${escapeHtmlText(member.name)}" data-level="${escapeHtmlText(member.level ?? "")}" data-status="${member.status}">${inner}</button>`;
}

function renderAdminVoteList(sessions) {
  const container = $("voteSessionList");
  if (!container) return;
  state.voteSessions = Array.isArray(sessions) ? sessions : [];
  if (!state.voteSessions.length) {
    container.innerHTML = `<div class="empty-card">Chưa có buổi vote nào. Bấm "Tạo vote mới" để bắt đầu.</div>`;
    return;
  }

  const order = { yes: 0, pending: 1, no: 2 };
  container.innerHTML = state.voteSessions
    .map((session) => {
      const status = String(session.voteStatus || "open").toLowerCase();
      const sid = escapeHtmlText(session.sessionId);
      const active = status !== "cancelled";
      const bits = dateBits(session.date);
      const counts = voteCounts(session);
      const chips = [...counts.members]
        .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, "vi"))
        .map((member) => adminMemberChip(session, member, active))
        .join("");
      const thumb =
        session.bookingImageUrl && status === "booked"
          ? `<button type="button" class="session-thumb" data-action="preview-booking" data-session="${sid}" aria-label="Xem ảnh đặt sân"><img src="${escapeHtmlText(session.bookingImageUrl)}" alt="" /></button>`
          : "";
      const charged = session.basicSessionId ? `<span class="badge badge-blue">Đã tính tiền</span>` : "";
      const actions = active
        ? `<div class="admin-actions">
            <label class="btn btn-ghost upload-btn">
              ${icon("camera")}<span>${status === "booked" ? "Đổi ảnh sân" : "Đã đặt sân"}</span>
              <input type="file" accept="image/*" data-action="book-vote" data-session="${sid}" />
            </label>
            ${status === "open" ? `<button type="button" class="btn btn-danger" data-action="cancel-vote" data-session="${sid}">${icon("close")}<span>Hủy vote</span></button>` : ""}
            <button type="button" class="btn btn-primary" data-action="charge-vote" data-session="${sid}">${icon("arrow")}<span>${session.basicSessionId ? "Tính thêm" : "Tính tiền"}</span></button>
          </div>`
        : "";
      return `<article class="admin-session${active ? "" : " is-muted"}" data-session="${sid}">
        <div class="admin-session-head">
          <div class="date-box"><b>${bits.day}</b><span>THÁNG ${bits.month}</span></div>
          <div>
            <div class="inline-badges">${voteStatusBadge(status)}${charged}</div>
            <h3>${escapeHtmlText(bits.weekday)} · ${escapeHtmlText(session.time || "Chưa có giờ")}</h3>
            <p>${icon("map", 16)} ${escapeHtmlText(session.location || "Chưa có địa điểm")}</p>
            ${session.note ? `<p>${icon("sparkle", 16)} ${escapeHtmlText(session.note)}</p>` : ""}
          </div>
          ${thumb}
        </div>
        <div class="member-count">
          <span><b>${counts.stats.yes || 0}</b> tham gia</span>
          <span>${counts.membersYes} thành viên</span>
          <span>${counts.guestsYes} giao lưu</span>
          <span>${counts.stats.no || 0} không · ${counts.stats.pending || 0} chưa trả lời</span>
        </div>
        <div class="member-chips">
          ${chips || `<span class="hint-line">Chưa có ai trong danh sách.</span>`}
          ${active ? `<button type="button" class="add-chip" data-action="add-guest" data-session="${sid}">${icon("plus", 16)} Thêm giao lưu</button>` : ""}
        </div>
        ${actions}
      </article>`;
    })
    .join("");
}

function renderUserVoteList(sessions) {
  const container = $("userVoteList");
  if (!container) return;
  const list = (Array.isArray(sessions) ? sessions : []).filter(
    (session) => String(session.voteStatus || "open").toLowerCase() !== "cancelled"
  );
  if (!list.length) {
    container.innerHTML = `<div class="empty-card">Chưa có buổi vote nào. Admin tạo lịch là bạn sẽ thấy ở đây.</div>`;
    return;
  }

  container.innerHTML = list
    .map((session) => {
      const status = String(session.voteStatus || "open").toLowerCase();
      const myStatus = String(session.myStatus || "pending").toLowerCase();
      const sid = escapeHtmlText(session.sessionId);
      const bits = dateBits(session.date);
      const counts = voteCounts(session);
      const shown = counts.yes.slice(0, 6);
      const more = counts.yes.length - shown.length;
      const photo = session.bookingImageUrl
        ? `<button type="button" class="session-photo" data-action="preview-booking" data-session="${sid}">
            <img src="${escapeHtmlText(session.bookingImageUrl)}" alt="Ảnh đặt sân" />
            <span>${icon("camera", 16)} Xem ảnh đặt sân</span>
          </button>`
        : "";
      return `<article class="session-card" data-session="${sid}">
        ${photo}
        <div class="session-body">
          <div class="session-head">
            <div class="date-tile-lg"><strong>${bits.weekdayShort}</strong><b>${bits.day}</b><small>THÁNG ${bits.month}</small></div>
            <div class="session-info">
              <div class="session-info-top">
                <h3>${escapeHtmlText(session.time || "Chưa có giờ")}</h3>
                ${voteStatusBadge(status)}
              </div>
              <p>${icon("map", 16)} ${escapeHtmlText(session.location || "Chưa có địa điểm")}</p>
              ${session.note ? `<p class="note">${escapeHtmlText(session.note)}</p>` : ""}
            </div>
          </div>
          <div class="attendance">
            <div class="avatar-stack">
              ${shown.map((member) => avatar(member.name, "sm")).join("")}
              ${more > 0 ? `<span class="more-avatar">+${more}</span>` : ""}
            </div>
            <div>
              <b>${counts.yes.length} tham gia</b>
              <small>${counts.membersYes} thành viên + ${counts.guestsYes} giao lưu</small>
            </div>
          </div>
          <div class="vote-actions">
            <button type="button" class="btn ${myStatus === "yes" ? "btn-primary" : "btn-secondary"}" data-action="user-respond" data-status="yes" data-session="${sid}">${icon("check")}<span>Có tham gia</span></button>
            <button type="button" class="btn btn-ghost${myStatus === "no" ? " is-picked-no" : ""}" data-action="user-respond" data-status="no" data-session="${sid}">${icon("close")}<span>Không</span></button>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

function openBookingImage(session) {
  const image = $("bookingImagePreview");
  if (!image || !session?.bookingImageUrl) return;
  const bits = dateBits(session.date);
  image.src = session.bookingImageUrl;
  $("bookingImageTitle").textContent = session.location || "Ảnh đặt sân";
  $("bookingImageMeta").textContent = `Đã đặt ${session.time || ""}, ${bits.weekday} ${bits.short}`;
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

async function refreshAdminVotes() {
  const data = await api("/api/sessions/votes");
  renderAdminVoteList(data.sessions || []);
}

async function cancelVoteSession(sessionId) {
  if (!window.confirm("Hủy vote sân này? User sẽ không cần phản hồi nữa.")) return;
  const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: "POST" });
  showToast(data.message || "Đã hủy vote.");
  await loadAdminDashboard();
}

async function bookVoteSession(sessionId, file) {
  const imageDataUrl = await readImageAsDataUrl(file);
  const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/book`, {
    method: "POST",
    body: JSON.stringify({ imageDataUrl })
  });
  showToast(data.message || "Đã đánh dấu đặt sân.");
  await loadAdminDashboard();
}

// ---------- Giao lưu trong vote ----------

function knownGuests() {
  const map = new Map();
  state.voteSessions.forEach((session) => {
    (session.members || []).filter(isGuest).forEach((member) => {
      const key = member.name.toLowerCase();
      if (!map.has(key)) map.set(key, { name: member.name, level: member.level, date: session.date });
    });
  });
  return map;
}

function fillLevelSelect(select, value = 5) {
  select.innerHTML = Object.keys(LEVEL_LABELS)
    .map((level) => `<option value="${level}">${escapeHtmlText(levelLabel(level))}</option>`)
    .join("");
  select.value = String(value);
}

function openGuestModal(sessionId) {
  const session = state.voteSessions.find((item) => item.sessionId === sessionId);
  if (!session) return;
  state.guestSessionId = sessionId;
  const bits = dateBits(session.date);
  $("guestModalSession").textContent = `${bits.weekday} ${bits.short} · ${session.time || ""} · ${session.location || ""}`;
  $("guestNameInput").value = "";
  fillLevelSelect($("guestLevelInput"), 5);
  $("guestStatusInput").value = "yes";
  $("guestHint").hidden = true;
  setMessage("guestMessage", "");
  $("guestNameSuggestions").innerHTML = [...knownGuests().values()]
    .map((guest) => `<option value="${escapeHtmlText(guest.name)}"></option>`)
    .join("");
  toggleModal("guestModal", true);
  setTimeout(() => $("guestNameInput").focus(), 50);
}

function paintGuestHint() {
  const name = $("guestNameInput").value.trim().toLowerCase();
  const found = name ? knownGuests().get(name) : null;
  $("guestHint").hidden = !found;
  if (!found) return;
  $("guestHintTitle").textContent = `Tìm thấy ${found.name} trong khách cũ`;
  const level = found.level ? `Level ${levelLabel(found.level)}` : "Chưa rõ level";
  $("guestHintMeta").textContent = `${level} · lần gần nhất ${dateBits(found.date).short}`;
  if (found.level) $("guestLevelInput").value = String(Math.round(found.level));
}

async function submitGuest(event) {
  event.preventDefault();
  const guestName = $("guestNameInput").value.trim().replace(/\s+/g, " ");
  if (!guestName) {
    setMessage("guestMessage", "Nhập tên khách.", true);
    return;
  }
  const session = state.voteSessions.find((item) => item.sessionId === state.guestSessionId);
  const clash = (session?.members || []).find(
    (member) => !isGuest(member) && member.name.toLowerCase() === guestName.toLowerCase()
  );
  if (clash) {
    setMessage("guestMessage", `${clash.name} là thành viên trong nhóm — bấm vào tên trong danh sách để đổi trạng thái.`, true);
    return;
  }
  try {
    await api(`/api/sessions/${encodeURIComponent(state.guestSessionId)}/guests`, {
      method: "POST",
      body: JSON.stringify({
        guestName,
        level: Number($("guestLevelInput").value || 5),
        status: $("guestStatusInput").value
      })
    });
    toggleModal("guestModal", false);
    showToast(`Đã thêm ${guestName} (Giao lưu)`);
    await refreshAdminVotes();
  } catch (error) {
    setMessage("guestMessage", error.message, true);
  }
}

// ---------- Công nợ cá nhân ----------

function summarizeBasicDebt(payload, memberName) {
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const nameCi = String(memberName || "").trim().toLowerCase();
  let lastDate = "";
  const mine = [];
  sessions.forEach((session) => {
    (session.shares || []).forEach((share) => {
      if (String(share.memberName || "").trim().toLowerCase() !== nameCi) return;
      mine.push(share);
      if (!lastDate || String(session.date) > lastDate) lastDate = String(session.date || "");
    });
  });
  const totalDue = mine.reduce((sum, share) => sum + Number(share.shareAmount || 0), 0);
  const totalPaid = mine
    .filter((share) => share.paid)
    .reduce((sum, share) => sum + Number(share.shareAmount || 0), 0);
  return { totalDue, totalPaid, count: mine.length, lastDate };
}

function renderUserDebt(myDebt, creditBalance = 0) {
  const card = $("myDebtCard");
  const actionEl = $("myDebtQrActions");
  if (!card || !actionEl) return;
  const badge = card.querySelector("[data-debt-badge]");
  const amount = card.querySelector("[data-debt-amount]");
  const meta = card.querySelector("[data-debt-meta]");
  const totalDue = Number(myDebt?.totalDue || 0);
  const credit = Math.max(0, Number(creditBalance || 0));
  const totalPaid = Number(myDebt?.totalPaid || 0) + credit;
  const remaining = totalDue - totalPaid;
  state.userBasicBalance = Math.max(0, remaining);

  if ((!myDebt || !myDebt.count) && !credit) {
    badge.className = "badge badge-green";
    badge.textContent = "Không có nợ";
    amount.textContent = "0đ";
    meta.textContent = "Chưa có công nợ trên sổ sân.";
    actionEl.innerHTML = "";
    return;
  }

  const updated = myDebt?.lastDate ? `Cập nhật sau buổi chơi ${dateBits(myDebt.lastDate).short}` : "Cập nhật từ sổ tiền sân";
  meta.textContent = `${updated} · Tổng ${money(totalDue)}, đã trả ${money(totalPaid)}`;
  if (remaining > 0) {
    badge.className = "badge badge-red";
    badge.textContent = "Cần thanh toán";
    amount.textContent = `Đang nợ ${money(remaining)}`;
    actionEl.innerHTML = `<button id="openQrBtn" type="button" class="btn">${icon("qr")}<span>Thanh toán bằng QR</span></button>`;
  } else if (remaining < 0) {
    badge.className = "badge badge-green";
    badge.textContent = "Dư tiền";
    amount.textContent = `Dư ${money(-remaining)}`;
    actionEl.innerHTML = `<p class="balance-ok">Số dư sẽ tự trừ vào các buổi tiếp theo.</p>`;
  } else {
    badge.className = "badge badge-green";
    badge.textContent = "Đã thanh toán";
    amount.textContent = "Không còn nợ";
    actionEl.innerHTML = `<p class="balance-ok">Bạn không có công nợ cần thanh toán.</p>`;
  }
}

function openVoteModal(vote) {
  if (!vote) return;
  state.activeVote = vote;
  $("voteSessionText").textContent = `Phiên: ${vote.date} ${vote.time || ""} ${vote.location ? `- ${vote.location}` : ""}`;
  $("voteQuestionText").textContent = vote.question || "Bạn vui lòng bỏ phiếu.";
  $("voteAnswerInput").value = vote.myAnswer || "";
  setMessage("voteMessage", "");
  toggleModal("voteModal", true);
}

function openQrModal(memberName, balance) {
  const qrUrl = buildVietQrUrl(memberName, balance);
  $("qrReceiver").textContent = VIETQR.accountName;
  $("qrAmount").textContent = money(balance);
  $("qrDebtInfo").textContent = `Thu cong no cau long - ${memberName}`;
  $("qrImage").src = qrUrl;
  $("qrOpenTabLink").href = qrUrl;
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
    toggleModal("attendanceModal", false);
    showToast(status === "yes" ? "Đã ghi nhận: bạn tham gia" : "Đã ghi nhận: bạn không tham gia");
    setMessage("userVoteMessage", "");
    await loadUserDashboard();
  } catch (error) {
    setMessage("attendanceModalMessage", error.message, true);
    setMessage("userVoteMessage", error.message, true);
  }
}

// ---------- Xếp trận ----------

function teamLevel(team) {
  return (team || []).reduce((sum, player) => sum + (Number(player?.level) || 0), 0);
}

function teamBox(team, own, other) {
  const names = (team || []).map((player) => escapeHtmlText(player?.name || "-")).join(" · ") || "-";
  const relation = own === other ? "Cân bằng" : own > other ? "Đội mạnh hơn" : "Đội yếu hơn";
  return `<div class="team-box"><b>${names}</b><small>Tổng level ${own || "-"} · ${relation}</small></div>`;
}

function renderMatchTables(rounds = []) {
  const container = $("matchResultTables");
  if (!container) return;
  if (!rounds.length) {
    container.innerHTML = `<div class="empty-card" style="margin-top:12px">Chưa có dữ liệu trận. Chọn buổi và bấm Generate.</div>`;
    return;
  }
  container.innerHTML = rounds
    .map((roundItem) => {
      const matches = roundItem.matches || [];
      const waiting = roundItem.waiting || [];
      const cards = matches
        .map((match, index) => {
          const a = teamLevel(match.teamA);
          const b = teamLevel(match.teamB);
          return `<article class="match-card">
            <div class="match-top">
              <span><b>Sân ${index + 1}</b> · Trận ${String(index + 1).padStart(2, "0")}</span>
              <span class="badge badge-neutral">Chênh ${match.levelDiff ?? Math.abs(a - b)}</span>
            </div>
            <div class="team-row">${teamBox(match.teamA, a, b)}<span class="vs">VS</span>${teamBox(match.teamB, b, a)}</div>
          </article>`;
        })
        .join("");
      return `<div class="round-head"><span>VÒNG ${roundItem.round}</span><small>${matches.length} trận${waiting.length ? ` · ${waiting.length} người nghỉ` : ""}</small></div>
        ${cards ? `<div class="court-grid">${cards}</div>` : `<div class="empty-card">Không đủ người để xếp trận.</div>`}
        ${waiting.length ? `<div class="waiting">${icon("clock")}<span><b>Ngồi chờ vòng này</b><small>${escapeHtmlText(waiting.join(", "))}</small></span></div>` : ""}`;
    })
    .join("");
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

// ---------- Báo cáo ----------

function renderReportTables(report) {
  $("reportMonthValue").textContent = report?.month || "-";
  $("reportTotalCost").textContent = money(report?.totalMonthlyCost || 0);
  $("reportTotalSessions").textContent = String(report?.totalSessions || 0);

  const empty = (cols) => `<tr><td colspan="${cols}" class="hint-line">Không có dữ liệu.</td></tr>`;
  const attendance = report?.attendanceByMember || [];
  $("reportAttendanceBody").innerHTML = attendance.length
    ? attendance
        .map(
          (item) => `<tr>
            <td>${escapeHtmlText(item.memberName)}</td>
            <td class="num">${item.attendedSessions}</td>
            <td class="num">${item.totalSessions}</td>
            <td class="num">${Math.round(Number(item.attendanceRate || 0) * 100)}%</td>
          </tr>`
        )
        .join("")
    : empty(4);
  const debtors = report?.topDebtors || [];
  $("reportTopDebtorsBody").innerHTML = debtors.length
    ? debtors
        .map(
          (item) =>
            `<tr><td>${escapeHtmlText(item.memberName)}</td><td class="num negative">${money(item.balance)}</td></tr>`
        )
        .join("")
    : empty(2);
  const payers = report?.topPayers || [];
  $("reportTopPayersBody").innerHTML = payers.length
    ? payers
        .map(
          (item) =>
            `<tr><td>${escapeHtmlText(item.memberName)}</td><td class="num positive">${money(item.amount)}</td></tr>`
        )
        .join("")
    : empty(2);
}

// ---------- Giải đấu ----------

async function mountTournamentPanel(role) {
  const mountId = role === "admin" ? "adminTournamentMount" : "userTournamentMount";
  const mount = $(mountId);
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

// ---------- Thông báo ----------

function relativeTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "Vừa xong";
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 172800) return "Hôm qua";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function noticeSeenKey() {
  return `noticeSeenAt:${state.auth?.memberName || "admin"}`;
}

function readNoticeSeen() {
  try {
    return localStorage.getItem(noticeSeenKey()) || "";
  } catch (_error) {
    return "";
  }
}

function markNoticesSeen() {
  const newest = state.notices[0]?.createdAt;
  if (!newest) return;
  try {
    localStorage.setItem(noticeSeenKey(), newest);
  } catch (_error) {}
  const dot = $("userNoticeDot");
  if (dot) dot.hidden = true;
}

function countUnread(notices, seenAt) {
  if (!seenAt) return notices.length;
  return notices.filter((item) => String(item.createdAt || "") > seenAt).length;
}

function renderNoticeList(containerId, notices, seenAt = null) {
  const box = $(containerId);
  if (!box) return;
  const list = Array.isArray(notices) ? notices : [];
  if (!list.length) {
    box.innerHTML = `<div class="empty-card">Chưa có thông báo nào.</div>`;
    return;
  }
  box.innerHTML = list
    .map((item) => {
      const unread = seenAt !== null && (!seenAt || String(item.createdAt || "") > seenAt);
      return `<article class="${unread ? "unread" : ""}">
        <span class="notification-icon">${icon("bell")}</span>
        <div>
          <p>${escapeHtmlText(item.content || "")}</p>
          <small>${escapeHtmlText(relativeTime(item.createdAt))}</small>
        </div>
        ${unread ? "<i></i>" : ""}
      </article>`;
    })
    .join("");
}

async function loadNotices(containerId, options = {}) {
  const data = await api("/api/notices", { loading: options.loading });
  state.notices = data.notices || [];
  if (containerId === "userNoticeList") {
    const seenAt = readNoticeSeen();
    const unread = countUnread(state.notices, seenAt);
    $("userNoticeDot").hidden = !unread;
    $("userNoticeSummary").textContent = unread ? `Bạn có ${unread} thông báo mới` : "Không có thông báo mới";
    $("userNoticeSummaryMeta").textContent = state.notices[0]
      ? `Cập nhật gần nhất ${relativeTime(state.notices[0].createdAt).toLowerCase()}`
      : "Admin gửi thông báo tại đây";
    renderNoticeList(containerId, state.notices, seenAt);
    if (state.activeUserTab === "notices") markNoticesSeen();
    return;
  }
  renderNoticeList(containerId, state.notices);
}

// ---------- Tabs ----------

function activateUserTab(tabId) {
  state.activeUserTab = tabId;
  const defs = {
    home: ["userHomeTabContent", "userTabHomeBtn"],
    ranking: ["userRankingTabContent", "userTabRankingBtn"],
    tournament: ["userTournamentTabContent", "userTabTournamentBtn"],
    notices: ["userNoticeTabContent", "userTabNoticeBtn"]
  };
  Object.entries(defs).forEach(([key, [contentId, btnId]]) => {
    $(contentId).hidden = key !== tabId;
    $(btnId).classList.toggle("active", key === tabId);
  });
  paintUserHeader();
  window.scrollTo({ top: 0 });
  if (tabId === "tournament") {
    mountTournamentPanel("user").catch((error) => {
      const mount = $("userTournamentMount");
      if (mount) mount.innerHTML = `<p class="form-note is-error">${escapeHtmlText(error.message)}</p>`;
    });
  }
  if (tabId === "notices") {
    loadNotices("userNoticeList").catch((error) => {
      const box = $("userNoticeList");
      if (box) box.innerHTML = `<p class="form-note is-error">${escapeHtmlText(error.message)}</p>`;
    });
  }
}

function activateAdminTab(tabId) {
  state.activeAdminTab = tabId;

  const contentDefs = {
    court: "courtTabContent",
    expenses: "expensesTabContent",
    ledger: "ledgerTabContent",
    credit: "creditTabContent",
    ranking: "rankingTabContent",
    tournament: "tournamentTabContent",
    notices: "noticeTabContent",
    tools: "toolsTabContent"
  };
  Object.entries(contentDefs).forEach(([key, contentId]) => {
    const el = $(contentId);
    if (el) el.hidden = key !== tabId;
  });
  document.querySelectorAll("[data-admin-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.adminTab === tabId);
  });
  document.querySelector(`.admin-tabs [data-admin-tab="${tabId}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });

  if (tabId === "credit") loadCreditBoard().catch((error) => setMessage("creditMessage", error.message, true));

  if (tabId === "expenses" || tabId === "ledger") {
    window.BasicLedger.mountEntry($("adminEntryMount"));
    window.BasicLedger.mountLedger($("adminLedgerMount"));
    window.BasicLedger.load().catch((error) => showToast(error.message, true));
  }

  if (tabId === "notices") {
    loadNotices("adminNoticeList").catch((error) => setMessage("noticeMessage", error.message, true));
  }

  if (tabId === "tournament") {
    mountTournamentPanel("admin").catch((error) => {
      const mount = $("adminTournamentMount");
      if (mount) mount.innerHTML = `<p class="form-note is-error">${escapeHtmlText(error.message)}</p>`;
    });
  }
}

// ---------- Tải dữ liệu ----------

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

  const selectedSessionId = $("matchSessionSelect")?.value || "";
  const selectedSession = state.sessions.find((item) => item.sessionId === selectedSessionId);
  if (selectedSession?.date) {
    const matches = await loadMatchesForDate(selectedSession.date);
    renderMatchTables(groupMatchesToRounds(matches));
  } else {
    renderMatchTables([]);
  }
  const dateInput = $("preDateInput");
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
  if (state.activeUserTab !== "notices") loadNotices("userNoticeList", { loading: false }).catch(() => {});
  if (data.activeVote) {
    openVoteModal(data.activeVote);
  }
}

async function loadUserBasicLedger(memberName = "") {
  window.BasicLedger.mountLedger($("userLedgerMount"));
  try {
    const data = await window.BasicLedger.load();
    const name = memberName || state.auth?.memberName || data.memberName || "";
    const mine = (data.members || []).find((item) => item.name.toLowerCase() === name.toLowerCase());
    const credit = (data.credits || []).find((item) => item.memberId === mine?.memberId);
    renderUserDebt(summarizeBasicDebt(data, name), Number(credit?.balance || 0));
  } catch (error) {
    const meta = document.querySelector("#myDebtCard [data-debt-meta]");
    if (meta) meta.textContent = error.message;
  }
}

async function loadDashboard() {
  const data = await api("/api/bootstrap");
  if (data.auth.role === "admin") return loadAdminDashboard();
  return loadUserDashboard();
}

// ---------- Tiền thừa ----------

function fillCreditMembers() {
  const select = $("creditMemberSelect");
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
  $("creditBalanceBody").innerHTML = balances.length
    ? balances
        .map(
          (item) =>
            `<div><span style="display:flex;align-items:center;gap:9px">${avatar(item.memberName, "sm")}<b>${escapeHtmlText(item.memberName)}</b></span><b class="positive">${money(item.balance)}</b></div>`
        )
        .join("")
    : `<div class="empty">Chưa có tiền thừa.</div>`;
  $("creditEntryBody").innerHTML = entries.length
    ? entries
        .map((item) => {
          const sign = item.amount > 0 ? "+" : "";
          return `<div><span><b>${escapeHtmlText(item.memberName)}</b><small>${escapeHtmlText(item.note || "Không ghi chú")}</small></span><b class="${item.amount > 0 ? "positive" : "negative"}">${sign}${money(item.amount)}</b></div>`;
        })
        .join("")
    : `<div class="empty">Chưa có ghi nhận.</div>`;
}

async function loadCreditBoard() {
  fillCreditMembers();
  const data = await api("/api/credits");
  renderCreditBoard(data);
}

// ---------- Sự kiện ----------

function closestOverlay(node) {
  return node.closest(".overlay");
}

function bindChrome() {
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => button.addEventListener("click", toggleTheme));
  document.querySelectorAll("[data-open-account]").forEach((button) =>
    button.addEventListener("click", () => toggleModal("accountModal", true))
  );
  document.querySelectorAll("[data-close-modal]").forEach((button) =>
    button.addEventListener("click", () => {
      const overlay = closestOverlay(button);
      if (overlay) overlay.hidden = true;
    })
  );
  // Bấm ra vùng tối để đóng sheet (trừ loading).
  document.querySelectorAll(".overlay").forEach((overlay) => {
    if (overlay.id === "loadingModal") return;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.hidden = true;
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".overlay:not([hidden])").forEach((overlay) => {
      if (overlay.id !== "loadingModal") overlay.hidden = true;
    });
  });
  document.querySelectorAll("[data-go-user-tab]").forEach((button) =>
    button.addEventListener("click", () => activateUserTab(button.dataset.goUserTab))
  );
}

function bindAuth() {
  document.querySelectorAll("#authModeSegment .login-segment-btn").forEach((btn) => {
    btn.addEventListener("click", () => setLoginAuthMode(btn.dataset.mode));
  });
  setLoginAuthMode("login");

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorEl = $("loginError");
    errorEl.hidden = true;
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
            password: $("passwordInput").value
          })
        });
      } else if (mode === "register") {
        await api("/api/tournament/register", {
          method: "POST",
          body: JSON.stringify({
            name: $("registerName").value.trim(),
            phoneNumber: $("registerPhone").value.trim()
          })
        });
      } else {
        await api("/api/tournament/login", {
          method: "POST",
          body: JSON.stringify({
            mode: "user",
            memberName: $("memberSelectInput").value,
            phoneNumber: $("phoneInput").value.trim()
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
      errorEl.hidden = false;
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    toggleModal("accountModal", false);
    showLoginMode();
  });
}

function bindTabs() {
  document.querySelectorAll("[data-admin-tab]").forEach((button) =>
    button.addEventListener("click", () => activateAdminTab(button.dataset.adminTab))
  );
  $("userTabHomeBtn").addEventListener("click", () => activateUserTab("home"));
  $("userTabRankingBtn").addEventListener("click", () => activateUserTab("ranking"));
  $("userTabTournamentBtn").addEventListener("click", () => activateUserTab("tournament"));
  $("userTabNoticeBtn").addEventListener("click", () => activateUserTab("notices"));
}

function bindNotices() {
  $("noticeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = $("noticeContentInput").value.trim();
    if (!content) {
      setMessage("noticeMessage", "Nội dung không được để trống.", true);
      return;
    }
    try {
      const data = await api("/api/notices", {
        method: "POST",
        body: JSON.stringify({ content })
      });
      $("noticeContentInput").value = "";
      setMessage("noticeMessage", data.message || "Đã gửi thông báo.");
      await loadNotices("adminNoticeList");
    } catch (error) {
      setMessage("noticeMessage", error.message, true);
    }
  });
}

function bindCredits() {
  $("creditAmountInput").addEventListener("input", (event) => {
    const digits = String(event.target.value || "").replace(/[^\d]/g, "");
    event.target.value = digits ? formatMoney(Number(digits)) : "";
  });
  $("creditForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const amount = Number(String($("creditAmountInput").value || "").replace(/[^\d]/g, ""));
    if (!amount) {
      setMessage("creditMessage", "Nhập số tiền lớn hơn 0.", true);
      return;
    }
    try {
      const data = await api("/api/credits", {
        method: "POST",
        body: JSON.stringify({
          memberId: $("creditMemberSelect").value,
          amount,
          direction: $("creditDirectionInput").value || "add",
          note: $("creditNoteInput").value || ""
        })
      });
      $("creditAmountInput").value = "";
      $("creditNoteInput").value = "";
      renderCreditBoard(data);
      setMessage("creditMessage", data.message || "Đã lưu.");
    } catch (error) {
      setMessage("creditMessage", error.message, true);
    }
  });
}

function bindTools() {
  $("migrateSheetsBtn").addEventListener("click", async () => {
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
  $("testPushBtn").addEventListener("click", async () => {
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
  $("syncSheetsBtn").addEventListener("click", async () => {
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

  $("loadReportBtn").addEventListener("click", async () => {
    try {
      const month = $("reportMonthInput").value;
      const data = await api(`/api/reports/monthly?month=${encodeURIComponent(month)}`);
      renderReportTables(data);
      setMessage("reportMessage", "Đã tải báo cáo tháng.");
    } catch (error) {
      setMessage("reportMessage", error.message, true);
    }
  });

  $("downloadCsvBtn").addEventListener("click", () => {
    const month = $("reportMonthInput").value;
    if (!month) return;
    window.open(`/api/reports/monthly?month=${encodeURIComponent(month)}&format=csv`, "_blank");
  });

  $("htmlConvertForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const htmlInput = $("htmlConvertInput")?.value || "";
      const buttonTextCTA1 = $("htmlConvertTextInputCTA1")?.value?.trim() || "";
      const buttonTextCTA2 = $("htmlConvertTextInputCTA2")?.value?.trim() || "";
      const variantId = $("htmlConvertVariantIdInput")?.value?.trim() || "";

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
        return `${comment}\n${replacedCount === 1 ? buttonBlockCTA1 : buttonBlockCTA2}`;
      });

      // Fallback: nếu không có comment CTA thì thay toàn bộ <a class="cta">...</a>
      if (replacedCount === 0) {
        const ctaAnchorPattern = /<a\b[^>]*class=["'][^"']*\bcta\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
        transformedHtml = transformedHtml.replace(ctaAnchorPattern, () => {
          replacedCount += 1;
          return replacedCount === 1 ? buttonBlockCTA1 : buttonBlockCTA2;
        });
      }

      const output = `${transformedHtml.trim()}\n\n${scriptBlock}`;
      $("htmlConvertOutput").value = output;
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
}

function bindMembers() {
  $("refreshMembersBtn").addEventListener("click", loadAdminDashboard);
  $("memberSearchInput").addEventListener("input", filterMemberRows);
  $("openAddMemberBtn").addEventListener("click", () => openMemberModal(null));
  $("memberModalCloseBtn").addEventListener("click", () => toggleModal("memberModal", false));
  $("memberLevelTable").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-member-id]");
    if (!button) return;
    const memberId = String(button.dataset.memberId || "");
    const member = state.members.find((item) => item.memberId === memberId);

    if (button.classList.contains("edit-member-btn")) {
      if (!member) {
        setMessage("memberManageMessage", "Không tìm thấy thông tin member để chỉnh sửa.", true);
        return;
      }
      openMemberModal(member);
      return;
    }

    if (!button.classList.contains("delete-member-btn")) return;
    const memberName = member?.name || memberId;
    if (!window.confirm(`Xóa thành viên "${memberName}"? Thao tác này không hoàn tác.`)) return;
    try {
      await api(`/api/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
      showToast(`Đã xóa member ${memberName}.`);
      await loadAdminDashboard();
    } catch (error) {
      setMessage("memberManageMessage", error.message, true);
    }
  });
  $("memberForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const memberId = $("memberModalIdInput").value.trim();
    const payload = {
      name: $("memberNameInput").value.trim(),
      type: $("memberTypeInput").value,
      gender: $("memberGenderInput").value,
      birthday: $("memberBirthdayInput").value,
      phoneNumber: $("memberPhoneInput").value.trim(),
      level: Number($("memberLevelInput").value || 5),
      active: $("memberActiveInput").checked
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
        showToast(`Đã cập nhật member ${payload.name}.`);
      } else {
        await api("/api/members", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        showToast(`Đã thêm member ${payload.name}.`);
      }
      toggleModal("memberModal", false);
      await loadAdminDashboard();
    } catch (error) {
      setMessage("memberModalMessage", error.message, true);
    }
  });
}

function bindVotes() {
  $("openCreateVoteBtn").addEventListener("click", () => {
    const dateInput = $("preDateInput");
    if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
    toggleModal("createVoteModal", true);
  });

  $("resendSessionPushBtn").addEventListener("click", async () => {
    const button = $("resendSessionPushBtn");
    button.disabled = true;
    try {
      const data = await api("/api/sessions/notify", { method: "POST" });
      const pushFailed = Boolean(data.push && (!data.push.configured || (!data.push.sent && data.push.failed)));
      setMessage("preSessionMessage", data.message, pushFailed);
    } catch (error) {
      setMessage("preSessionMessage", error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("preSessionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          date: $("preDateInput").value,
          time: $("preTimeInput").value,
          location: $("preLocationInput").value.trim(),
          note: $("preNoteInput").value.trim()
        })
      });
      const pushFailed = Boolean(data.push && (!data.push.configured || (!data.push.sent && data.push.failed)));
      toggleModal("createVoteModal", false);
      setMessage("preSessionMessage", data.message || "Đã tạo buổi vote thành công.", pushFailed);
      showToast("Đã tạo buổi vote");
      await loadAdminDashboard();
    } catch (error) {
      setMessage("preSessionMessage", error.message, true);
      toggleModal("createVoteModal", false);
    }
  });

  $("guestNameInput").addEventListener("input", paintGuestHint);
  $("guestForm").addEventListener("submit", submitGuest);

  $("voteSessionList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.tagName === "INPUT") return;
    const action = button.dataset.action;
    const sessionId = String(button.dataset.session || "").trim();
    if (!sessionId) return;
    const session = state.voteSessions.find((item) => item.sessionId === sessionId);

    if (action === "preview-booking") {
      openBookingImage(session);
      return;
    }
    if (action === "cancel-vote") {
      try {
        await cancelVoteSession(sessionId);
      } catch (error) {
        setMessage("voteListMessage", error.message, true);
      }
      return;
    }
    if (action === "add-guest") {
      openGuestModal(sessionId);
      return;
    }
    if (action === "toggle-member" || action === "toggle-guest") {
      const status = button.dataset.status === "yes" ? "no" : "yes";
      button.disabled = true;
      try {
        if (action === "toggle-member") {
          await api(`/api/sessions/${encodeURIComponent(sessionId)}/respond`, {
            method: "POST",
            body: JSON.stringify({ memberName: button.dataset.member, status })
          });
        } else {
          await api(`/api/sessions/${encodeURIComponent(sessionId)}/guests`, {
            method: "POST",
            body: JSON.stringify({
              guestName: button.dataset.member,
              level: Number(button.dataset.level) || 5,
              status
            })
          });
        }
        await refreshAdminVotes();
      } catch (error) {
        button.disabled = false;
        setMessage("voteListMessage", error.message, true);
      }
      return;
    }
    if (action === "charge-vote" && session) {
      const yes = (session.members || []).filter((member) => member.status === "yes");
      activateAdminTab("expenses");
      await window.BasicLedger.load().catch(() => {});
      window.BasicLedger.prefill({
        date: session.date,
        court: session.location,
        memberIds: yes.filter((member) => !isGuest(member)).map((member) => member.memberId),
        guestNames: yes.filter(isGuest).map((member) => member.name),
        voteSessionId: session.sessionId,
        label: `${dateBits(session.date).short} ${session.time || ""}`.trim()
      });
    }
  });

  $("voteSessionList").addEventListener("change", async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
    if (input.dataset.action !== "book-vote") return;
    const sessionId = String(input.dataset.session || "").trim();
    const file = input.files?.[0];
    input.value = "";
    if (!sessionId || !file) return;
    try {
      await bookVoteSession(sessionId, file);
    } catch (error) {
      setMessage("voteListMessage", error.message, true);
    }
  });

  $("userVoteList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const sessionId = String(button.dataset.session || "").trim();
    if (action === "preview-booking" && sessionId) {
      openBookingImage(state.voteSessions.find((item) => item.sessionId === sessionId));
      return;
    }
    if (action === "user-respond" && sessionId) {
      button.disabled = true;
      await submitAttendance(button.dataset.status, sessionId);
      button.disabled = false;
    }
  });
}

function bindMatches() {
  document.querySelectorAll(".stepper [data-step]").forEach((button) =>
    button.addEventListener("click", () => {
      const input = $("roundCountInput");
      const next = Math.min(10, Math.max(1, Number(input.value || 2) + Number(button.dataset.step)));
      input.value = String(next);
    })
  );

  $("generateMatchesBtn").addEventListener("click", async () => {
    const sessionId = $("matchSessionSelect").value;
    const roundCount = Number($("roundCountInput").value || 2);
    if (!sessionId) {
      setMessage("matchMessage", "Chưa có buổi chơi để xếp trận.", true);
      return;
    }
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

  $("matchSessionSelect").addEventListener("change", async () => {
    try {
      const sessionId = $("matchSessionSelect").value;
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
}

function bindUserModals() {
  $("attendanceCloseBtn").addEventListener("click", () => toggleModal("attendanceModal", false));
  $("attendanceYesBtn").addEventListener("click", () => submitAttendance("yes"));
  $("attendanceNoBtn").addEventListener("click", () => submitAttendance("no"));
  $("bookingImageCloseBtn").addEventListener("click", () => {
    toggleModal("bookingImageModal", false);
    $("bookingImagePreview").removeAttribute("src");
  });

  $("myDebtQrActions").addEventListener("click", (event) => {
    if (!event.target.closest("#openQrBtn")) return;
    const amount = Number(state.userBasicBalance || 0);
    if (amount > 0) openQrModal(state.auth?.memberName || "", amount);
  });

  $("qrCloseBtn").addEventListener("click", () => toggleModal("qrModal", false));
  $("voteCloseBtn").addEventListener("click", () => toggleModal("voteModal", false));
  $("voteSkipBtn").addEventListener("click", () => toggleModal("voteModal", false));
  $("voteSubmitBtn").addEventListener("click", async () => {
    if (!state.activeVote?.sessionId) {
      setMessage("voteMessage", "Không có vote đang mở.", true);
      return;
    }
    const answer = $("voteAnswerInput").value.trim();
    if (!answer) {
      setMessage("voteMessage", "Bạn cần nhập câu trả lời trước khi gửi.", true);
      return;
    }
    try {
      await api(`/api/sessions/${encodeURIComponent(state.activeVote.sessionId)}/poll-answer`, {
        method: "POST",
        body: JSON.stringify({ answer })
      });
      toggleModal("voteModal", false);
      showToast("Đã ghi nhận vote.");
      await loadUserDashboard();
    } catch (error) {
      setMessage("voteMessage", error.message, true);
    }
  });
}

function bindEvents() {
  bindChrome();
  bindAuth();
  bindTabs();
  bindNotices();
  bindCredits();
  bindTools();
  bindMembers();
  bindVotes();
  bindMatches();
  bindUserModals();
}

async function init() {
  window.UI.hydrate(document);
  paintThemeButtons();
  bindEvents();
  window.BasicLedger.onChange(async (change) => {
    if (state.auth?.role !== "admin") return;
    if (change.message) showToast(change.message);
    if (change.type !== "saved") return;
    activateAdminTab("ledger");
    const data = await api("/api/sessions/votes").catch(() => null);
    if (data) renderAdminVoteList(data.sessions || []);
  });
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
