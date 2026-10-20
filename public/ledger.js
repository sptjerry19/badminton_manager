// Sổ tiền sân dùng chung cho admin (nhập tiền + sổ nợ) và thành viên (xem sổ của mình).
// Công nợ mỗi người = tổng phần chia (sân + cầu + phát sinh) − phần đã trả − tiền nạp trước.
(function () {
  const ledger = {
    role: "",
    memberName: "",
    members: [],
    sessions: [],
    credits: new Map(),
    selected: new Set(),
    guests: [],
    voteSessionId: "",
    voteLabel: "",
    highlightId: "",
    openSessionId: "",
    personFilter: "due",
    ledgerMode: "",
    entryRoot: null,
    ledgerRoot: null,
    onChange: null
  };

  const { icon, avatar, hydrate } = window.UI;

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

  function dateParts(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!match) return { day: "--", month: "", short: iso || "" };
    return {
      day: match[3],
      month: String(Number(match[2])),
      short: `${Number(match[3])}/${Number(match[2])}`
    };
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

  const guestTag = '<span class="badge badge-guest">GL</span>';

  // ---------- Nhập tiền ----------

  function entryMarkup() {
    return `
      <form class="money-layout" data-ledger-form>
        <section>
          <div class="page-heading">
            <div>
              <span class="eyebrow">CHỐT CHI PHÍ BUỔI</span>
              <h2>Nhập tiền sân</h2>
              <p>Tổng = tiền sân + tiền cầu + phát sinh, chia đều cho người được chọn.</p>
              <div class="vote-link" data-vote-link hidden>
                <span class="badge badge-green" data-vote-label></span>
                <button type="button" class="text-btn" data-vote-unlink>Bỏ liên kết</button>
              </div>
            </div>
          </div>
          <div class="form-card">
            <div class="form-grid">
              <label class="field"><span>Ngày đánh</span><input name="date" type="date" required /></label>
              <label class="field"><span>Tên sân</span><input name="court" type="text" placeholder="VD: Sân Lê Văn Thiêm" autocomplete="off" required /></label>
              <label class="field"><span>Tiền sân</span><input name="courtFee" data-money inputmode="numeric" autocomplete="off" placeholder="0đ" /></label>
              <label class="field"><span>Tiền cầu</span><input name="shuttleFee" data-money inputmode="numeric" autocomplete="off" placeholder="0đ" /></label>
              <label class="field"><span>Phát sinh</span><input name="extraFee" data-money inputmode="numeric" autocomplete="off" placeholder="0đ" /></label>
              <label class="field"><span>Nội dung phát sinh</span><input name="extraNote" type="text" maxlength="200" placeholder="Nước, thuê thêm giờ..." autocomplete="off" /></label>
            </div>
          </div>
          <div class="section-title">
            <h2>Người tham gia</h2>
            <span class="text-btn" data-selected-count>0 người đã chọn</span>
          </div>
          <div class="participant-card">
            <label class="search-box">
              ${icon("search")}
              <input data-filter type="search" placeholder="Tìm thành viên..." autocomplete="off" />
            </label>
            <div class="member-chips" data-members></div>
            <div class="guest-add">
              <input data-guest-input type="text" maxlength="60" placeholder="Tên người giao lưu" autocomplete="off" />
              <button type="button" class="btn btn-secondary btn-sm" data-guest-add>${icon("plus", 16)}Thêm giao lưu</button>
            </div>
            <div class="member-chips" data-guests style="margin-top:10px"></div>
          </div>
        </section>
        <aside class="bill-preview">
          <span class="eyebrow">XEM TRƯỚC</span>
          <h3>Chia tiền buổi chơi</h3>
          <div class="bill-total" aria-live="polite">
            <small>TỔNG CHI</small>
            <strong data-total>0đ</strong>
          </div>
          <div class="bill-lines">
            <p><span>Tiền sân</span><b data-line="courtFee">0đ</b></p>
            <p><span>Tiền cầu</span><b data-line="shuttleFee">0đ</b></p>
            <p><span>Phát sinh</span><b data-line="extraFee">0đ</b></p>
          </div>
          <div class="split-result">
            <span>${icon("users")}<b data-count>0 người</b></span>
            <span>mỗi người trả</span>
            <strong data-each>0đ</strong>
          </div>
          <ul class="split-list" data-preview hidden></ul>
          <button class="btn btn-primary full-btn" type="submit">${icon("check")}Lưu buổi &amp; tạo công nợ</button>
          <p class="form-note" data-form-note hidden></p>
          <p class="safe-note">Có thể đánh dấu thanh toán hoặc xóa buổi ở Sổ nợ.</p>
        </aside>
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
    const parts = fees();
    q(root, "[data-total]").textContent = money(totalFee());
    Object.entries(parts).forEach(([key, value]) => {
      q(root, `[data-line="${key}"]`).textContent = money(value);
    });
    paintPreview();
  }

  function memberChip(member) {
    const on = ledger.selected.has(member.memberId);
    return `<button type="button" class="member-chip${on ? " selected" : ""}" data-member="${esc(member.memberId)}">${avatar(member.name, "sm")}${esc(member.name)}${on ? icon("check", 14) : ""}</button>`;
  }

  function paintMembers() {
    const root = ledger.entryRoot;
    if (!root) return;
    const filter = q(root, "[data-filter]").value.trim().toLowerCase();
    const visible = ledger.members.filter((member) => member.name.toLowerCase().includes(filter));
    q(root, "[data-members]").innerHTML = visible.length
      ? visible.map(memberChip).join("")
      : `<p class="hint-line">Không có thành viên khớp.</p>`;
    paintPreview();
  }

  function paintGuests() {
    const root = ledger.entryRoot;
    if (!root) return;
    q(root, "[data-guests]").innerHTML = ledger.guests
      .map(
        (name) =>
          `<button type="button" class="member-chip guest selected" data-guest="${esc(name)}" title="Bấm để bỏ">${avatar(name, "sm")}${esc(name)} ${guestTag}${icon("close", 14)}</button>`
      )
      .join("");
  }

  function paintPreview() {
    const root = ledger.entryRoot;
    const node = q(root, "[data-preview]");
    if (!node) return;
    const people = participants();
    const total = totalFee();
    const shares = equalShares(total, people.length);
    q(root, "[data-count]").textContent = `${people.length} người`;
    q(root, "[data-selected-count]").textContent = `${people.length} người đã chọn`;
    q(root, "[data-each]").textContent = people.length && total > 0 ? money(Math.max(...shares)) : "0đ";
    if (!people.length || total <= 0) {
      node.hidden = true;
      node.innerHTML = "";
      return;
    }
    node.hidden = false;
    node.innerHTML = people
      .map(
        (person, index) =>
          `<li><span>${esc(person.name)} ${person.guest ? guestTag : ""}</span><b>${money(shares[index])}</b></li>`
      )
      .join("");
  }

  function paintVoteLink() {
    const root = ledger.entryRoot;
    if (!root) return;
    q(root, "[data-vote-link]").hidden = !ledger.voteSessionId;
    q(root, "[data-vote-label]").textContent = ledger.voteSessionId ? `Liên kết vote ${ledger.voteLabel}` : "";
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

  // Trả về true nếu đã thêm (hoặc đã chọn sẵn thành viên trùng tên).
  function addGuestName(rawName) {
    const name = String(rawName || "").trim().replace(/\s+/g, " ");
    if (!name) return false;
    const existing = ledger.members.find((member) => member.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      ledger.selected.add(existing.memberId);
      return `${existing.name} đã có trong danh sách thành viên, nên đã chọn sẵn.`;
    }
    if (!ledger.guests.some((guest) => guest.toLowerCase() === name.toLowerCase())) ledger.guests.push(name);
    return "";
  }

  function addGuest() {
    const root = ledger.entryRoot;
    const input = q(root, "[data-guest-input]");
    const note = q(root, "[data-form-note]");
    if (!input.value.trim()) return;
    const message = addGuestName(input.value);
    input.value = "";
    setNote(note, message || "");
    paintMembers();
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
        ledger.openSessionId = ledger.highlightId;
        resetEntry();
        setNote(note, data.message || "Đã lưu buổi.", Boolean(data.push && !data.push.sent && data.push.failed));
        await load();
        ledger.onChange?.({ type: "saved", session: data.session, message: data.message || "Đã lưu buổi và tạo công nợ" });
      } catch (error) {
        setNote(note, error.message, true);
      } finally {
        submit.disabled = false;
      }
    });
  }

  // ---------- Sổ nợ ----------

  function adminLedgerMarkup() {
    return `
      <div class="debt-layout">
        <div class="page-heading">
          <div>
            <span class="eyebrow">DÒNG TIỀN NHÓM</span>
            <h2>Sổ nợ</h2>
            <p>Theo dõi công nợ theo người và từng buổi chơi.</p>
          </div>
        </div>
        <div class="kpi-grid">
          <div class="kpi danger">
            <span>${icon("users")}</span>
            <small>NGƯỜI CÒN NỢ</small>
            <strong data-kpi-debtors>0</strong>
            <em data-kpi-debtors-meta></em>
          </div>
          <div class="kpi danger">
            <span>${icon("wallet")}</span>
            <small>TỔNG CÒN NỢ</small>
            <strong data-unpaid>0đ</strong>
            <em data-unpaid-meta>Chưa có buổi nào.</em>
          </div>
          <div class="kpi success">
            <span>${icon("check")}</span>
            <small>ĐÃ THU THÁNG NÀY</small>
            <strong data-kpi-paid>0đ</strong>
            <em data-kpi-paid-meta></em>
          </div>
          <div class="kpi warning">
            <span>${icon("clock")}</span>
            <small>TIỀN DƯ</small>
            <strong data-kpi-credit>0đ</strong>
            <em data-kpi-credit-meta></em>
          </div>
        </div>
        <p class="form-note is-error" data-ledger-error hidden></p>
        <div class="debt-columns">
          <section class="debt-table">
            <div class="card-head">
              <div>
                <h3>Công nợ theo người</h3>
                <p>Cập nhật ngay khi đánh dấu thanh toán</p>
              </div>
              <div class="filter-chips small" data-person-filter>
                <button type="button" data-filter-value="due">Còn nợ</button>
                <button type="button" data-filter-value="all">Tất cả</button>
              </div>
            </div>
            <div class="debt-table-head"><span>THÀNH VIÊN</span><span>SỐ DƯ</span><span>TRẠNG THÁI</span><span></span></div>
            <div data-totals-body></div>
          </section>
          <section class="session-debts">
            <div class="card-head">
              <div>
                <h3>Theo buổi chơi</h3>
                <p data-session-meta></p>
              </div>
            </div>
            <div data-sessions></div>
          </section>
        </div>
      </div>
    `;
  }

  function personalLedgerMarkup() {
    return `<div class="ledger-list" data-personal></div><p class="form-note is-error" data-ledger-error hidden></p>`;
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
    const tone = share.paid ? "badge-green" : "badge-red";
    if (ledger.role !== "admin") return `<span class="badge ${tone}">${label}</span>`;
    return `<button type="button" class="badge ${tone}" data-share="${esc(share.id)}" data-paid="${share.paid ? "true" : "false"}" title="Bấm để đổi trạng thái">${label}</button>`;
  }

  function paintKpis(people) {
    const root = ledger.ledgerRoot;
    const owed = people.reduce((sum, person) => sum + Math.max(0, person.balance), 0);
    const debtors = people.filter((person) => person.balance > 0).length;
    q(root, "[data-kpi-debtors]").textContent = String(debtors);
    q(root, "[data-kpi-debtors-meta]").textContent = `trên ${people.length} người trong sổ`;
    q(root, "[data-unpaid]").textContent = money(owed);
    q(root, "[data-unpaid-meta]").textContent = !ledger.sessions.length
      ? "Chưa có buổi nào."
      : debtors
        ? `${debtors} người còn nợ`
        : "Đã thu đủ.";

    const monthKey = localToday().slice(0, 7);
    let paidMonth = 0;
    let paidCount = 0;
    ledger.sessions
      .filter((session) => String(session.date || "").startsWith(monthKey))
      .forEach((session) => {
        (session.shares || []).forEach((share) => {
          if (!share.paid) return;
          paidMonth += Number(share.shareAmount) || 0;
          paidCount += 1;
        });
      });
    q(root, "[data-kpi-paid]").textContent = money(paidMonth);
    q(root, "[data-kpi-paid-meta]").textContent = `${paidCount} phần đã trả trong tháng`;

    const credits = [...ledger.credits.values()].filter((value) => value > 0);
    q(root, "[data-kpi-credit]").textContent = money(credits.reduce((sum, value) => sum + value, 0));
    q(root, "[data-kpi-credit-meta]").textContent = `của ${credits.length} thành viên`;
  }

  function paintTotals(people) {
    const root = ledger.ledgerRoot;
    const body = q(root, "[data-totals-body]");
    root.querySelectorAll("[data-filter-value]").forEach((button) => {
      button.classList.toggle("active", button.dataset.filterValue === ledger.personFilter);
    });
    const list = ledger.personFilter === "due" ? people.filter((person) => person.unpaidCount > 0) : people;
    if (!list.length) {
      body.innerHTML = `<div class="empty-card" style="border:0;border-radius:0">${
        people.length ? "Không còn ai nợ. Tuyệt vời!" : "Chưa có buổi nào trong sổ."
      }</div>`;
      return;
    }
    body.innerHTML = list
      .map((person) => {
        const detail = person.credit
          ? `Chưa trả ${money(person.unpaid)} − nạp trước ${money(person.credit)}`
          : person.unpaidCount
            ? `${person.unpaidCount} buổi chưa thanh toán`
            : "Đã thanh toán hết";
        const amount = person.balance < 0 ? `Dư ${money(-person.balance)}` : money(person.balance);
        const tone = person.balance > 0 ? "negative" : "positive";
        const badge =
          person.balance > 0
            ? '<span class="badge badge-red">Còn nợ</span>'
            : person.balance < 0
              ? '<span class="badge badge-blue">Dư tiền</span>'
              : '<span class="badge badge-green">Đã thu đủ</span>';
        const action =
          person.unpaidCount && ledger.role === "admin"
            ? `<button type="button" class="btn btn-secondary btn-sm" data-settle-id="${esc(person.memberId)}" data-settle-name="${esc(person.memberName)}">${icon("check", 16)}<span>Đã hoàn thành</span></button>`
            : "<span></span>";
        return `
          <div class="debt-row">
            <div>${avatar(person.memberName)}<span><b>${esc(person.memberName)} ${person.memberId ? "" : guestTag}</b><small>${esc(detail)}</small></span></div>
            <strong class="${tone}">${amount}</strong>
            ${badge}
            ${action}
          </div>
        `;
      })
      .join("");
  }

  function sessionCard(session) {
    const shares = session.shares || [];
    const parts = dateParts(session.date);
    const unpaid = shares.filter((share) => !share.paid).length;
    const isOpen = session.id === ledger.openSessionId;
    const badge = unpaid
      ? `<span class="badge badge-red">Còn ${unpaid} nợ</span>`
      : '<span class="badge badge-green">Đã thu đủ</span>';
    const extra = session.extraFee
      ? `<span>Phát sinh <b>${money(session.extraFee)}</b>${session.extraNote ? ` (${esc(session.extraNote)})` : ""}</span>`
      : "";
    const rows = shares
      .map(
        (share) => `
          <p>
            <span>${avatar(share.memberName, "sm")}${esc(share.memberName)} ${share.memberId ? "" : guestTag}</span>
            <b>${money(share.shareAmount)}</b>
            ${shareStatusHtml(share)}
          </p>
        `
      )
      .join("");
    const tools =
      ledger.role === "admin"
        ? `<div class="session-tools"><button type="button" class="btn btn-danger btn-sm" data-delete="${esc(session.id)}">${icon("trash", 16)}<span>Xóa buổi</span></button></div>`
        : "";
    return `
      <article class="${isOpen ? "open" : ""}${session.id === ledger.highlightId ? " is-fresh" : ""}" data-session="${esc(session.id)}">
        <button type="button" class="session-toggle" aria-expanded="${isOpen ? "true" : "false"}">
          <span class="date-box"><b>${esc(parts.day)}</b><small>THG ${esc(parts.month)}</small></span>
          <span><b>${esc(session.court)}</b><small>${shares.length} người · Sân ${money(session.courtFee)} · Cầu ${money(session.shuttleFee)}</small></span>
          <strong>${money(session.totalFee)}</strong>
          ${badge}
          ${icon("chevron", 18)}
        </button>
        <div class="session-splits">
          <div class="session-fees">
            <span>Tiền sân <b>${money(session.courtFee)}</b></span>
            <span>Tiền cầu <b>${money(session.shuttleFee)}</b></span>
            ${extra}
          </div>
          ${rows}
          ${tools}
        </div>
      </article>
    `;
  }

  function paintSessions() {
    const root = ledger.ledgerRoot;
    const list = q(root, "[data-sessions]");
    const monthKey = localToday().slice(0, 7);
    const inMonth = ledger.sessions.filter((session) => String(session.date || "").startsWith(monthKey)).length;
    q(root, "[data-session-meta]").textContent = `${ledger.sessions.length} buổi · ${inMonth} buổi trong tháng này`;
    if (!ledger.sessions.length) {
      list.innerHTML = `<div class="empty-card" style="border:0;border-radius:0">Khi admin lưu một buổi, sổ sẽ hiện theo ngày, sân và từng người.</div>`;
      return;
    }
    list.innerHTML = ledger.sessions.map(sessionCard).join("");
  }

  function myShares() {
    const nameCi = String(ledger.memberName || "").trim().toLowerCase();
    const rows = [];
    ledger.sessions.forEach((session) => {
      (session.shares || []).forEach((share) => {
        if (String(share.memberName || "").trim().toLowerCase() === nameCi) rows.push({ session, share });
      });
    });
    return rows;
  }

  function paintPersonal() {
    const root = ledger.ledgerRoot;
    const node = q(root, "[data-personal]");
    const rows = myShares();
    if (!rows.length) {
      node.outerHTML = `<div class="empty-card" data-personal>Chưa có buổi nào trong sổ của bạn.</div>`;
      return;
    }
    node.outerHTML = `<div class="ledger-list" data-personal>${rows
      .map(({ session, share }) => {
        const parts = dateParts(session.date);
        const extra = session.extraFee ? ` · PS ${money(session.extraFee)}` : "";
        return `
          <div class="ledger-item">
            <div class="date-tile"><b>${esc(parts.day)}</b><span>TH ${esc(parts.month)}</span></div>
            <div class="ledger-main">
              <b>${esc(session.court)}</b>
              <small>Sân ${money(session.courtFee)} · Cầu ${money(session.shuttleFee)}${extra} · ${(session.shares || []).length} người</small>
            </div>
            <div class="ledger-price">
              <b>${money(share.shareAmount)}</b>
              ${shareStatusHtml(share)}
            </div>
          </div>
        `;
      })
      .join("")}</div>`;
  }

  function paintLedger() {
    const root = ledger.ledgerRoot;
    if (!root) return;
    const mode = ledger.role === "admin" ? "admin" : ledger.role ? "personal" : "";
    if (!mode) return;
    if (ledger.ledgerMode !== mode) {
      root.innerHTML = mode === "admin" ? adminLedgerMarkup() : personalLedgerMarkup();
      ledger.ledgerMode = mode;
    }
    if (mode === "personal") {
      paintPersonal();
      return;
    }
    const people = personGroups();
    paintKpis(people);
    paintTotals(people);
    paintSessions();
  }

  // Nút cần bấm 2 lần (bấm lần 1 để "lên đạn", lần 2 để xác nhận).
  function armOnce(button, selector, idleLabel, armedLabel) {
    if (button.dataset.armed === "true") return true;
    ledger.ledgerRoot.querySelectorAll(selector).forEach((item) => {
      item.dataset.armed = "false";
      item.classList.remove("is-armed");
      const label = item.querySelector("span");
      if (label) label.textContent = idleLabel;
    });
    button.dataset.armed = "true";
    button.classList.add("is-armed");
    const label = button.querySelector("span");
    if (label) label.textContent = armedLabel;
    return false;
  }

  function bindLedger(root) {
    root.addEventListener("click", async (event) => {
      const errorNode = q(root, "[data-ledger-error]");
      const toggle = event.target.closest(".session-toggle");
      if (toggle) {
        const article = toggle.closest("article");
        const open = article.classList.toggle("open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        ledger.openSessionId = open ? article.dataset.session : "";
        return;
      }

      const filter = event.target.closest("[data-filter-value]");
      if (filter) {
        ledger.personFilter = filter.dataset.filterValue;
        paintTotals(personGroups());
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
          setNote(errorNode, error.message, true);
        }
        return;
      }

      const settle = event.target.closest("[data-settle-name]");
      if (settle) {
        if (!armOnce(settle, "[data-settle-name]", "Đã hoàn thành", "Bấm lần nữa để xác nhận")) return;
        settle.disabled = true;
        try {
          await api("/api/basic/people/paid", {
            method: "PATCH",
            body: { memberId: settle.dataset.settleId || "", memberName: settle.dataset.settleName || "" }
          });
          await load();
          ledger.onChange?.({ type: "settled", message: `Đã tất toán cho ${settle.dataset.settleName}` });
        } catch (error) {
          settle.disabled = false;
          setNote(errorNode, error.message, true);
        }
        return;
      }

      const remove = event.target.closest("[data-delete]");
      if (remove) {
        if (!armOnce(remove, "[data-delete]", "Xóa buổi", "Bấm lần nữa để xóa")) return;
        remove.disabled = true;
        try {
          await api(`/api/basic/sessions/${remove.dataset.delete}`, { method: "DELETE" });
          await load();
          ledger.onChange?.({ type: "deleted", message: "Đã xóa buổi" });
        } catch (error) {
          remove.disabled = false;
          setNote(errorNode, error.message, true);
        }
      }
    });
  }

  // ---------- API công khai ----------

  async function load() {
    const data = await api("/api/basic");
    ledger.role = data.role || "";
    ledger.memberName = data.memberName || "";
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
    hydrate(root);
    bindEntry(root);
    resetEntry();
  }

  function mountLedger(root) {
    if (!root || ledger.ledgerRoot === root) return;
    ledger.ledgerRoot = root;
    ledger.ledgerMode = "";
    root.innerHTML = "";
    bindLedger(root);
    paintLedger();
  }

  // Điền sẵn form nhập tiền từ một buổi vote đã chốt.
  function prefill({ date, court, memberIds, guestNames, voteSessionId, label }) {
    const form = q(ledger.entryRoot, "[data-ledger-form]");
    if (!form) return;
    resetEntry();
    if (date) form.date.value = date;
    if (court) form.court.value = court;
    const known = new Set(ledger.members.map((member) => member.memberId));
    (memberIds || []).forEach((id) => known.has(id) && ledger.selected.add(id));
    (guestNames || []).forEach((name) => addGuestName(name));
    ledger.voteSessionId = voteSessionId || "";
    ledger.voteLabel = label || "";
    paintVoteLink();
    paintMembers();
    paintGuests();
    paintPreview();
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
