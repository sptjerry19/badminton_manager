// Sổ tiền sân dùng chung cho admin (nhập tiền + sổ nợ) và thành viên (xem sổ).
// Công nợ mỗi người = tổng phần chia (sân + cầu + phát sinh) − phần đã trả − tiền nạp trước.
(function () {
  const ledger = {
    role: "",
    members: [],
    sessions: [],
    credits: new Map(),
    selected: new Set(),
    guests: [],
    voteSessionId: "",
    voteLabel: "",
    highlightId: "",
    entryRoot: null,
    ledgerRoot: null,
    onChange: null
  };

  function esc(value) {
    return String(value ?? "")
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

  function shortDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!match) return iso || "";
    return `${Number(match[3])}/${Number(match[2])}`;
  }

  function localToday() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  }

  function equalShares(total, count) {
    if (count <= 0) return [];
    const base = Math.floor(total / count);
    const remainder = total - base * count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || "GET",
      credentials: "include",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Không gọi được máy chủ.");
    return data;
  }

  function setNote(node, message, isError) {
    if (!node) return;
    node.hidden = !message;
    node.textContent = message || "";
    node.classList.toggle("is-error", Boolean(isError));
  }

  const q = (root, selector) => root?.querySelector(selector) || null;

  // ---------- Nhập tiền ----------

  function entryMarkup() {
    return `
      <form class="bezel" data-ledger-form>
        <div class="core stack">
          <div class="screen-head">
            <h2>Nhập tiền buổi chơi</h2>
            <p>Tổng = tiền sân + tiền cầu + phát sinh, chia đều cho người được chọn.</p>
          </div>
          <div class="vote-link" data-vote-link hidden>
            <span data-vote-label></span>
            <button type="button" class="ghost" data-vote-unlink>Bỏ liên kết</button>
          </div>
          <div class="money-row">
            <label class="field"><span>Ngày đánh</span><input name="date" type="date" required /></label>
            <label class="field"><span>Sân</span><input name="court" type="text" placeholder="Lê Văn Thiêm" autocomplete="off" required /></label>
          </div>
          <div class="money-row money-row-3">
            <label class="field"><span>Tiền sân</span><input name="courtFee" data-money inputmode="numeric" autocomplete="off" placeholder="0" /></label>
            <label class="field"><span>Tiền cầu</span><input name="shuttleFee" data-money inputmode="numeric" autocomplete="off" placeholder="0" /></label>
            <label class="field"><span>Phát sinh</span><input name="extraFee" data-money inputmode="numeric" autocomplete="off" placeholder="0" /></label>
          </div>
          <label class="field" data-extra-note hidden>
            <span>Nội dung phát sinh</span>
            <input name="extraNote" type="text" maxlength="200" placeholder="Nước, thuê thêm giờ..." autocomplete="off" />
          </label>
          <div class="total-island" aria-live="polite"><span>Tổng tiền</span><strong data-total>0đ</strong></div>
          <div class="stack">
            <label class="field">
              <span>Người tham gia</span>
              <input data-filter type="search" placeholder="Tìm trong danh sách thành viên" autocomplete="off" />
            </label>
            <div class="chips" data-members></div>
            <div class="guest-add">
              <input data-guest-input type="text" maxlength="60" placeholder="Tên người giao lưu" autocomplete="off" />
              <button type="button" class="ghost" data-guest-add>Thêm</button>
            </div>
            <div class="chips" data-guests></div>
          </div>
          <ul class="preview" data-preview hidden></ul>
          <button class="pill" type="submit">Lưu buổi</button>
          <p class="note" data-form-note hidden></p>
        </div>
      </form>
    `;
  }

  function fees() {
    const form = q(ledger.entryRoot, "[data-ledger-form]");
    return {
      courtFee: parseMoney(form?.courtFee.value),
      shuttleFee: parseMoney(form?.shuttleFee.value),
      extraFee: parseMoney(form?.extraFee.value)
    };
  }

  function totalFee() {
    const { courtFee, shuttleFee, extraFee } = fees();
    return courtFee + shuttleFee + extraFee;
  }

  function participants() {
    const members = ledger.members
      .filter((member) => ledger.selected.has(member.memberId))
      .map((member) => ({ name: member.name, guest: false }));
    const guests = ledger.guests.map((name) => ({ name, guest: true }));
    return [...members, ...guests].sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));
  }

  function paintTotal() {
    const root = ledger.entryRoot;
    if (!root) return;
    q(root, "[data-total]").textContent = money(totalFee());
    q(root, "[data-extra-note]").hidden = fees().extraFee <= 0;
    paintPreview();
  }

  function paintMembers() {
    const root = ledger.entryRoot;
    if (!root) return;
    const filter = q(root, "[data-filter]").value.trim().toLowerCase();
    const visible = ledger.members.filter((member) => member.name.toLowerCase().includes(filter));
    q(root, "[data-members]").innerHTML = visible.length
      ? visible
          .map(
            (member) =>
              `<button type="button" class="chip${ledger.selected.has(member.memberId) ? " is-on" : ""}" data-member="${esc(member.memberId)}">${esc(member.name)}</button>`
          )
          .join("")
      : `<p class="empty">Không có thành viên khớp.</p>`;
    paintPreview();
  }

  function paintGuests() {
    const root = ledger.entryRoot;
    if (!root) return;
    q(root, "[data-guests]").innerHTML = ledger.guests
      .map(
        (name) =>
          `<button type="button" class="chip is-guest" data-guest="${esc(name)}">${esc(name)} <span class="tag">Giao lưu</span></button>`
      )
      .join("");
  }

  function paintPreview() {
    const node = q(ledger.entryRoot, "[data-preview]");
    if (!node) return;
    const people = participants();
    const total = totalFee();
    if (!people.length || total <= 0) {
      node.hidden = true;
      node.innerHTML = "";
      return;
    }
    const shares = equalShares(total, people.length);
    node.hidden = false;
    node.innerHTML = people
      .map(
        (person, index) =>
          `<li><span>${esc(person.name)}${person.guest ? '<span class="tag">Giao lưu</span>' : ""}</span><b>${money(shares[index])}</b></li>`
      )
      .join("");
  }

  function paintVoteLink() {
    const root = ledger.entryRoot;
    if (!root) return;
    q(root, "[data-vote-link]").hidden = !ledger.voteSessionId;
    q(root, "[data-vote-label]").textContent = ledger.voteSessionId ? `Tính tiền cho vote ${ledger.voteLabel}` : "";
  }

  function resetEntry() {
    const form = q(ledger.entryRoot, "[data-ledger-form]");
    if (!form) return;
    ledger.selected.clear();
    ledger.guests = [];
    ledger.voteSessionId = "";
    ledger.voteLabel = "";
    form.reset();
    form.date.value = localToday();
    paintVoteLink();
    paintMembers();
    paintGuests();
    paintTotal();
  }

  function addGuest() {
    const root = ledger.entryRoot;
    const input = q(root, "[data-guest-input]");
    const note = q(root, "[data-form-note]");
    const name = input.value.trim().replace(/\s+/g, " ");
    if (!name) return;
    input.value = "";
    const existing = ledger.members.find((member) => member.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      ledger.selected.add(existing.memberId);
      setNote(note, `${existing.name} đã có trong danh sách thành viên, nên đã chọn sẵn.`);
      paintMembers();
      return;
    }
    if (ledger.guests.some((guest) => guest.toLowerCase() === name.toLowerCase())) return;
    ledger.guests.push(name);
    setNote(note, "");
    paintGuests();
    paintPreview();
  }

  function bindEntry(root) {
    const form = q(root, "[data-ledger-form]");
    form.addEventListener("input", (event) => {
      const input = event.target;
      if (input.matches("[data-money]")) {
        const amount = parseMoney(input.value);
        input.value = amount ? new Intl.NumberFormat("vi-VN").format(amount) : "";
        paintTotal();
      } else if (input.matches("[data-filter]")) {
        paintMembers();
      }
    });
    q(root, "[data-members]").addEventListener("click", (event) => {
      const chip = event.target.closest("[data-member]");
      if (!chip) return;
      const id = chip.dataset.member;
      if (ledger.selected.has(id)) ledger.selected.delete(id);
      else ledger.selected.add(id);
      paintMembers();
    });
    q(root, "[data-guest-input]").addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addGuest();
    });
    q(root, "[data-guest-add]").addEventListener("click", addGuest);
    q(root, "[data-guests]").addEventListener("click", (event) => {
      const chip = event.target.closest("[data-guest]");
      if (!chip) return;
      const name = chip.dataset.guest.toLowerCase();
      ledger.guests = ledger.guests.filter((guest) => guest.toLowerCase() !== name);
      paintGuests();
      paintPreview();
    });
    q(root, "[data-vote-unlink]").addEventListener("click", () => {
      ledger.voteSessionId = "";
      ledger.voteLabel = "";
      paintVoteLink();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const note = q(root, "[data-form-note]");
      setNote(note, "");
      if (totalFee() <= 0) return setNote(note, "Tổng tiền phải lớn hơn 0.", true);
      if (!ledger.selected.size && !ledger.guests.length) {
        return setNote(note, "Chọn thành viên hoặc thêm người giao lưu.", true);
      }
      const submit = form.querySelector("button[type=submit]");
      submit.disabled = true;
      try {
        const data = await api("/api/basic/sessions", {
          method: "POST",
          body: {
            date: form.date.value,
            court: form.court.value.trim(),
            ...fees(),
            extraNote: form.extraNote.value.trim(),
            voteSessionId: ledger.voteSessionId,
            memberIds: [...ledger.selected],
            guestNames: [...ledger.guests]
          }
        });
        ledger.highlightId = data.session?.id || "";
        resetEntry();
        setNote(note, data.message || "Đã lưu buổi.", Boolean(data.push && !data.push.sent && data.push.failed));
        await load();
        ledger.onChange?.({ type: "saved", session: data.session });
      } catch (error) {
        setNote(note, error.message, true);
      } finally {
        submit.disabled = false;
      }
    });
  }

  // ---------- Sổ nợ ----------

  function ledgerMarkup() {
    return `
      <div class="summary bezel">
        <div class="core summary-core">
          <p class="eyebrow">Còn phải thu</p>
          <strong data-unpaid>0đ</strong>
          <p data-unpaid-meta>Chưa có buổi nào.</p>
        </div>
      </div>
      <p class="note" data-viewer-note hidden>Bạn đang xem sổ. Chỉ admin nhập buổi và đánh dấu thanh toán.</p>
      <section class="totals bezel" data-totals hidden>
        <div class="core">
          <p class="eyebrow">Tổng kết</p>
          <h2>Công nợ từng người</h2>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Thành viên</th><th>Còn nợ</th><th></th></tr></thead>
              <tbody data-totals-body></tbody>
            </table>
          </div>
        </div>
      </section>
      <div class="ledger" data-sessions></div>
    `;
  }

  function personKey(share) {
    return share.memberId ? `m:${share.memberId}` : `g:${String(share.memberName || "").toLowerCase()}`;
  }

  function personGroups() {
    const groups = new Map();
    ledger.sessions.forEach((session) => {
      (session.shares || []).forEach((share) => {
        const key = personKey(share);
        if (!groups.has(key)) {
          groups.set(key, {
            memberId: share.memberId || "",
            memberName: share.memberName,
            unpaid: 0,
            unpaidCount: 0,
            credit: share.memberId ? ledger.credits.get(share.memberId) || 0 : 0
          });
        }
        if (!share.paid) {
          const group = groups.get(key);
          group.unpaid += share.shareAmount;
          group.unpaidCount += 1;
        }
      });
    });
    return [...groups.values()]
      .map((group) => ({ ...group, balance: group.unpaid - group.credit }))
      .sort((a, b) => b.balance - a.balance || a.memberName.localeCompare(b.memberName, "vi", { sensitivity: "base" }));
  }

  function shareStatusHtml(share) {
    const label = share.paid ? "Đã thanh toán" : "Chưa thanh toán";
    const tone = share.paid ? "is-paid" : "is-due";
    if (ledger.role !== "admin") return `<span class="badge ${tone}">${label}</span>`;
    return `<button type="button" class="status ${tone}" data-share="${esc(share.id)}" data-paid="${share.paid ? "true" : "false"}">${label}</button>`;
  }

  function paintSummary(people) {
    const root = ledger.ledgerRoot;
    const owed = people.reduce((sum, person) => sum + Math.max(0, person.balance), 0);
    const debtors = people.filter((person) => person.balance > 0).length;
    q(root, "[data-unpaid]").textContent = money(owed);
    q(root, "[data-unpaid-meta]").textContent = !ledger.sessions.length
      ? "Chưa có buổi nào."
      : debtors
        ? `${debtors} người còn nợ`
        : "Đã thu đủ.";
  }

  function paintTotals(people) {
    const root = ledger.ledgerRoot;
    const box = q(root, "[data-totals]");
    const body = q(root, "[data-totals-body]");
    box.hidden = !people.length;
    body.innerHTML = people
      .map((person) => {
        const breakdown = person.credit
          ? `<small class="muted">Chưa trả ${money(person.unpaid)} − nạp trước ${money(person.credit)}</small>`
          : "";
        const amount = person.balance < 0 ? `Dư ${money(-person.balance)}` : money(person.balance);
        let action = `<span class="badge is-paid">Đã thanh toán</span>`;
        if (person.unpaidCount) {
          action =
            ledger.role === "admin"
              ? `<button type="button" class="status is-due" data-settle-id="${esc(person.memberId)}" data-settle-name="${esc(person.memberName)}">Đã hoàn thành</button>`
              : `<span class="badge is-due">${person.unpaidCount} buổi chưa trả</span>`;
        }
        return `
          <tr>
            <td><b>${esc(person.memberName)}</b>${person.memberId ? "" : '<span class="tag">Giao lưu</span>'}</td>
            <td><div class="who">${amount}${breakdown}</div></td>
            <td>${action}</td>
          </tr>
        `;
      })
      .join("");
  }

  function paintSessions() {
    const root = ledger.ledgerRoot;
    const list = q(root, "[data-sessions]");
    if (!ledger.sessions.length) {
      list.innerHTML = `<p class="empty">Khi admin lưu một buổi, sổ sẽ hiện theo ngày, sân và từng người.</p>`;
      return;
    }
    list.innerHTML = ledger.sessions
      .map((session) => {
        const shares = session.shares || [];
        const extra = session.extraFee
          ? `<span>Phát sinh <b>${money(session.extraFee)}</b>${session.extraNote ? ` (${esc(session.extraNote)})` : ""}</span>`
          : "";
        const rows = shares
          .map(
            (share) => `
              <div class="share" data-share-row="${esc(share.id)}">
                <div class="who">
                  <b>${esc(share.memberName)}${share.memberId ? "" : '<span class="tag">Giao lưu</span>'}</b>
                  <small>${esc(shortDate(session.date))} · ${money(share.shareAmount)}</small>
                </div>
                ${shareStatusHtml(share)}
              </div>
            `
          )
          .join("");
        const tools =
          ledger.role === "admin"
            ? `<div class="session-tools"><button type="button" class="danger" data-delete="${esc(session.id)}">Xóa buổi</button></div>`
            : "";
        return `
          <article class="session bezel${session.id === ledger.highlightId ? " is-fresh" : ""}" data-session="${esc(session.id)}">
            <div class="core">
              <button type="button" class="session-toggle" aria-expanded="false">
                <span class="session-summary">
                  <span class="eyebrow">Ngày ${esc(shortDate(session.date))}</span>
                  <span class="session-title">${esc(session.court)}</span>
                  <span class="meta">
                    <span>Tiền sân <b>${money(session.courtFee)}</b></span>
                    <span>Tiền cầu <b>${money(session.shuttleFee)}</b></span>
                    ${extra}
                    <span>Tổng <b>${money(session.totalFee)}</b></span>
                  </span>
                </span>
                <span class="session-chevron" aria-hidden="true"></span>
              </button>
              <div class="session-detail"><div class="session-detail-inner"><div class="shares">${rows}</div>${tools}</div></div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function paintLedger() {
    if (!ledger.ledgerRoot) return;
    const people = personGroups();
    q(ledger.ledgerRoot, "[data-viewer-note]").hidden = ledger.role === "admin";
    paintSummary(people);
    paintTotals(people);
    paintSessions();
  }

  // Nút cần bấm 2 lần (bấm lần 1 để "lên đạn", lần 2 để xác nhận).
  function armOnce(button, selector, idleLabel, armedLabel) {
    if (button.dataset.armed === "true") return true;
    ledger.ledgerRoot.querySelectorAll(selector).forEach((item) => {
      item.dataset.armed = "false";
      item.classList.remove("is-armed");
      item.textContent = idleLabel;
    });
    button.dataset.armed = "true";
    button.classList.add("is-armed");
    button.textContent = armedLabel;
    return false;
  }

  function bindLedger(root) {
    root.addEventListener("click", async (event) => {
      const meta = q(root, "[data-unpaid-meta]");
      const toggle = event.target.closest(".session-toggle");
      if (toggle) {
        const open = toggle.closest(".session").classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        return;
      }
      if (ledger.role !== "admin") return;

      const status = event.target.closest("[data-share]");
      if (status) {
        status.disabled = true;
        try {
          const data = await api(`/api/basic/shares/${status.dataset.share}`, {
            method: "PATCH",
            body: { paid: status.dataset.paid !== "true" }
          });
          ledger.sessions.forEach((session) => {
            const share = (session.shares || []).find((item) => item.id === status.dataset.share);
            if (share) Object.assign(share, data.share);
          });
          paintLedger();
          ledger.onChange?.({ type: "paid" });
        } catch (error) {
          status.disabled = false;
          meta.textContent = error.message;
        }
        return;
      }

      const settle = event.target.closest("[data-settle-name]");
      if (settle) {
        if (!armOnce(settle, "[data-settle-name]", "Đã hoàn thành", "Xác nhận")) return;
        settle.disabled = true;
        try {
          await api("/api/basic/people/paid", {
            method: "PATCH",
            body: { memberId: settle.dataset.settleId || "", memberName: settle.dataset.settleName || "" }
          });
          await load();
          ledger.onChange?.({ type: "settled" });
        } catch (error) {
          settle.disabled = false;
          meta.textContent = error.message;
        }
        return;
      }

      const remove = event.target.closest("[data-delete]");
      if (remove) {
        if (!armOnce(remove, "[data-delete]", "Xóa buổi", "Xác nhận xóa")) return;
        remove.disabled = true;
        try {
          await api(`/api/basic/sessions/${remove.dataset.delete}`, { method: "DELETE" });
          await load();
          ledger.onChange?.({ type: "deleted" });
        } catch (error) {
          remove.disabled = false;
          meta.textContent = error.message;
        }
      }
    });
  }

  // ---------- API công khai ----------

  async function load() {
    const data = await api("/api/basic");
    ledger.role = data.role || "";
    ledger.members = Array.isArray(data.members) ? data.members : [];
    ledger.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    ledger.credits = new Map((data.credits || []).map((item) => [item.memberId, Number(item.balance) || 0]));
    paintMembers();
    paintLedger();
    return data;
  }

  function mountEntry(root) {
    if (!root || ledger.entryRoot === root) return;
    ledger.entryRoot = root;
    root.innerHTML = entryMarkup();
    bindEntry(root);
    resetEntry();
  }

  function mountLedger(root) {
    if (!root || ledger.ledgerRoot === root) return;
    ledger.ledgerRoot = root;
    root.innerHTML = ledgerMarkup();
    bindLedger(root);
    paintLedger();
  }

  // Điền sẵn form nhập tiền từ một buổi vote đã chốt.
  function prefill({ date, court, memberIds, voteSessionId, label }) {
    const form = q(ledger.entryRoot, "[data-ledger-form]");
    if (!form) return;
    resetEntry();
    if (date) form.date.value = date;
    if (court) form.court.value = court;
    const known = new Set(ledger.members.map((member) => member.memberId));
    (memberIds || []).forEach((id) => known.has(id) && ledger.selected.add(id));
    ledger.voteSessionId = voteSessionId || "";
    ledger.voteLabel = label || "";
    paintVoteLink();
    paintMembers();
    form.courtFee.focus();
  }

  window.BasicLedger = {
    load,
    mountEntry,
    mountLedger,
    prefill,
    onChange(callback) {
      ledger.onChange = callback;
    }
  };
})();
