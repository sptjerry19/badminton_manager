/* Member theme preferences. Runs in <head> before styles; no API/database dependency. */
(function (root) {
  "use strict";
  const doc = root.document;
  const SEASON_KEY = "member-theme";
  const MODE_KEY = "theme"; // Preserve the existing light/dark preference.
  const catalog = [
    {
      "id": "default",
      "label": "Mặc định",
      "subtitle": "Xanh sân cầu",
      "colors": [
        "#12804b",
        "#f4c74b",
        "#edf3ef"
      ],
      "chrome": [
        "#12804b",
        "#09160f"
      ]
    },
    {
      "id": "halloween",
      "label": "Halloween",
      "subtitle": "31/10 · Cam bí ngô",
      "banner": "HALLOWEEN · 31/10",
      "caption": "Lên sân, vui hết mình.",
      "colors": [
        "#151215",
        "#f88d3a",
        "#fff2dc"
      ],
      "chrome": [
        "#fff6ea",
        "#151215"
      ]
    },
    {
      "id": "womens-day",
      "label": "Phụ nữ Việt Nam",
      "subtitle": "20/10 · Hồng hoa",
      "banner": "PHỤ NỮ VIỆT NAM · 20/10",
      "caption": "Rạng rỡ trên từng đường cầu.",
      "colors": [
        "#6b203a",
        "#ba4d6a",
        "#fff5ef"
      ],
      "chrome": [
        "#fff5f0",
        "#21141c"
      ]
    },
    {
      "id": "teachers-day",
      "label": "Nhà giáo Việt Nam",
      "subtitle": "20/11 · Xanh bảng",
      "banner": "NHÀ GIÁO VIỆT NAM · 20/11",
      "caption": "Tri ân người truyền cảm hứng.",
      "colors": [
        "#104536",
        "#c49a48",
        "#faf4e6"
      ],
      "chrome": [
        "#104536",
        "#0c211c"
      ]
    },
    {
      "id": "mens-day",
      "label": "Ngày của phái mạnh",
      "subtitle": "06/04 · Navy và đồng",
      "banner": "NGÀY CỦA PHÁI MẠNH · 06/04",
      "caption": "Bản lĩnh trên sân, hết mình cùng đội.",
      "colors": [
        "#12324b",
        "#c29160",
        "#edf3f7"
      ],
      "chrome": [
        "#edf3f7",
        "#0c1928"
      ]
    },
    {
      "id": "christmas",
      "label": "Giáng sinh",
      "subtitle": "24–25/12 · Xanh thông",
      "banner": "GIÁNG SINH · 24–25/12",
      "caption": "Ấm áp mùa lễ, rộn ràng sân cầu.",
      "colors": [
        "#104d3b",
        "#b72c40",
        "#faf4e9"
      ],
      "chrome": [
        "#104d3b",
        "#0c241e"
      ]
    },
    {
      "id": "tet",
      "label": "Tết Nguyên Đán",
      "subtitle": "Mừng xuân mới",
      "banner": "TẾT NGUYÊN ĐÁN",
      "caption": "Khai sân đầu xuân, đón lộc cả năm.",
      "colors": [
        "#ab1720",
        "#d5a64f",
        "#fff3df"
      ],
      "chrome": [
        "#fff3df",
        "#281316"
      ]
    },
    {
      "id": "reunification",
      "label": "30/4 – 1/5",
      "subtitle": "Mừng ngày thống nhất",
      "banner": "MỪNG NGÀY THỐNG NHẤT · 30/4–1/5",
      "caption": "Chung niềm vui, cùng ra sân.",
      "colors": [
        "#b21e2b",
        "#f2c64f",
        "#fff8ed"
      ],
      "chrome": [
        "#b21e2b",
        "#29151a"
      ]
    },
    {
      "id": "national-day",
      "label": "Quốc khánh",
      "subtitle": "02/09 · Tự hào Việt Nam",
      "banner": "QUỐC KHÁNH · 02/09",
      "caption": "Tự hào Việt Nam, gắn kết trên sân.",
      "colors": [
        "#9d1c2c",
        "#d0a14d",
        "#faf5e9"
      ],
      "chrome": [
        "#faf5e9",
        "#26141a"
      ]
    }
  ];
  const themes = new Map(catalog.map(theme => [theme.id, theme]));
  const modes = new Set(["light", "dark", "system"]);
  const media = root.matchMedia("(prefers-color-scheme: dark)");
  let season = "default";
  let mode = "system";
  let view = "login";
  let mounted = false;

  function read(key) {
    try { return root.localStorage.getItem(key); } catch (_) { return null; }
  }
  function write(key, value) {
    try { root.localStorage.setItem(key, value); } catch (_) { /* In-memory choice still works. */ }
  }
  function restore() {
    const savedSeason = read(SEASON_KEY);
    const savedMode = read(MODE_KEY);
    season = themes.has(savedSeason) ? savedSeason : "default";
    mode = modes.has(savedMode) ? savedMode : "system";
  }
  function isDark() { return mode === "dark" || (mode === "system" && media.matches); }
  function state() { return { season, mode, view, dark: isDark() }; }

  function paint() {
    const member = view === "member";
    doc.querySelectorAll("[data-member-only]").forEach(el => { el.hidden = !member; });
    const theme = themes.get(season);
    doc.querySelectorAll("[data-season-banner]").forEach(el => { el.hidden = !member || !theme.banner; });
    doc.querySelectorAll("[data-season-label]").forEach(el => { el.textContent = theme.banner || ""; });
    doc.querySelectorAll("[data-season-caption]").forEach(el => { el.textContent = theme.caption || ""; });
    doc.querySelectorAll("[data-member-theme-choice]").forEach(input => { input.checked = input.value === season; });
    doc.querySelectorAll("[data-color-mode-choice]").forEach(input => { input.checked = input.value === mode; });
    doc.querySelectorAll("[data-theme-toggle]").forEach(button => {
      button.setAttribute("aria-label", isDark() ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối");
      if (root.UI && button.classList.contains("icon-btn")) button.innerHTML = root.UI.icon(isDark() ? "sun" : "moon");
    });
  }
  function apply() {
    const html = doc.documentElement;
    html.classList.toggle("dark", isDark());
    html.dataset.memberTheme = season;
    html.dataset.appView = view;
    const theme = themes.get(view === "member" ? season : "default");
    html.dataset.seasonal = String(view === "member" && Boolean(theme.banner));
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme.chrome[isDark() ? 1 : 0]);
    if (mounted) paint();
  }
  function notify() {
    apply();
    doc.dispatchEvent(new root.CustomEvent("app-theme-change", { detail: state() }));
  }
  function setSeason(value) {
    season = themes.has(value) ? value : "default";
    write(SEASON_KEY, season);
    notify();
  }
  function setMode(value) {
    mode = modes.has(value) ? value : "system";
    write(MODE_KEY, mode);
    notify();
  }
  function setView(value) {
    view = value === "member" || value === "admin" ? value : "login";
    apply();
  }
  function toggle() { setMode(isDark() ? "light" : "dark"); }
  function renderChoices() {
    doc.querySelectorAll("[data-member-theme-options]").forEach(container => {
      const fragment = doc.createDocumentFragment();
      catalog.forEach(theme => {
        const label = doc.createElement("label");
        label.className = "theme-option";
        const input = doc.createElement("input");
        input.type = "radio";
        input.name = "memberTheme";
        input.value = theme.id;
        input.dataset.memberThemeChoice = "";
        const content = doc.createElement("span");
        content.className = "theme-option-content";
        const swatch = doc.createElement("span");
        swatch.className = "theme-swatch";
        swatch.setAttribute("aria-hidden", "true");
        theme.colors.forEach(color => {
          const dot = doc.createElement("i");
          dot.style.backgroundColor = color;
          swatch.append(dot);
        });
        const title = doc.createElement("b");
        title.textContent = theme.label;
        const subtitle = doc.createElement("small");
        subtitle.textContent = theme.subtitle;
        content.append(swatch, title, subtitle);
        label.append(input, content);
        fragment.append(label);
      });
      container.replaceChildren(fragment);
    });
  }
  function revealChoice() {
    doc.querySelectorAll("[data-member-theme-options]").forEach(container => {
      const selected = container.querySelector("input:checked");
      if (selected && container.clientHeight) {
        container.scrollTop = selected.parentElement.offsetTop - container.clientHeight / 2 + selected.parentElement.offsetHeight / 2;
      }
    });
  }
  function mount() {
    if (mounted) return;
    renderChoices();
    mounted = true;
    doc.querySelectorAll("[data-theme-toggle]").forEach(button => button.addEventListener("click", toggle));
    doc.querySelectorAll("[data-member-theme-choice]").forEach(input => input.addEventListener("change", () => {
      if (input.checked) setSeason(input.value);
    }));
    doc.querySelectorAll("[data-color-mode-choice]").forEach(input => input.addEventListener("change", () => {
      if (input.checked) setMode(input.value);
    }));
    doc.querySelectorAll("[data-open-account]").forEach(button => button.addEventListener("click", () => {
      root.requestAnimationFrame(revealChoice);
    }));
    paint();
  }
  restore();
  apply();
  media.addEventListener("change", () => { if (mode === "system") notify(); });
  root.addEventListener("storage", event => {
    if (event.key === MODE_KEY || event.key === SEASON_KEY || event.key === null) { restore(); notify(); }
  });
  root.AppTheme = Object.freeze({ mount, setView, setSeason, setMode, toggle, state });
})(window);
