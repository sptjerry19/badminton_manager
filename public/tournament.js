const state = {
  authMode: "login",
  role: "",
  memberName: "",
  data: null,
  activePanel: "home",
  standingsEventId: "MD",
  partnerEventId: ""
};

const DEFAULT_LEVEL_LABELS = {
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

const EVENT_NAMES = {
  MD: "Đôi nam",
  XD: "Đôi nam nữ",
  WD: "Đôi nữ"
};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setMsg(id, message, isError) {
  const node = $(id);
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("is-error", Boolean(isError && message));
  node.classList.toggle("is-ok", Boolean(!isError && message));
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

function levelLabel(level) {
  const labels = state.data?.levelLabels || DEFAULT_LEVEL_LABELS;
  return labels[level] || String(level);
}

function fillLevelSelect(select) {
  select.innerHTML = "";
  for (let i = 1; i <= 10; i += 1) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `${i} - ${DEFAULT_LEVEL_LABELS[i]}`;
    if (i === 5) option.selected = true;
    select.appendChild(option);
  }
}

function fillProfileEvents() {
  const box = $("profileEvents");
  box.innerHTML = ["MD", "XD", "WD"]
    .map(
      (id) => `
      <label class="check">
        <input type="checkbox" name="eventId" value="${id}" />
        <span>${EVENT_NAMES[id]}</span>
      </label>`
    )
    .join("");
}

async function loadLoginOptions() {
  const data = await api("/api/tournament/login-options");
  const select = $("memberSelect");
  select.innerHTML = "";
  (data.members || []).forEach((member) => {
    const option = document.createElement("option");
    option.value = member.name;
    option.textContent = member.name;
    select.appendChild(option);
  });
}

function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll("#authModeSegment .segment-btn").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.mode === mode);
  });
  $("loginFields").hidden = mode !== "login";
  $("registerFields").hidden = mode !== "register";
  $("adminFields").hidden = mode !== "admin";
  $("authSubmitLabel").textContent =
    mode === "register" ? "Đăng ký" : mode === "admin" ? "Vào admin" : "Đăng nhập";
  $("memberSelect").required = mode === "login";
  $("loginPhone").required = mode === "login";
}

function showLogin() {
  $("loginView").hidden = false;
  $("appView").hidden = true;
  document.body.dataset.role = "";
}

function showApp() {
  $("loginView").hidden = true;
  $("appView").hidden = false;
  document.body.dataset.role = state.role;
  $("identityTitle").textContent = state.role === "admin" ? "Admin giải đấu" : state.memberName;
}

function openModal(id, open) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.toggle("is-open", open);
  modal.setAttribute("aria-hidden", open ? "false" : "true");
}

function buildTabs() {
  const tabs = $("mainTabs");
  const items =
    state.role === "admin"
      ? [
          ["players", "VĐV"],
          ["rules", "Rule"],
          ["pairs", "Cặp đôi"],
          ["matches", "Trận"],
          ["standings", "BXH"]
        ]
      : [
          ["home", "Của tôi"],
          ["pairs", "Cặp đôi"],
          ["matches", "Trận"],
          ["standings", "BXH"]
        ];
  if (state.role === "admin") state.activePanel = "players";
  else state.activePanel = "home";
  tabs.innerHTML = items
    .map(
      ([id, label]) =>
        `<button type="button" class="tab ${state.activePanel === id ? "is-on" : ""}" data-panel="${id}">${label}</button>`
    )
    .join("");
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("is-on", panel.dataset.panel === state.activePanel);
  });
}

function activatePanel(panelId) {
  state.activePanel = panelId;
  document.querySelectorAll("#mainTabs .tab").forEach((tab) => {
    tab.classList.toggle("is-on", tab.dataset.panel === panelId);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("is-on", panel.dataset.panel === panelId);
  });
}

function renderUserHome() {
  const box = $("userHome");
  if (!box) return;
  const reg = state.data?.registration;
  const events = state.data?.events || [];
  const pairs = state.data?.pairs || [];
  if (!reg?.profileCompleted) {
    box.innerHTML = `<p class="note">Chưa hoàn tất hồ sơ.</p>`;
    return;
  }
  box.innerHTML = (reg.eventIds || [])
    .map((eventId) => {
      const event = events.find((item) => item.eventId === eventId);
      const pair = pairs.find((item) => item.eventId === eventId && ["pending", "locked"].includes(item.status));
      let body = `<p class="muted">Rule tổng level: ${event?.minLevelSum ?? "?"} – ${event?.maxLevelSum ?? "?"}</p>`;
      if (!pair) {
        body += `<button class="btn ok" type="button" data-action="open-partner" data-event="${eventId}">Chọn đồng đội</button>`;
      } else if (pair.status === "pending") {
        const partner =
          pair.memberA.name === state.memberName ? pair.memberB.name : pair.memberA.name;
        const iAmInvitee = pair.invitedBy !== state.data.member?.memberId;
        body += `<p>Đang chờ · ${escapeHtml(partner)} <span class="badge pending">pending</span></p>`;
        if (iAmInvitee) {
          body += `<div class="row">
            <button class="btn ok" data-action="accept-pair" data-pair="${pair.pairId}">Chấp nhận</button>
            <button class="btn danger" data-action="reject-pair" data-pair="${pair.pairId}">Từ chối</button>
          </div>`;
        }
      } else {
        body += `<p>Đã khóa · ${escapeHtml(pair.memberA.name)} / ${escapeHtml(pair.memberB.name)}
          <span class="badge locked">locked</span> · tổng ${pair.levelSum}</p>`;
      }
      return `<article class="card"><div class="card-head"><strong>${EVENT_NAMES[eventId] || eventId}</strong></div>${body}</article>`;
    })
    .join("");
}

function renderPlayers() {
  const body = $("playersBody");
  if (!body) return;
  const players = state.data?.players || [];
  $("registrationOpen").checked = Boolean(state.data?.settings?.registrationOpen);
  $("pairingOpen").checked = Boolean(state.data?.settings?.pairingOpen);
  body.innerHTML = players
    .map((player) => {
      const events = (player.eventIds || []).map((id) => EVENT_NAMES[id] || id).join(", ");
      const pairs = (player.pairs || [])
        .map((pair) => `${EVENT_NAMES[pair.eventId] || pair.eventId}: ${pair.partnerName} (${pair.status})`)
        .join("<br>") || "-";
      return `<tr>
        <td><b>${escapeHtml(player.name)}</b></td>
        <td>${escapeHtml(player.gender || "-")}</td>
        <td>${player.level} · ${escapeHtml(player.levelLabel || levelLabel(player.level))}</td>
        <td>${escapeHtml(player.phoneNumber || "-")}</td>
        <td>${escapeHtml(events || "-")}</td>
        <td>${pairs}</td>
      </tr>`;
    })
    .join("");
}

function renderRules() {
  const box = $("rulesList");
  const events = state.data?.events || [];
  $("pointsToWinInput").value = String(state.data?.settings?.pointsToWin || 21);
  box.innerHTML = events
    .map(
      (event) => `<article class="card grid-2">
        <div>
          <strong>${escapeHtml(event.name)}</strong>
          <p class="muted">${escapeHtml(event.eventId)} · ${escapeHtml(event.genderRule)}</p>
        </div>
        <div class="row">
          <label class="field">
            <span>Min sum</span>
            <input class="rule-min" data-event="${event.eventId}" type="number" min="2" max="20" value="${event.minLevelSum}" />
          </label>
          <label class="field">
            <span>Max sum</span>
            <input class="rule-max" data-event="${event.eventId}" type="number" min="2" max="20" value="${event.maxLevelSum}" />
          </label>
          <button class="btn" type="button" data-action="save-rule" data-event="${event.eventId}">Lưu</button>
        </div>
      </article>`
    )
    .join("");
}

function renderPairs() {
  const box = $("pairsList");
  const pairs = state.data?.pairs || [];
  if (!pairs.length) {
    box.innerHTML = `<p class="note">Chưa có cặp nào.</p>`;
    return;
  }
  box.innerHTML = pairs
    .map((pair) => {
      const adminCancel =
        state.role === "admin" && ["pending", "locked"].includes(pair.status)
          ? `<button class="btn danger" type="button" data-action="cancel-pair" data-pair="${pair.pairId}">Hủy</button>`
          : "";
      return `<article class="card">
        <div class="card-head">
          <div>
            <strong>${EVENT_NAMES[pair.eventId] || pair.eventId}</strong>
            <p>${escapeHtml(pair.memberA.name)} / ${escapeHtml(pair.memberB.name)} · tổng ${pair.levelSum}</p>
          </div>
          <span class="badge ${escapeHtml(pair.status)}">${escapeHtml(pair.status)}</span>
        </div>
        <div class="row">${adminCancel}</div>
      </article>`;
    })
    .join("");
}

function renderMatches() {
  const box = $("matchesList");
  const select = $("generateEventSelect");
  const events = state.data?.events || [];
  if (select) {
    select.innerHTML =
      `<option value="">Tất cả nội dung</option>` +
      events.map((event) => `<option value="${event.eventId}">${event.name}</option>`).join("");
  }
  const matches = state.data?.matches || [];
  if (!matches.length) {
    box.innerHTML = `<p class="note">Chưa có trận. Admin bấm Generate sau khi có đủ cặp khóa.</p>`;
    return;
  }
  box.innerHTML = matches
    .map((match) => {
      const scoreForm =
        state.role === "admin"
          ? `<div class="score-inputs">
              <input type="number" min="0" class="score-a" data-match="${match.matchId}" value="${match.scoreA ?? ""}" />
              <span>-</span>
              <input type="number" min="0" class="score-b" data-match="${match.matchId}" value="${match.scoreB ?? ""}" />
              <button class="btn" type="button" data-action="save-score" data-match="${match.matchId}">Lưu</button>
            </div>`
          : `<p>${match.scoreA ?? "-"} : ${match.scoreB ?? "-"}</p>`;
      return `<article class="card">
        <div class="card-head">
          <div>
            <strong>${EVENT_NAMES[match.eventId] || match.eventId} · R${match.round} #${match.matchNo}</strong>
            <p>${escapeHtml(match.pairALabel)} vs ${escapeHtml(match.pairBLabel)}</p>
          </div>
          <span class="badge ${match.status}">${match.status}</span>
        </div>
        ${scoreForm}
      </article>`;
    })
    .join("");
}

function renderStandings() {
  const tabs = $("standingsTabs");
  const body = $("standingsBody");
  const events = state.data?.events || [];
  if (!events.find((item) => item.eventId === state.standingsEventId)) {
    state.standingsEventId = events[0]?.eventId || "MD";
  }
  tabs.innerHTML = events
    .map(
      (event) =>
        `<button type="button" class="tab ${state.standingsEventId === event.eventId ? "is-on" : ""}" data-standing="${event.eventId}">${event.name}</button>`
    )
    .join("");
  const rows = state.data?.standings?.[state.standingsEventId] || [];
  body.innerHTML = rows.length
    ? rows
        .map(
          (row) => `<tr>
            <td>${row.rank}</td>
            <td><b>${escapeHtml(row.name)}</b></td>
            <td>${row.played}</td>
            <td>${row.wins}</td>
            <td>${row.points}</td>
            <td>${row.pointDiff}</td>
            <td>${row.pointsFor}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="7">Chưa có dữ liệu xếp hạng.</td></tr>`;
}

function renderAll() {
  renderUserHome();
  renderPlayers();
  renderRules();
  renderPairs();
  renderMatches();
  renderStandings();
}

async function refreshBootstrap() {
  const data = await api("/api/tournament/bootstrap");
  state.role = data.role;
  state.memberName = data.memberName || "";
  state.data = data;
  showApp();

  const needProfile = state.role === "user" && !data.registration?.profileCompleted;
  $("profileGate").hidden = !needProfile;
  $("mainApp").hidden = needProfile;
  if (needProfile) {
    $("profileName").value = data.member?.name || state.memberName || "";
    $("profilePhone").value = data.member?.phoneNumber || "";
    $("profileGender").value = data.member?.gender || "";
    $("profileLevel").value = String(data.member?.level || 5);
    return;
  }
  buildTabs();
  renderAll();
}

async function openPartnerModal(eventId) {
  state.partnerEventId = eventId;
  openModal("partnerModal", true);
  $("partnerModalTitle").textContent = `Chọn đồng đội · ${EVENT_NAMES[eventId] || eventId}`;
  setMsg("partnerMessage", "Đang tải ứng viên...");
  $("partnerCandidates").innerHTML = "";
  try {
    const data = await api(`/api/tournament/pairs/candidates?eventId=${encodeURIComponent(eventId)}`);
    const event = (state.data?.events || []).find((item) => item.eventId === eventId);
    $("partnerModalHint").textContent = `Tổng level phải từ ${event?.minLevelSum ?? "?"} đến ${event?.maxLevelSum ?? "?"}.`;
    if (!(data.candidates || []).length) {
      $("partnerCandidates").innerHTML = `<p class="note">Không còn ứng viên phù hợp.</p>`;
      setMsg("partnerMessage", "");
      return;
    }
    $("partnerCandidates").innerHTML = data.candidates
      .map(
        (item) => `<div class="candidate">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <div class="muted">${escapeHtml(item.gender)} · Lv${item.level} ${escapeHtml(item.levelLabel)} · tổng ${item.levelSum}</div>
          </div>
          <button class="btn ok" type="button" data-action="invite" data-member="${escapeHtml(item.memberId)}">Mời</button>
        </div>`
      )
      .join("");
    setMsg("partnerMessage", "");
  } catch (error) {
    setMsg("partnerMessage", error.message, true);
  }
}

function bindEvents() {
  document.querySelectorAll("#authModeSegment .segment-btn").forEach((btn) => {
    btn.addEventListener("click", () => setAuthMode(btn.dataset.mode));
  });

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setMsg("loginError", "");
    try {
      if (state.authMode === "admin") {
        await api("/api/tournament/login", {
          method: "POST",
          body: { mode: "admin", password: $("adminPassword").value }
        });
      } else if (state.authMode === "register") {
        await api("/api/tournament/register", {
          method: "POST",
          body: {
            name: $("registerName").value.trim(),
            phoneNumber: $("registerPhone").value.trim()
          }
        });
      } else {
        await api("/api/tournament/login", {
          method: "POST",
          body: {
            mode: "user",
            memberName: $("memberSelect").value,
            phoneNumber: $("loginPhone").value.trim()
          }
        });
      }
      await refreshBootstrap();
    } catch (error) {
      setMsg("loginError", error.message, true);
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state.data = null;
    showLogin();
    await loadLoginOptions().catch(() => {});
  });

  $("profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const eventIds = [...document.querySelectorAll('#profileEvents input[name="eventId"]:checked')].map(
      (input) => input.value
    );
    try {
      await api("/api/tournament/profile", {
        method: "POST",
        body: {
          name: $("profileName").value.trim(),
          phoneNumber: $("profilePhone").value.trim(),
          gender: $("profileGender").value,
          level: Number($("profileLevel").value),
          eventIds,
          joinSummary: $("profileJoinSummary").checked
        }
      });
      setMsg("profileMessage", "Đã lưu hồ sơ.");
      await refreshBootstrap();
    } catch (error) {
      setMsg("profileMessage", error.message, true);
    }
  });

  $("mainTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-panel]");
    if (!tab) return;
    activatePanel(tab.dataset.panel);
  });

  $("standingsTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-standing]");
    if (!tab) return;
    state.standingsEventId = tab.dataset.standing;
    renderStandings();
  });

  $("userHome").addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    try {
      if (btn.dataset.action === "open-partner") {
        await openPartnerModal(btn.dataset.event);
        return;
      }
      if (btn.dataset.action === "accept-pair" || btn.dataset.action === "reject-pair") {
        await api(`/api/tournament/pairs/${encodeURIComponent(btn.dataset.pair)}/respond`, {
          method: "POST",
          body: { accept: btn.dataset.action === "accept-pair" }
        });
        await refreshBootstrap();
      }
    } catch (error) {
      alert(error.message);
    }
  });

  $("partnerModalClose").addEventListener("click", () => openModal("partnerModal", false));
  $("partnerCandidates").addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-action='invite']");
    if (!btn) return;
    try {
      await api("/api/tournament/pairs/invite", {
        method: "POST",
        body: {
          eventId: state.partnerEventId,
          partnerMemberId: btn.dataset.member
        }
      });
      setMsg("partnerMessage", "Đã gửi lời mời.");
      openModal("partnerModal", false);
      await refreshBootstrap();
    } catch (error) {
      setMsg("partnerMessage", error.message, true);
    }
  });

  $("rulesList").addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-action='save-rule']");
    if (!btn) return;
    const eventId = btn.dataset.event;
    const min = document.querySelector(`.rule-min[data-event="${eventId}"]`)?.value;
    const max = document.querySelector(`.rule-max[data-event="${eventId}"]`)?.value;
    try {
      await api(`/api/tournament/events/${encodeURIComponent(eventId)}/rules`, {
        method: "PATCH",
        body: { minLevelSum: Number(min), maxLevelSum: Number(max) }
      });
      setMsg("rulesMessage", `Đã lưu rule ${EVENT_NAMES[eventId] || eventId}.`);
      await refreshBootstrap();
    } catch (error) {
      setMsg("rulesMessage", error.message, true);
    }
  });

  $("saveSettingsBtn").addEventListener("click", async () => {
    try {
      await api("/api/tournament/settings", {
        method: "PATCH",
        body: {
          pointsToWin: Number($("pointsToWinInput").value || 21),
          registrationOpen: $("registrationOpen").checked,
          pairingOpen: $("pairingOpen").checked
        }
      });
      setMsg("rulesMessage", "Đã lưu settings.");
      await refreshBootstrap();
    } catch (error) {
      setMsg("rulesMessage", error.message, true);
    }
  });

  $("registrationOpen").addEventListener("change", async () => {
    try {
      await api("/api/tournament/settings", {
        method: "PATCH",
        body: { registrationOpen: $("registrationOpen").checked }
      });
      await refreshBootstrap();
    } catch (error) {
      setMsg("playersMessage", error.message, true);
    }
  });

  $("pairingOpen").addEventListener("change", async () => {
    try {
      await api("/api/tournament/settings", {
        method: "PATCH",
        body: { pairingOpen: $("pairingOpen").checked }
      });
      await refreshBootstrap();
    } catch (error) {
      setMsg("playersMessage", error.message, true);
    }
  });

  $("pairsList").addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-action='cancel-pair']");
    if (!btn) return;
    if (!window.confirm("Hủy cặp này?")) return;
    try {
      await api(`/api/tournament/pairs/${encodeURIComponent(btn.dataset.pair)}/cancel`, {
        method: "POST"
      });
      setMsg("pairsMessage", "Đã hủy cặp.");
      await refreshBootstrap();
    } catch (error) {
      setMsg("pairsMessage", error.message, true);
    }
  });

  $("generateMatchesBtn").addEventListener("click", async () => {
    try {
      const data = await api("/api/tournament/matches/generate", {
        method: "POST",
        body: { eventId: $("generateEventSelect").value || "" }
      });
      setMsg("matchesMessage", data.message || "Đã generate.");
      await refreshBootstrap();
    } catch (error) {
      setMsg("matchesMessage", error.message, true);
    }
  });

  $("matchesList").addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-action='save-score']");
    if (!btn) return;
    const matchId = btn.dataset.match;
    const scoreA = document.querySelector(`.score-a[data-match="${matchId}"]`)?.value;
    const scoreB = document.querySelector(`.score-b[data-match="${matchId}"]`)?.value;
    try {
      await api(`/api/tournament/matches/${encodeURIComponent(matchId)}/score`, {
        method: "PATCH",
        body: { scoreA: Number(scoreA), scoreB: Number(scoreB) }
      });
      setMsg("matchesMessage", "Đã lưu tỉ số.");
      await refreshBootstrap();
    } catch (error) {
      setMsg("matchesMessage", error.message, true);
    }
  });
}

async function boot() {
  fillLevelSelect($("profileLevel"));
  fillProfileEvents();
  setAuthMode("login");
  bindEvents();
  await loadLoginOptions().catch(() => {});
  try {
    await refreshBootstrap();
  } catch (error) {
    if (error.status === 401) showLogin();
    else showLogin();
  }
}

boot();
