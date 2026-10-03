(() => {
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

  const state = {
    root: null,
    role: "",
    memberName: "",
    data: null,
    activePanel: "home",
    standingsEventId: "MD",
    partnerEventId: "",
    catalogView: "list",
    catalogSelectedId: "",
    catalogEditingId: ""
  };

  function qs(sel) {
    return state.root?.querySelector(sel) || null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setMsg(sel, message, isError) {
    const node = qs(sel);
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("is-error", Boolean(isError && message));
    node.classList.toggle("is-ok", Boolean(!isError && message));
  }

  let pendingApiCalls = 0;

  function bumpPanelLoading(delta = 1) {
    if (typeof window.bumpLoading === "function") {
      window.bumpLoading(delta);
      return;
    }
    pendingApiCalls = Math.max(0, pendingApiCalls + Number(delta || 0));
    const modal = document.getElementById("loadingModal");
    if (modal) {
      const show = pendingApiCalls > 0;
      modal.classList.toggle("hidden", !show);
      modal.classList.toggle("flex", show);
      return;
    }
    if (state.root) state.root.classList.toggle("is-loading", pendingApiCalls > 0);
  }

  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    // Loading for writes + explicit loading:true (e.g. bootstrap refresh after save).
    const trackLoading =
      options.loading === true || (options.loading !== false && method !== "GET");
    if (trackLoading) bumpPanelLoading(1);
    try {
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
    } finally {
      if (trackLoading) bumpPanelLoading(-1);
    }
  }

  function levelLabel(level) {
    const labels = state.data?.levelLabels || DEFAULT_LEVEL_LABELS;
    return labels[level] || String(level);
  }

  function fillLevelSelect(select) {
    if (!select) return;
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
    const box = qs("#tpProfileEvents");
    if (!box) return;
    box.innerHTML = ["MD", "XD", "WD"]
      .map(
        (id) => `<label class="tp-event-option">
          <input type="checkbox" name="eventId" value="${id}" />
          <span class="tp-event-option-ui">
            <span class="tp-event-option-mark" aria-hidden="true"></span>
            <span class="tp-event-option-text">${EVENT_NAMES[id]}</span>
          </span>
        </label>`
      )
      .join("");
  }

  function ensureModal() {
    let modal = document.getElementById("tpPartnerModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "tpPartnerModal";
    modal.className = "tp-modal";
    modal.innerHTML = `
      <div class="tp-modal-card" role="dialog" aria-modal="true" aria-labelledby="tpPartnerModalTitle">
        <div class="tp-modal-head">
          <div>
            <p class="tp-modal-eyebrow">Ghép đôi</p>
            <h3 id="tpPartnerModalTitle">Chọn đồng đội</h3>
          </div>
          <button id="tpPartnerModalClose" class="tp-modal-close" type="button" aria-label="Đóng">×</button>
        </div>
        <div id="tpPartnerModalHint" class="tp-modal-hint"></div>
        <div id="tpPartnerCandidates" class="tp-candidate-list"></div>
        <p id="tpPartnerMessage" class="tp-msg"></p>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector("#tpPartnerModalClose").addEventListener("click", () => {
      modal.classList.remove("is-open");
    });
    modal.querySelector("#tpPartnerCandidates").addEventListener("click", async (event) => {
      const btn = event.target.closest("[data-action='invite']");
      if (!btn) return;
      try {
        await api("/api/tournament/pairs/invite", {
          method: "POST",
          body: { eventId: state.partnerEventId, partnerMemberId: btn.dataset.member }
        });
        modal.classList.remove("is-open");
        await refresh();
      } catch (error) {
        const msg = modal.querySelector("#tpPartnerMessage");
        msg.textContent = error.message;
        msg.classList.add("is-error");
      }
    });
    return modal;
  }

  function template() {
    return `
      <div class="tp-root" data-role="">
        <section id="tpCatalogSection" class="tp-card tp-catalog">
          <div id="tpCatalogListView">
            <div class="tp-row" style="justify-content:space-between;align-items:flex-start">
              <div>
                <h3>Danh sách giải đấu</h3>
                <p id="tpActiveTournamentNote" class="tp-note"></p>
              </div>
              <button id="tpCreateTournamentBtn" class="tp-btn admin-only" type="button" data-action="catalog-create">+ Tạo giải</button>
            </div>
            <div id="tpCatalogList" class="tp-stack"></div>
            <p id="tpCatalogMessage" class="tp-msg"></p>
          </div>

          <div id="tpCatalogDetailView" hidden>
            <div class="tp-row" style="justify-content:space-between">
              <button type="button" class="tp-btn tp-ghost" data-action="catalog-back">← Quay lại</button>
              <div class="tp-row admin-only" id="tpCatalogDetailActions"></div>
            </div>
            <div class="tp-catalog-detail-head">
              <h3 id="tpCatalogDetailTitle"></h3>
              <p id="tpCatalogDetailMeta" class="tp-note"></p>
            </div>
            <div id="tpCatalogDetailHtml" class="tp-catalog-html"></div>
          </div>

          <div id="tpCatalogFormView" class="admin-only" hidden>
            <div class="tp-row" style="justify-content:space-between">
              <h3 id="tpCatalogFormTitle">Tạo giải đấu</h3>
              <button type="button" class="tp-btn tp-ghost" data-action="catalog-back">Hủy</button>
            </div>
            <form id="tpCatalogForm" class="tp-stack">
              <input type="hidden" id="tpCatalogFormId" value="" />
              <label class="tp-field">
                <span>Tên giải</span>
                <input id="tpCatalogName" class="tp-control" required />
              </label>
              <label class="tp-field">
                <span>Địa điểm</span>
                <input id="tpCatalogLocation" class="tp-control" />
              </label>
              <label class="tp-field">
                <span>Nội dung / giải thưởng (HTML)</span>
                <textarea id="tpCatalogContent" class="tp-control tp-textarea" rows="10" placeholder="<h3>Nội dung</h3><p>Giải thưởng...</p>"></textarea>
              </label>
              <button class="tp-btn" type="submit">Lưu giải</button>
              <p id="tpCatalogFormMessage" class="tp-msg"></p>
            </form>
          </div>
        </section>

        <div id="tpProfileGate" class="tp-card tp-profile" hidden>
          <div class="tp-profile-head">
            <h3>Đăng ký hồ sơ giải đấu</h3>
            <p class="tp-note">Điền thông tin và chọn đúng 2/3 nội dung để tham dự.</p>
          </div>
          <form id="tpProfileForm" class="tp-profile-form">
            <div class="tp-grid">
              <label class="tp-field">
                <span>Họ tên</span>
                <input id="tpProfileName" class="tp-control" required />
              </label>
              <label class="tp-field">
                <span>Số điện thoại</span>
                <input id="tpProfilePhone" class="tp-control" type="tel" inputmode="numeric" autocomplete="tel-national" required />
              </label>
              <label class="tp-field">
                <span>Giới tính</span>
                <span class="tp-select-wrap">
                  <select id="tpProfileGender" class="tp-control" required>
                    <option value="">Chọn</option>
                    <option value="Nam">Nam</option>
                    <option value="Nữ">Nữ</option>
                  </select>
                </span>
              </label>
              <label class="tp-field">
                <span>Trình độ</span>
                <span class="tp-select-wrap">
                  <select id="tpProfileLevel" class="tp-control" required></select>
                </span>
              </label>
            </div>
            <div class="tp-field tp-events-field">
              <span>Nội dung <em>(chọn 2)</em></span>
              <div id="tpProfileEvents" class="tp-event-options"></div>
            </div>
            <label class="tp-confirm">
              <input id="tpProfileJoinSummary" type="checkbox" required />
              <span>Xác nhận tham gia tổng kết sau giải đấu</span>
            </label>
            <button class="tp-btn tp-btn-block" type="submit">Lưu hồ sơ giải</button>
            <p id="tpProfileMessage" class="tp-msg"></p>
          </form>
        </div>

        <div id="tpMainApp" hidden>
          <div id="tpMainTabs" class="tp-tabs"></div>

          <section class="tp-panel tp-card" data-panel="home">
            <h3>Nội dung của bạn</h3>
            <div id="tpUserHome" class="tp-stack"></div>
          </section>

          <section class="tp-panel tp-card admin-only" data-panel="players" hidden>
            <div class="tp-row" style="justify-content:space-between">
              <h3>VĐV đăng ký</h3>
              <div class="tp-row">
                <label class="tp-check"><input id="tpRegistrationOpen" type="checkbox" /><span>Mở đăng ký</span></label>
                <label class="tp-check"><input id="tpPairingOpen" type="checkbox" /><span>Mở ghép đôi</span></label>
              </div>
            </div>
            <div class="tp-table-wrap"><table><thead><tr>
              <th>Tên</th><th>GT</th><th>Level</th><th>SĐT</th><th>Nội dung</th><th>Cặp</th><th>Status</th><th></th>
            </tr></thead><tbody id="tpPlayersBody"></tbody></table></div>
            <p id="tpPlayersMessage" class="tp-msg"></p>
          </section>

          <section class="tp-panel tp-card admin-only" data-panel="rules" hidden>
            <h3>Rule tổng level</h3>
            <p class="tp-note">minSum ≤ levelA + levelB ≤ maxSum</p>
            <div id="tpRulesList" class="tp-stack"></div>
            <label class="tp-field" style="max-width:200px"><span>Điểm thắng tối thiểu</span>
              <input id="tpPointsToWinInput" type="number" min="1" value="21" />
            </label>
            <button id="tpSaveSettingsBtn" class="tp-btn" type="button">Lưu settings</button>
            <p id="tpRulesMessage" class="tp-msg"></p>
          </section>

          <section class="tp-panel tp-card" data-panel="pairs" hidden>
            <h3>Cặp đôi</h3>
            <div id="tpPairsList" class="tp-stack"></div>
            <p id="tpPairsMessage" class="tp-msg"></p>
          </section>

          <section class="tp-panel tp-card" data-panel="matches" hidden>
            <div class="tp-row" style="justify-content:space-between">
              <h3>Trận đấu</h3>
              <div class="tp-row admin-only">
                <select id="tpGenerateEventSelect"></select>
                <button id="tpGenerateMatchesBtn" class="tp-btn" type="button">Generate vòng tròn</button>
              </div>
            </div>
            <div id="tpMatchesList" class="tp-stack"></div>
            <p id="tpMatchesMessage" class="tp-msg"></p>
          </section>

          <section class="tp-panel tp-card" data-panel="standings" hidden>
            <h3>Bảng xếp hạng</h3>
            <div id="tpStandingsTabs" class="tp-tabs"></div>
            <div class="tp-table-wrap"><table><thead><tr>
              <th>#</th><th>Tên</th><th>Trận</th><th>Thắng</th><th>Điểm</th><th>Hiệu số</th><th>Điểm ghi</th>
            </tr></thead><tbody id="tpStandingsBody"></tbody></table></div>
          </section>
        </div>
      </div>`;
  }

  function buildTabs() {
    const tabs = qs("#tpMainTabs");
    if (!tabs) return;
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
    state.activePanel = state.role === "admin" ? "players" : "home";
    tabs.innerHTML = items
      .map(
        ([id, label]) =>
          `<button type="button" class="tp-tab ${state.activePanel === id ? "is-on" : ""}" data-panel="${id}">${label}</button>`
      )
      .join("");
    activatePanel(state.activePanel);
  }

  function activatePanel(panelId) {
    state.activePanel = panelId;
    state.root?.querySelectorAll("#tpMainTabs .tp-tab").forEach((tab) => {
      tab.classList.toggle("is-on", tab.dataset.panel === panelId);
    });
    state.root?.querySelectorAll(".tp-panel").forEach((panel) => {
      const on = panel.dataset.panel === panelId;
      panel.hidden = !on;
      panel.classList.toggle("is-on", on);
    });
  }

  function registrationStatusLabel(status) {
    if (status === "approved") return "Đã duyệt";
    if (status === "blocked") return "Từ chối";
    return "Chờ duyệt";
  }

  function renderUserHome() {
    const box = qs("#tpUserHome");
    if (!box) return;
    const reg = state.data?.registration;
    const events = state.data?.events || [];
    const pairs = state.data?.pairs || [];
    if (!reg?.profileCompleted) {
      box.innerHTML = `<p class="tp-note">Chưa hoàn tất hồ sơ giải.</p>`;
      return;
    }
    const status = reg.status || "pending";
    const statusBanner =
      status === "approved"
        ? `<p class="tp-banner is-ok">Hồ sơ đã được duyệt · bạn có thể chọn đồng đội.</p>`
        : status === "blocked"
          ? `<p class="tp-banner is-error">Hồ sơ bị từ chối tham dự. Liên hệ admin nếu cần.</p>`
          : `<p class="tp-banner is-wait">Hồ sơ đang chờ admin duyệt.</p>`;
    const canPair = status === "approved";
    box.innerHTML =
      statusBanner +
      (reg.eventIds || [])
        .map((eventId) => {
          const event = events.find((item) => item.eventId === eventId);
          const pair = pairs.find(
            (item) => item.eventId === eventId && ["pending", "locked"].includes(item.status)
          );
          let body = `<p class="tp-muted">Rule tổng level: ${event?.minLevelSum ?? "?"} – ${event?.maxLevelSum ?? "?"}</p>`;
          if (!canPair) {
            body += `<p class="tp-muted">Chưa thể ghép đôi khi hồ sơ chưa được duyệt.</p>`;
          } else if (!pair) {
            body += `<button class="tp-btn tp-ok" type="button" data-action="open-partner" data-event="${eventId}">Chọn đồng đội</button>`;
          } else if (pair.status === "pending") {
            const partner =
              pair.memberA.name === state.memberName ? pair.memberB.name : pair.memberA.name;
            const iAmInvitee = pair.invitedBy !== state.data.member?.memberId;
            body += `<p>Đang chờ · ${escapeHtml(partner)} <span class="tp-badge pending">pending</span></p>`;
            if (iAmInvitee) {
              body += `<div class="tp-row">
                <button class="tp-btn tp-ok" data-action="accept-pair" data-pair="${pair.pairId}">Chấp nhận</button>
                <button class="tp-btn tp-danger" data-action="reject-pair" data-pair="${pair.pairId}">Từ chối</button>
              </div>`;
            }
          } else {
            body += `<p>Đã khóa · ${escapeHtml(pair.memberA.name)} / ${escapeHtml(pair.memberB.name)}
              <span class="tp-badge locked">locked</span> · tổng ${pair.levelSum}</p>`;
          }
          return `<article class="tp-subcard"><strong>${EVENT_NAMES[eventId] || eventId}</strong>${body}</article>`;
        })
        .join("");
  }

  function renderPlayers() {
    const body = qs("#tpPlayersBody");
    if (!body) return;
    const regOpen = qs("#tpRegistrationOpen");
    const pairOpen = qs("#tpPairingOpen");
    if (regOpen) regOpen.checked = Boolean(state.data?.settings?.registrationOpen);
    if (pairOpen) pairOpen.checked = Boolean(state.data?.settings?.pairingOpen);
    body.innerHTML = (state.data?.players || [])
      .map((player) => {
        const events = (player.eventIds || []).map((id) => EVENT_NAMES[id] || id).join(", ");
        const pairs =
          (player.pairs || [])
            .map(
              (pair) =>
                `${EVENT_NAMES[pair.eventId] || pair.eventId}: ${pair.partnerName} (${pair.status})`
            )
            .join("<br>") || "-";
        const status = player.status || "pending";
        const actions = [
          status !== "approved"
            ? `<button class="tp-btn tp-ok tp-btn-sm" type="button" data-action="approve-player" data-member="${escapeHtml(player.memberId)}">Duyệt</button>`
            : "",
          status !== "blocked"
            ? `<button class="tp-btn tp-ghost tp-btn-sm" type="button" data-action="block-player" data-member="${escapeHtml(player.memberId)}">Từ chối</button>`
            : "",
          `<button class="tp-btn tp-danger tp-btn-sm" type="button" data-action="remove-player" data-member="${escapeHtml(player.memberId)}">Xóa</button>`
        ]
          .filter(Boolean)
          .join("");
        return `<tr>
          <td><b>${escapeHtml(player.name)}</b></td>
          <td>${escapeHtml(player.gender || "-")}</td>
          <td>${player.level} · ${escapeHtml(player.levelLabel || levelLabel(player.level))}</td>
          <td>${escapeHtml(player.phoneNumber || "-")}</td>
          <td>${escapeHtml(events || "-")}</td>
          <td>${pairs}</td>
          <td><span class="tp-badge ${escapeHtml(status)}">${escapeHtml(registrationStatusLabel(status))}</span></td>
          <td><div class="tp-row tp-actions">${actions}</div></td>
        </tr>`;
      })
      .join("");
  }

  function renderRules() {
    const box = qs("#tpRulesList");
    const points = qs("#tpPointsToWinInput");
    if (points) points.value = String(state.data?.settings?.pointsToWin || 21);
    if (!box) return;
    box.innerHTML = (state.data?.events || [])
      .map(
        (event) => `<article class="tp-subcard tp-grid">
          <div><strong>${escapeHtml(event.name)}</strong><p class="tp-muted">${escapeHtml(event.eventId)} · ${escapeHtml(event.genderRule)}</p></div>
          <div class="tp-row">
            <label class="tp-field"><span>Min</span><input class="rule-min" data-event="${event.eventId}" type="number" min="2" max="20" value="${event.minLevelSum}" /></label>
            <label class="tp-field"><span>Max</span><input class="rule-max" data-event="${event.eventId}" type="number" min="2" max="20" value="${event.maxLevelSum}" /></label>
            <button class="tp-btn" type="button" data-action="save-rule" data-event="${event.eventId}">Lưu</button>
          </div>
        </article>`
      )
      .join("");
  }

  function renderPairs() {
    const box = qs("#tpPairsList");
    if (!box) return;
    const pairs = state.data?.pairs || [];
    if (!pairs.length) {
      box.innerHTML = `<p class="tp-note">Chưa có cặp nào.</p>`;
      return;
    }
    box.innerHTML = pairs
      .map((pair) => {
        const adminCancel =
          state.role === "admin" && ["pending", "locked"].includes(pair.status)
            ? `<button class="tp-btn tp-danger" type="button" data-action="cancel-pair" data-pair="${pair.pairId}">Hủy</button>`
            : "";
        return `<article class="tp-subcard">
          <div class="tp-row" style="justify-content:space-between">
            <div>
              <strong>${EVENT_NAMES[pair.eventId] || pair.eventId}</strong>
              <p>${escapeHtml(pair.memberA.name)} / ${escapeHtml(pair.memberB.name)} · tổng ${pair.levelSum}</p>
            </div>
            <span class="tp-badge ${escapeHtml(pair.status)}">${escapeHtml(pair.status)}</span>
          </div>
          <div class="tp-row">${adminCancel}</div>
        </article>`;
      })
      .join("");
  }

  function renderMatches() {
    const box = qs("#tpMatchesList");
    const select = qs("#tpGenerateEventSelect");
    const events = state.data?.events || [];
    if (select) {
      select.innerHTML =
        `<option value="">Tất cả nội dung</option>` +
        events.map((event) => `<option value="${event.eventId}">${event.name}</option>`).join("");
    }
    if (!box) return;
    const matches = state.data?.matches || [];
    if (!matches.length) {
      box.innerHTML = `<p class="tp-note">Chưa có trận.</p>`;
      return;
    }
    box.innerHTML = matches
      .map((match) => {
        const scoreForm =
          state.role === "admin"
            ? `<div class="tp-score">
                <input type="number" min="0" class="score-a" data-match="${match.matchId}" value="${match.scoreA ?? ""}" />
                <span>-</span>
                <input type="number" min="0" class="score-b" data-match="${match.matchId}" value="${match.scoreB ?? ""}" />
                <button class="tp-btn" type="button" data-action="save-score" data-match="${match.matchId}">Lưu</button>
              </div>`
            : `<p>${match.scoreA ?? "-"} : ${match.scoreB ?? "-"}</p>`;
        return `<article class="tp-subcard">
          <div class="tp-row" style="justify-content:space-between">
            <div>
              <strong>${EVENT_NAMES[match.eventId] || match.eventId} · R${match.round} #${match.matchNo}</strong>
              <p>${escapeHtml(match.pairALabel)} vs ${escapeHtml(match.pairBLabel)}</p>
            </div>
            <span class="tp-badge ${match.status}">${match.status}</span>
          </div>
          ${scoreForm}
        </article>`;
      })
      .join("");
  }

  function renderStandings() {
    const tabs = qs("#tpStandingsTabs");
    const body = qs("#tpStandingsBody");
    const events = state.data?.events || [];
    if (!events.find((item) => item.eventId === state.standingsEventId)) {
      state.standingsEventId = events[0]?.eventId || "MD";
    }
    if (tabs) {
      tabs.innerHTML = events
        .map(
          (event) =>
            `<button type="button" class="tp-tab ${state.standingsEventId === event.eventId ? "is-on" : ""}" data-standing="${event.eventId}">${event.name}</button>`
        )
        .join("");
    }
    if (!body) return;
    const rows = state.data?.standings?.[state.standingsEventId] || [];
    body.innerHTML = rows.length
      ? rows
          .map(
            (row) => `<tr>
              <td>${row.rank}</td><td><b>${escapeHtml(row.name)}</b></td><td>${row.played}</td>
              <td>${row.wins}</td><td>${row.points}</td><td>${row.pointDiff}</td><td>${row.pointsFor}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="7">Chưa có dữ liệu xếp hạng.</td></tr>`;
  }

  function setCatalogView(view) {
    state.catalogView = view;
    const listView = qs("#tpCatalogListView");
    const detailView = qs("#tpCatalogDetailView");
    const formView = qs("#tpCatalogFormView");
    if (listView) listView.hidden = view !== "list";
    if (detailView) detailView.hidden = view !== "detail";
    if (formView) formView.hidden = view !== "form";
  }

  function renderCatalogList() {
    const list = qs("#tpCatalogList");
    const note = qs("#tpActiveTournamentNote");
    if (!list) return;
    const items = state.data?.catalog || [];
    const active = state.data?.activeTournament || null;
    if (note) {
      note.textContent = active
        ? `Đang diễn ra: ${active.name}${active.location ? ` · ${active.location}` : ""}`
        : "Chưa chọn giải đang diễn ra.";
    }
    if (!items.length) {
      list.innerHTML = `<p class="tp-note">Chưa có giải đấu nào.</p>`;
      return;
    }
    list.innerHTML = items
      .map((item) => {
        const badge = item.isActive
          ? `<span class="tp-badge locked">Đang diễn ra</span>`
          : "";
        const adminActions =
          state.role === "admin"
            ? `<div class="tp-row">
                ${
                  item.isActive
                    ? ""
                    : `<button class="tp-btn tp-btn-sm tp-ok" type="button" data-action="catalog-activate" data-id="${escapeHtml(item.tournamentId)}">Đặt active</button>`
                }
                <button class="tp-btn tp-btn-sm" type="button" data-action="catalog-edit" data-id="${escapeHtml(item.tournamentId)}">Sửa</button>
                <button class="tp-btn tp-btn-sm tp-danger" type="button" data-action="catalog-delete" data-id="${escapeHtml(item.tournamentId)}">Xóa</button>
              </div>`
            : "";
        return `<article class="tp-subcard tp-catalog-item">
          <div class="tp-row" style="justify-content:space-between;align-items:flex-start">
            <div>
              <strong>${escapeHtml(item.name)}</strong> ${badge}
              <p class="tp-muted">${escapeHtml(item.location || "Chưa có địa điểm")}</p>
            </div>
            <div class="tp-row">
              <button class="tp-btn tp-btn-sm" type="button" data-action="catalog-view" data-id="${escapeHtml(item.tournamentId)}">Xem</button>
              ${adminActions}
            </div>
          </div>
        </article>`;
      })
      .join("");
  }

  function renderCatalogDetail() {
    const items = state.data?.catalog || [];
    const item = items.find((row) => row.tournamentId === state.catalogSelectedId);
    if (!item) {
      setCatalogView("list");
      return;
    }
    const title = qs("#tpCatalogDetailTitle");
    const meta = qs("#tpCatalogDetailMeta");
    const html = qs("#tpCatalogDetailHtml");
    const actions = qs("#tpCatalogDetailActions");
    if (title) title.textContent = item.name;
    if (meta) {
      meta.textContent = [
        item.location || "Chưa có địa điểm",
        item.isActive ? "Đang diễn ra" : ""
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (html) html.innerHTML = item.contentHtml || "<p class='tp-note'>Chưa có nội dung.</p>";
    if (actions) {
      actions.innerHTML = `
        ${
          item.isActive
            ? ""
            : `<button class="tp-btn tp-btn-sm tp-ok" type="button" data-action="catalog-activate" data-id="${escapeHtml(item.tournamentId)}">Đặt active</button>`
        }
        <button class="tp-btn tp-btn-sm" type="button" data-action="catalog-edit" data-id="${escapeHtml(item.tournamentId)}">Sửa</button>
        <button class="tp-btn tp-btn-sm tp-danger" type="button" data-action="catalog-delete" data-id="${escapeHtml(item.tournamentId)}">Xóa</button>
      `;
    }
  }

  function openCatalogForm(item = null) {
    state.catalogEditingId = item?.tournamentId || "";
    setCatalogView("form");
    const formTitle = qs("#tpCatalogFormTitle");
    if (formTitle) formTitle.textContent = item ? `Sửa giải: ${item.name}` : "Tạo giải đấu";
    qs("#tpCatalogFormId").value = item?.tournamentId || "";
    qs("#tpCatalogName").value = item?.name || "";
    qs("#tpCatalogLocation").value = item?.location || "";
    qs("#tpCatalogContent").value = item?.contentHtml || "";
    setMsg("#tpCatalogFormMessage", "");
  }

  function renderCatalog() {
    const rootEl = qs(".tp-root");
    if (rootEl) rootEl.dataset.role = state.role;
    if (state.catalogView === "detail") {
      setCatalogView("detail");
      renderCatalogDetail();
      return;
    }
    if (state.catalogView === "form" && state.role === "admin") {
      setCatalogView("form");
      return;
    }
    setCatalogView("list");
    renderCatalogList();
  }

  function renderAll() {
    const rootEl = qs(".tp-root");
    if (rootEl) rootEl.dataset.role = state.role;
    renderCatalog();
    renderUserHome();
    renderPlayers();
    renderRules();
    renderPairs();
    renderMatches();
    renderStandings();
  }

  async function openPartnerModal(eventId) {
    const modal = ensureModal();
    state.partnerEventId = eventId;
    modal.classList.add("is-open");
    modal.querySelector("#tpPartnerModalTitle").textContent =
      `Chọn đồng đội · ${EVENT_NAMES[eventId] || eventId}`;
    const msg = modal.querySelector("#tpPartnerMessage");
    msg.textContent = "Đang tải...";
    msg.classList.remove("is-error");
    const box = modal.querySelector("#tpPartnerCandidates");
    box.innerHTML = "";
    try {
      const data = await api(
        `/api/tournament/pairs/candidates?eventId=${encodeURIComponent(eventId)}`
      );
      const event = (state.data?.events || []).find((item) => item.eventId === eventId);
      const minSum = event?.minLevelSum ?? "?";
      const maxSum = event?.maxLevelSum ?? "?";
      modal.querySelector("#tpPartnerModalHint").innerHTML =
        `<span class="tp-modal-hint-label">Rule tổng level</span>
         <strong>${minSum} – ${maxSum}</strong>
         <span class="tp-modal-hint-text">Chỉ hiện ứng viên hợp lệ với trình độ của bạn.</span>`;
      if (!(data.candidates || []).length) {
        box.innerHTML = `<p class="tp-modal-empty">Không còn ứng viên phù hợp.</p>`;
        msg.textContent = "";
        return;
      }
      box.innerHTML = data.candidates
        .map(
          (item) => `<article class="tp-candidate">
            <div class="tp-candidate-main">
              <div class="tp-candidate-avatar" aria-hidden="true">${escapeHtml(String(item.name || "?").slice(0, 1).toUpperCase())}</div>
              <div class="tp-candidate-meta">
                <strong>${escapeHtml(item.name)}</strong>
                <div class="tp-candidate-tags">
                  <span class="tp-chip">${escapeHtml(item.gender || "-")}</span>
                  <span class="tp-chip">Lv${item.level} · ${escapeHtml(item.levelLabel || "")}</span>
                  <span class="tp-chip tp-chip-sum">Tổng ${item.levelSum}</span>
                </div>
              </div>
            </div>
            <button class="tp-modal-invite" type="button" data-action="invite" data-member="${escapeHtml(item.memberId)}">Mời</button>
          </article>`
        )
        .join("");
      msg.textContent = "";
    } catch (error) {
      msg.textContent = error.message;
      msg.classList.add("is-error");
    }
  }

  function bind() {
    state.root.addEventListener("submit", async (event) => {
      if (event.target.id === "tpCatalogForm") {
        event.preventDefault();
        const tournamentId = qs("#tpCatalogFormId")?.value.trim() || "";
        const payload = {
          name: qs("#tpCatalogName")?.value.trim() || "",
          location: qs("#tpCatalogLocation")?.value.trim() || "",
          contentHtml: qs("#tpCatalogContent")?.value || ""
        };
        try {
          if (!payload.name) {
            setMsg("#tpCatalogFormMessage", "Tên giải không được để trống.", true);
            return;
          }
          if (tournamentId) {
            await api(`/api/tournament/catalog/${encodeURIComponent(tournamentId)}`, {
              method: "PATCH",
              body: payload
            });
            setMsg("#tpCatalogMessage", "Đã cập nhật giải đấu.");
          } else {
            const data = await api("/api/tournament/catalog", {
              method: "POST",
              body: payload
            });
            setMsg("#tpCatalogMessage", data.message || "Đã tạo giải đấu.");
          }
          state.catalogView = "list";
          state.catalogEditingId = "";
          await refresh();
        } catch (error) {
          setMsg("#tpCatalogFormMessage", error.message, true);
        }
        return;
      }
      if (event.target.id !== "tpProfileForm") return;
      event.preventDefault();
      const eventIds = [
        ...state.root.querySelectorAll('#tpProfileEvents input[name="eventId"]:checked')
      ].map((input) => input.value);
      try {
        await api("/api/tournament/profile", {
          method: "POST",
          body: {
            name: qs("#tpProfileName").value.trim(),
            phoneNumber: qs("#tpProfilePhone").value.trim(),
            gender: qs("#tpProfileGender").value,
            level: Number(qs("#tpProfileLevel").value),
            eventIds,
            joinSummary: qs("#tpProfileJoinSummary").checked
          }
        });
        setMsg("#tpProfileMessage", "Đã lưu hồ sơ giải.");
        await refresh();
      } catch (error) {
        setMsg("#tpProfileMessage", error.message, true);
      }
    });

    state.root.addEventListener("click", async (event) => {
      const tab = event.target.closest("[data-panel]");
      if (tab && tab.closest("#tpMainTabs")) {
        activatePanel(tab.dataset.panel);
        return;
      }
      const standing = event.target.closest("[data-standing]");
      if (standing) {
        state.standingsEventId = standing.dataset.standing;
        renderStandings();
        return;
      }
      const btn = event.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      try {
        if (action === "catalog-back") {
          state.catalogView = "list";
          state.catalogSelectedId = "";
          state.catalogEditingId = "";
          renderCatalog();
          return;
        }
        if (action === "catalog-create") {
          openCatalogForm(null);
          return;
        }
        if (action === "catalog-view") {
          state.catalogSelectedId = btn.dataset.id || "";
          state.catalogView = "detail";
          renderCatalog();
          return;
        }
        if (action === "catalog-edit") {
          const item = (state.data?.catalog || []).find((row) => row.tournamentId === btn.dataset.id);
          if (!item) {
            setMsg("#tpCatalogMessage", "Không tìm thấy giải để sửa.", true);
            return;
          }
          openCatalogForm(item);
          return;
        }
        if (action === "catalog-activate") {
          await api(`/api/tournament/catalog/${encodeURIComponent(btn.dataset.id)}/activate`, {
            method: "POST"
          });
          setMsg("#tpCatalogMessage", "Đã đặt giải đang diễn ra.");
          return refresh();
        }
        if (action === "catalog-delete") {
          const item = (state.data?.catalog || []).find((row) => row.tournamentId === btn.dataset.id);
          const label = item?.name || "giải này";
          if (!window.confirm(`Xóa giải "${label}"?`)) return;
          await api(`/api/tournament/catalog/${encodeURIComponent(btn.dataset.id)}`, {
            method: "DELETE"
          });
          if (state.catalogSelectedId === btn.dataset.id) {
            state.catalogSelectedId = "";
            state.catalogView = "list";
          }
          setMsg("#tpCatalogMessage", "Đã xóa giải đấu.");
          return refresh();
        }
        if (action === "open-partner") return openPartnerModal(btn.dataset.event);
        if (action === "accept-pair" || action === "reject-pair") {
          await api(`/api/tournament/pairs/${encodeURIComponent(btn.dataset.pair)}/respond`, {
            method: "POST",
            body: { accept: action === "accept-pair" }
          });
          return refresh();
        }
        if (action === "save-rule") {
          const eventId = btn.dataset.event;
          const min = state.root.querySelector(`.rule-min[data-event="${eventId}"]`)?.value;
          const max = state.root.querySelector(`.rule-max[data-event="${eventId}"]`)?.value;
          await api(`/api/tournament/events/${encodeURIComponent(eventId)}/rules`, {
            method: "PATCH",
            body: { minLevelSum: Number(min), maxLevelSum: Number(max) }
          });
          setMsg("#tpRulesMessage", "Đã lưu rule.");
          return refresh();
        }
        if (action === "cancel-pair") {
          if (!window.confirm("Hủy cặp này?")) return;
          await api(`/api/tournament/pairs/${encodeURIComponent(btn.dataset.pair)}/cancel`, {
            method: "POST"
          });
          return refresh();
        }
        if (action === "save-score") {
          const matchId = btn.dataset.match;
          const scoreA = state.root.querySelector(`.score-a[data-match="${matchId}"]`)?.value;
          const scoreB = state.root.querySelector(`.score-b[data-match="${matchId}"]`)?.value;
          await api(`/api/tournament/matches/${encodeURIComponent(matchId)}/score`, {
            method: "PATCH",
            body: { scoreA: Number(scoreA), scoreB: Number(scoreB) }
          });
          setMsg("#tpMatchesMessage", "Đã lưu tỉ số.");
          return refresh();
        }
        if (action === "approve-player" || action === "block-player") {
          const status = action === "approve-player" ? "approved" : "blocked";
          await api(`/api/tournament/players/${encodeURIComponent(btn.dataset.member)}`, {
            method: "PATCH",
            body: { status }
          });
          setMsg(
            "#tpPlayersMessage",
            status === "approved" ? "Đã duyệt VĐV tham dự." : "Đã từ chối VĐV."
          );
          return refresh();
        }
        if (action === "remove-player") {
          if (!window.confirm("Xóa VĐV khỏi danh sách giải? (Không xóa tài khoản member)")) return;
          await api(`/api/tournament/players/${encodeURIComponent(btn.dataset.member)}`, {
            method: "DELETE"
          });
          setMsg("#tpPlayersMessage", "Đã xóa VĐV khỏi giải.");
          return refresh();
        }
      } catch (error) {
        alert(error.message);
      }
    });

    state.root.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.id === "tpRegistrationOpen" || target.id === "tpPairingOpen") {
        try {
          await api("/api/tournament/settings", {
            method: "PATCH",
            body: {
              registrationOpen: qs("#tpRegistrationOpen")?.checked,
              pairingOpen: qs("#tpPairingOpen")?.checked
            }
          });
          await refresh();
        } catch (error) {
          setMsg("#tpPlayersMessage", error.message, true);
        }
      }
    });

    qs("#tpSaveSettingsBtn")?.addEventListener("click", async () => {
      try {
        await api("/api/tournament/settings", {
          method: "PATCH",
          body: {
            pointsToWin: Number(qs("#tpPointsToWinInput")?.value || 21),
            registrationOpen: qs("#tpRegistrationOpen")?.checked,
            pairingOpen: qs("#tpPairingOpen")?.checked
          }
        });
        setMsg("#tpRulesMessage", "Đã lưu settings.");
        await refresh();
      } catch (error) {
        setMsg("#tpRulesMessage", error.message, true);
      }
    });

    qs("#tpGenerateMatchesBtn")?.addEventListener("click", async () => {
      try {
        const data = await api("/api/tournament/matches/generate", {
          method: "POST",
          body: { eventId: qs("#tpGenerateEventSelect")?.value || "" }
        });
        setMsg("#tpMatchesMessage", data.message || "Đã generate.");
        await refresh();
      } catch (error) {
        setMsg("#tpMatchesMessage", error.message, true);
      }
    });
  }

  async function refresh() {
    const data = await api("/api/tournament/bootstrap", { loading: true });
    state.role = data.role;
    state.memberName = data.memberName || "";
    state.data = data;

    const needProfile = state.role === "user" && !data.registration?.profileCompleted;
    const gate = qs("#tpProfileGate");
    const main = qs("#tpMainApp");
    if (gate) gate.hidden = !needProfile;
    if (main) main.hidden = needProfile;

    renderCatalog();

    if (needProfile) {
      fillLevelSelect(qs("#tpProfileLevel"));
      fillProfileEvents();
      qs("#tpProfileName").value = data.member?.name || state.memberName || "";
      qs("#tpProfilePhone").value = data.member?.phoneNumber || "";
      qs("#tpProfileGender").value = data.member?.gender || "";
      qs("#tpProfileLevel").value = String(data.member?.level || 5);
      return;
    }
    buildTabs();
    renderAll();
  }

  async function mount(container) {
    if (!container) throw new Error("Thiếu container giải đấu.");
    state.root = container;
    container.innerHTML = template();
    ensureModal();
    fillLevelSelect(qs("#tpProfileLevel"));
    fillProfileEvents();
    bind();
    await refresh();
  }

  window.TournamentPanel = { mount, refresh };
})();
