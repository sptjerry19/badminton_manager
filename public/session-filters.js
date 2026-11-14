(function () {
  const esc = window.UI.esc;
  const normalize = (value) => String(value || "").trim().toLocaleLowerCase("vi");

  window.SessionFilters = {
    mount(root, { members = [], personal = false, onChange }) {
      const names = [...new Set(members.map((member) => member.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
      const options = `<option value="">Tất cả buổi đánh</option>` + (personal
        ? '<option value="mine">Buổi đánh của tôi</option>'
        : names.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join(""));
      if (root.sessionFilter) {
        if (root.sessionFilter.options !== options) {
          const select = root.querySelector("select");
          select.innerHTML = options;
          select.value = root.sessionFilter.member;
          root.sessionFilter.member = select.value;
          root.sessionFilter.options = options;
        }
        return root.sessionFilter;
      }
      const filter = { from: "", to: "", member: "", options };
      root.innerHTML = `<div class="session-filters">
        <label class="field"><span>Từ ngày</span><input type="date" data-session-filter="from" /></label>
        <label class="field"><span>Đến ngày</span><input type="date" data-session-filter="to" /></label>
        <label class="field filter-member"><span>${personal ? "Buổi đánh" : "Thành viên"}</span><select data-session-filter="member">
          ${options}
        </select></label>
        <button type="button" class="btn btn-ghost" data-reset-sessions>Xóa bộ lọc</button>
      </div><p class="form-note is-error" data-filter-error hidden>Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>`;
      filter.matchesDate = (date) => (!filter.from || date >= filter.from) && (!filter.to || date <= filter.to);
      filter.matchesName = (name) => !filter.member || normalize(name) === normalize(filter.member);
      root.addEventListener("change", (event) => {
        const key = event.target.dataset.sessionFilter;
        if (!key) return;
        filter[key] = event.target.value;
        root.querySelector('[data-session-filter="from"]').max = filter.to;
        root.querySelector('[data-session-filter="to"]').min = filter.from;
        root.querySelector("[data-filter-error]").hidden = !(filter.from && filter.to && filter.from > filter.to);
        onChange();
      });
      root.querySelector("[data-reset-sessions]").addEventListener("click", () => {
        filter.from = filter.to = filter.member = "";
        root.querySelectorAll("input, select").forEach((input) => { input.value = ""; input.removeAttribute("min"); input.removeAttribute("max"); });
        root.querySelector("[data-filter-error]").hidden = true;
        onChange();
      });
      root.sessionFilter = filter;
      return filter;
    }
  };
})();
