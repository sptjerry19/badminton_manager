const state = {
  members: [],
  settings: null
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

function buildVietQrUrl(name, amount) {
  const safeAmount = Math.max(0, Math.round(Number(amount || 0)));
  const addInfo = encodeURIComponent(`Thu cong no cau long - ${name}`);
  const accountName = encodeURIComponent(VIETQR.accountName);
  return `https://img.vietqr.io/image/${VIETQR.bankBin}-${VIETQR.accountNo}-${VIETQR.template}.png?amount=${safeAmount}&addInfo=${addInfo}&accountName=${accountName}`;
}

function buildVietQrLink(name, balance) {
  if (Number(balance || 0) <= 0) return "-";
  const url = buildVietQrUrl(name, balance);
  return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline">Thanh toán</a>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Có lỗi xảy ra.");
  }
  return data;
}

function showLoginMode() {
  document.getElementById("loginSection").classList.remove("hidden");
  document.getElementById("appSection").classList.add("hidden");
}

function showAppMode() {
  document.getElementById("loginSection").classList.add("hidden");
  document.getElementById("appSection").classList.remove("hidden");
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
  row.querySelector(".guest-remove").addEventListener("click", () => row.remove());
  return row;
}

function renderFixedMembers() {
  const container = document.getElementById("fixedMembersContainer");
  container.innerHTML = "";
  const fixedMembers = state.members.filter((m) => m.active && m.type === "Cố định");
  fixedMembers.forEach((member) => {
    const id = `fixed_${member.name}`;
    const wrapper = document.createElement("label");
    wrapper.className = "flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2";
    wrapper.innerHTML = `
      <input id="${id}" type="checkbox" class="fixed-present h-4 w-4" checked />
      <span class="text-sm">${member.name}</span>
    `;
    wrapper.dataset.name = member.name;
    container.appendChild(wrapper);
  });
}

function renderDebts(debts) {
  const tbody = document.getElementById("debtTableBody");
  tbody.innerHTML = "";

  debts.forEach((row) => {
    const tr = document.createElement("tr");
    const balanceClass = row.balance > 0 ? "text-red-600" : row.balance < 0 ? "text-emerald-600" : "";
    const qrLinkHtml = buildVietQrLink(row.name, row.balance);
    tr.innerHTML = `
      <td class="border border-slate-200 px-2 py-1">${row.name}</td>
      <td class="border border-slate-200 px-2 py-1">${row.type}</td>
      <td class="border border-slate-200 px-2 py-1 text-right">${formatMoney(row.totalDue)}</td>
      <td class="border border-slate-200 px-2 py-1 text-right">${formatMoney(row.totalPaid)}</td>
      <td class="border border-slate-200 px-2 py-1 text-right font-medium ${balanceClass}">${formatMoney(row.balance)}</td>
      <td class="border border-slate-200 px-2 py-1 text-right font-medium">${qrLinkHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderSessionSummary(result) {
  const section = document.getElementById("summarySection");
  const info = document.getElementById("summaryInfo");
  const tbody = document.getElementById("summaryParticipants");

  section.classList.remove("hidden");
  info.innerHTML = `
    <div class="rounded-lg bg-slate-100 p-2"><div class="text-xs text-slate-500">Tổng chi</div><div class="font-semibold">${formatMoney(result.totalCost)}</div></div>
    <div class="rounded-lg bg-slate-100 p-2"><div class="text-xs text-slate-500">Tổng người</div><div class="font-semibold">${result.totalPeople}</div></div>
    <div class="rounded-lg bg-slate-100 p-2"><div class="text-xs text-slate-500">Tổng thu</div><div class="font-semibold">${formatMoney(result.totalCollected)}</div></div>
    <div class="rounded-lg bg-slate-100 p-2"><div class="text-xs text-slate-500">Chế độ</div><div class="font-semibold">${result.mode === "GL_RIENG" ? "GL riêng (>12)" : "Chia đều"}</div></div>
  `;

  tbody.innerHTML = "";
  result.participants
    .filter((p) => p.present || p.type === "GL")
    .forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="border border-slate-200 px-2 py-1">${p.name}</td>
        <td class="border border-slate-200 px-2 py-1">${p.type}</td>
        <td class="border border-slate-200 px-2 py-1">${p.gender || "-"}</td>
        <td class="border border-slate-200 px-2 py-1 text-right">${formatMoney(p.amount)}</td>
      `;
      tbody.appendChild(tr);
    });
}

function collectSessionPayload() {
  const fixedMembers = [];
  document.querySelectorAll("#fixedMembersContainer label").forEach((label) => {
    const name = label.dataset.name;
    const present = label.querySelector("input").checked;
    fixedMembers.push({ name, present });
  });

  const guests = [];
  document.querySelectorAll("#guestContainer > div").forEach((row) => {
    const name = row.querySelector(".guest-name").value.trim();
    const gender = row.querySelector(".guest-gender").value;
    if (name) guests.push({ name, gender });
  });

  return {
    date: document.getElementById("dateInput").value,
    fixedCourtCost: Number(document.getElementById("fixedCourtCostInput").value || 0),
    extraCourts: Number(document.getElementById("extraCourtsInput").value || 0),
    shuttlecockCost: Number(document.getElementById("shuttlecockCostInput").value || 0),
    fixedMembers,
    guests
  };
}

async function loadDashboard() {
  const data = await api("/api/bootstrap");
  state.members = data.members || [];
  state.settings = data.settings || null;

  renderFixedMembers();
  renderDebts(data.debts || []);

  document.getElementById("dateInput").value = new Date().toISOString().slice(0, 10);
  document.getElementById("paymentDateInput").value = new Date().toISOString().slice(0, 10);
}

async function refreshDebts() {
  const { debts } = await api("/api/debts");
  renderDebts(debts || []);
}

function bindEvents() {
  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorEl = document.getElementById("loginError");
    errorEl.classList.add("hidden");
    try {
      const password = document.getElementById("passwordInput").value;
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ password })
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

  document.getElementById("addGuestBtn").addEventListener("click", () => {
    document.getElementById("guestContainer").appendChild(createGuestRow());
  });

  document.getElementById("sessionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const messageEl = document.getElementById("formMessage");
    messageEl.textContent = "Đang xử lý...";
    messageEl.className = "text-sm text-slate-500";
    try {
      const payload = collectSessionPayload();
      const response = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      renderSessionSummary(response.result);
      await refreshDebts();
      messageEl.textContent = response.message;
      messageEl.className = "text-sm text-emerald-600";
    } catch (error) {
      messageEl.textContent = error.message;
      messageEl.className = "text-sm text-red-600";
    }
  });

  document.getElementById("paymentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const msgEl = document.getElementById("paymentMessage");
    msgEl.textContent = "Đang lưu...";
    msgEl.className = "text-sm text-slate-500";
    try {
      await api("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          date: document.getElementById("paymentDateInput").value,
          name: document.getElementById("paymentNameInput").value.trim(),
          amount: Number(document.getElementById("paymentAmountInput").value || 0),
          note: document.getElementById("paymentNoteInput").value.trim()
        })
      });
      await refreshDebts();
      msgEl.textContent = "Đã ghi nhận thanh toán.";
      msgEl.className = "text-sm text-emerald-600";
      document.getElementById("paymentAmountInput").value = "";
      document.getElementById("paymentNoteInput").value = "";
    } catch (error) {
      msgEl.textContent = error.message;
      msgEl.className = "text-sm text-red-600";
    }
  });
}

async function init() {
  bindEvents();
  try {
    await loadDashboard();
    showAppMode();
  } catch (_error) {
    showLoginMode();
  }
}

init();
