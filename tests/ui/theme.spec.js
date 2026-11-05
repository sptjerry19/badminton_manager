"use strict";
const { test, expect } = require("@playwright/test");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

let server, origin;
const publicDir = path.resolve(__dirname, "../../public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".json": "application/json" };
test.beforeAll(async () => {
  // Static app only. Never start server.js or read .env / a real database.
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = path.resolve(publicDir, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(publicDir + path.sep)) { res.writeHead(403).end(); return; }
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }).end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

async function app(page, { season, mode, role = "user", blockedStorage = false, debt = true, schedule = [], scheduleNow, scheduleFailure = false, scheduleOverride = {}, scheduleGate } = {}) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ season, mode, blockedStorage }) => {
    if (!sessionStorage.getItem("theme-test-initialized")) {
      if (season !== undefined) localStorage.setItem("member-theme", season);
      if (mode !== undefined) localStorage.setItem("theme", mode);
      sessionStorage.setItem("theme-test-initialized", "1");
    }
    if (blockedStorage) Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage disabled"); } });
  }, { season, mode, blockedStorage });
  let loggedIn = Boolean(role);
  let picked = "pending";
  const members = [{ memberId: "demo-linh", name: "Linh", active: true, level: 5, status: "yes" }, { memberId: "demo-an", name: "An", active: true, level: 5, status: "yes" }];
  const vote = () => ({ sessionId: "vote-demo", date: "2026-11-07", time: "18:00–20:00", location: "Sân cầu lông Demo", voteStatus: "open", myStatus: picked, members, guests: [] });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      if (url.hostname === "img.vietqr.io") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/><text x="15" y="50">QR test</text></svg>' });
      return route.abort(); // No third-party / production traffic, including fonts and push.
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let data;
    switch (url.pathname) {
      case "/api/theme-config":
        if (scheduleGate) await scheduleGate;
        const failure = typeof scheduleFailure === "function" ? scheduleFailure() : scheduleFailure;
        if (failure === "timeout") return;
        if (failure) return route.abort();
        data = {
          version: 1, timeZone: "Asia/Ho_Chi_Minh", configValid: true,
          serverNow: (typeof scheduleNow === "function" ? scheduleNow() : scheduleNow) || new Date().toISOString(),
          schedules: typeof schedule === "function" ? schedule() : schedule,
          ...scheduleOverride,
        }; break;
      case "/api/tournament/login-options":
      case "/api/login-options": data = { members }; break;
      case "/api/bootstrap":
        if (!loggedIn) return route.fulfill({ status: 401, json: { message: "Chưa đăng nhập" } });
        data = { auth: { role, memberName: "Linh", memberId: "demo-linh" }, members, sessions: [], voteSessions: [vote()] }; break;
      case "/api/basic":
        data = { role, memberName: "Linh", members, credits: [], sessions: [{ sessionId: "ledger-demo", date: "2026-11-01", court: "Sân cầu lông Demo", courtFee: 240000, shuttleFee: 0, extraFee: 0, shares: [{ shareId: "share-demo", memberId: "demo-linh", memberName: "Linh", shareAmount: 120000, paid: !debt }] }] }; break;
      case "/api/notices": data = { notices: [{ id: "notice-demo", noticeId: "notice-demo", content: "Hẹn cả nhóm ra sân cuối tuần!", createdAt: "2026-11-05T10:00:00Z" }] }; break;
      case "/api/push/config": data = {}; break;
      case "/api/tournament/bootstrap":
        data = { auth: { role, memberName: "Linh" }, role, memberName: "Linh", players: [], events: [], pairs: [], matches: [], standings: [], settings: {}, tournaments: [] }; break;
      case "/api/sessions/vote-demo/respond": picked = JSON.parse(route.request().postData()).status; data = {}; break;
      case "/api/logout": loggedIn = false; data = {}; break;
      default: return route.fulfill({ status: 500, json: { message: "Unmocked API: " + url.pathname } });
    }
    return route.fulfill({ json: data });
  });
  await page.goto(origin);
  await expect(page.locator(role ? "#appSection" : "#loginSection")).toBeVisible();
  await expect(page.locator("#loadingModal")).toBeHidden();
  return errors;
}
async function preferences(page) {
  await page.locator("#userSection [data-open-account]").click();
  await expect(page.locator("#accountModal")).toBeVisible();
}
async function closePreferences(page) {
  await page.locator("#accountModal [data-close-modal]").click();
}
async function palette(page) {
  return page.locator("body").evaluate(el => ({
    background: getComputedStyle(el).backgroundColor,
    accent: getComputedStyle(el).getPropertyValue("--accent-700").trim(),
    status: getComputedStyle(el).getPropertyValue("--green-ink").trim(),
  }));
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function contrast(page, selector) {
  return page.locator(selector).first().evaluate(el => {
    const c = getComputedStyle(el);
    const luminance = rgb => {
      const values = rgb.match(/[\d.]+/g).slice(0, 3).map(v => +v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
    };
    let background = c.backgroundColor;
    let parent = el.parentElement;
    while ((background === "rgba(0, 0, 0, 0)" || background === "transparent") && parent) {
      background = getComputedStyle(parent).backgroundColor;
      parent = parent.parentElement;
    }
    const a = luminance(c.color), b = luminance(background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
}

test("Theme choice persists; brightness remains independent; default can be restored", async ({ page }) => {
  const errors = await app(page, { mode: "dark" });
  await preferences(page);
  await page.getByLabel("Halloween", { exact: false }).check();
  await expect(page.locator("html")).toHaveAttribute("data-member-theme", "halloween");
  await expect(page.locator("html")).toHaveClass("dark");
  await closePreferences(page);
  await expect(page.locator("[data-season-banner]")).toBeVisible();
  await page.reload();
  await expect(page.locator("#userSection")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-member-theme", "halloween");
  await expect(page.locator("html")).toHaveClass("dark");
  await page.locator("#userSection [data-theme-toggle]").click();
  await expect(page.locator("html")).not.toHaveClass("dark");
  await expect(page.locator("html")).toHaveAttribute("data-member-theme", "halloween");
  await preferences(page);
  await page.getByLabel("Mặc định", { exact: false }).check();
  await closePreferences(page);
  await expect(page.locator("[data-season-banner]")).toBeHidden();
  expect((await palette(page)).accent).toBe("#12804b");
  expect(errors).toEqual([]);
});

test("System brightness follows device; explicit choice overrides it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await app(page, { season: "halloween" });
  await expect(page.locator("html")).not.toHaveClass("dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass("dark");
  await preferences(page);
  await page.getByRole("radio", { name: "Sáng", exact: true }).check();
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).not.toHaveClass("dark");
  await page.getByRole("radio", { name: "Theo thiết bị" }).check();
  await expect(page.locator("html")).toHaveClass("dark");
});

test("Legacy brightness and invalid seasonal preference recover safely", async ({ page }) => {
  await app(page, { mode: "light", season: "invalid-theme" });
  await expect(page.locator("html")).toHaveAttribute("data-member-theme", "default");
  await expect(page.locator("html")).not.toHaveClass("dark");

});
test("Invalid brightness uses system preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const errors = await app(page, { season: "invalid", mode: "invalid" });
  await expect(page.locator("html")).toHaveAttribute("data-member-theme", "default");
  await expect(page.locator("html")).toHaveClass("dark");
  expect(errors).toEqual([]);
});
test("Unavailable storage still allows changing theme for this visit", async ({ page }) => {
  const errors = await app(page, { blockedStorage: true });
  await preferences(page);
  await page.getByLabel("Halloween", { exact: false }).check();
  await page.getByRole("radio", { name: "Tối", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-member-theme", "halloween");
  await expect(page.locator("html")).toHaveClass("dark");
  expect(errors).toEqual([]);
});

test("Stored seasonal themes do not recolor login or admin", async ({ page }) => {
  const errors = await app(page, { season: "halloween", mode: "light", role: "admin" });
  await expect(page.locator("html")).toHaveAttribute("data-app-view", "admin");
  expect((await palette(page)).accent).toBe("#12804b");
  for (const id of ["halloween", "womens-day", "teachers-day", "mens-day", "christmas", "tet", "reunification", "national-day"]) {
    await page.evaluate(id => window.AppTheme.setSeason(id), id);
    expect((await palette(page)).accent).toBe("#12804b");
    await expect(page.locator("[data-season-banner]")).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute("data-seasonal", "false");
  }
  await page.locator("#adminSection .avatar-button[data-open-account]").click();
  await expect(page.locator("[data-member-only]:visible")).toHaveCount(0);
  await page.locator("#logoutBtn").click();
  await expect(page.locator("#loginSection")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-app-view", "login");
  expect((await palette(page)).accent).toBe("#12804b");
  expect(errors).toEqual([]);
});

const seasonalThemes = [
  { id: "halloween", label: "Halloween", banner: "HALLOWEEN · 31/10" },
  { id: "womens-day", label: "Phụ nữ Việt Nam", banner: "PHỤ NỮ VIỆT NAM · 20/10" },
  { id: "teachers-day", label: "Nhà giáo Việt Nam", banner: "NHÀ GIÁO VIỆT NAM · 20/11" },
  { id: "mens-day", label: "Ngày của phái mạnh", banner: "NGÀY CỦA PHÁI MẠNH · 06/04" },
  { id: "christmas", label: "Giáng sinh", banner: "GIÁNG SINH · 24–25/12" },
  { id: "tet", label: "Tết Nguyên Đán", banner: "TẾT NGUYÊN ĐÁN" },
  { id: "reunification", label: "30/4 – 1/5", banner: "MỪNG NGÀY THỐNG NHẤT · 30/4–1/5" },
  { id: "national-day", label: "Quốc khánh", banner: "QUỐC KHÁNH · 02/09" },
];
for (const theme of seasonalThemes) {
for (const mode of ["light", "dark"]) {
  test(theme.id + " " + mode + ": readable controls, QR, vote, tabs and mobile widths", async ({ page }) => {
    const failedAssets = [];
    page.on("response", response => {
      if (response.url().includes("/themes/") && !response.ok()) failedAssets.push(response.url());
    });
    const errors = await app(page, { season: theme.id, mode });
    await expect(page.locator("[data-season-banner]")).toBeVisible();
    await expect(page.locator("[data-season-label]")).toHaveText(theme.banner);
    expect(await page.locator(".member-season-banner").evaluate(el => getComputedStyle(el).backgroundImage)).toContain(theme.id + "-header.svg");
    await expect.poll(() => contrast(page, "#userHeaderTitle")).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("[data-debt-amount]")).toContainText("120.000");
    await expect(page.locator("[data-debt-badge]")).toHaveClass(/badge-red/);
    await page.locator('.vote-yes').click();
    await expect(page.locator(".vote-yes")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => contrast(page, ".vote-yes")).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page, "#openQrBtn")).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page, "[data-debt-badge]")).toBeGreaterThanOrEqual(4.5);
    for (const width of [320, 375, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page);
      await preferences(page);
      await noOverflow(page);
      await expect(page.locator("[data-member-theme-choice]")).toHaveCount(10);
      await closePreferences(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#openQrBtn").click();
    await expect(page.locator("#qrModal")).toBeVisible();
    await expect(page.locator("#qrAmount")).toHaveText("120.000đ");
    await page.locator("#qrCloseBtn").click();
    await page.locator("#userTabRankingBtn").click();
    await expect(page.locator("#userRankingTabContent")).toBeVisible();
    await page.locator("#userTabNoticeBtn").click();
    await expect(page.locator("#userNoticeList")).toContainText("Hẹn cả nhóm");
    await page.locator("#userTabTournamentBtn").click();
    await expect(page.locator("#tpProfileGate")).toBeVisible();
    await expect(page.locator("#loadingModal")).toBeHidden();
    await page.locator("#tpProfileEvents").getByText("Đôi nam", { exact: true }).click();
    await expect.poll(() => contrast(page, ".tp-event-option input:checked + .tp-event-option-ui .tp-event-option-text")).toBeGreaterThanOrEqual(4.5);
    await page.locator("#userTabHomeBtn").click();
    await expect(page.locator("#loadingModal")).toBeHidden();
    await page.screenshot({ path: "test-results/" + theme.id + "-" + mode + ".png", animations: "disabled" });
    await preferences(page);
    if (theme.id === "halloween" || theme.id === "national-day") {
      await page.screenshot({ path: "test-results/" + theme.id + "-preferences-" + mode + ".png", animations: "disabled" });
    }
    expect(failedAssets).toEqual([]);
    expect(errors).toEqual([]);
  });
}
}

test("Paid status remains green in Halloween", async ({ page }) => {
  await app(page, { season: "halloween", mode: "dark", debt: false });
  await expect(page.locator("[data-debt-badge]")).toHaveClass(/badge-green/);
  expect(await contrast(page, "[data-debt-badge]")).toBeGreaterThanOrEqual(4.5);
  expect((await palette(page)).status).toBe("#7cdea9");
});

test("Theme preferences support keyboard selection", async ({ page }) => {
  await app(page);
  await preferences(page);
  const first = page.getByLabel("Mặc định", { exact: false });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Halloween", { exact: false })).toBeChecked();
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("[data-color-mode-choice]:checked")).toHaveCount(1);
});

test("Preferences update across tabs", async ({ page, context }) => {
  await app(page, { mode: "light" });
  const other = await context.newPage();
  await other.goto(origin + "/theme.js"); // Same origin; no app init script reload side effects.
  await other.evaluate(() => {
    localStorage.setItem("member-theme", "halloween");
    localStorage.setItem("theme", "dark");
  });
  await expect(page.locator("html")).toHaveAttribute("data-member-theme", "halloween");
  await expect(page.locator("html")).toHaveClass("dark");
  await other.evaluate(() => { localStorage.setItem("member-theme", "auto"); });
  await expect(page.locator("html")).toHaveAttribute("data-theme-selection", "auto");
  await expect(page.locator("html")).toHaveAttribute("data-member-theme", "default");
});

test("All theme choices can be reached, persisted and reopened in the compact picker", async ({ page }) => {
  await app(page, { mode: "dark" });
  for (const theme of seasonalThemes) {
    await preferences(page);
    await page.getByRole("radio", { name: theme.label, exact: false }).check();
    await closePreferences(page);
    await expect(page.locator("[data-season-label]")).toHaveText(theme.banner);
    await page.reload();
    await expect(page.locator("#userSection")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", theme.id);
    await expect(page.locator("html")).toHaveClass("dark");
    await preferences(page);
    const choice = page.locator("[data-member-theme-choice][value='" + theme.id + "']");
    await expect(choice).toBeChecked();
    await expect(choice).toBeInViewport();
    await closePreferences(page);
  }
});

test("Paid status remains green across all themes in light and dark", async ({ page }) => {
  const errors = await app(page, { debt: false });
  for (const theme of seasonalThemes) {
    for (const mode of ["light", "dark"]) {
      await page.evaluate(({ id, mode }) => {
        window.AppTheme.setSeason(id);
        window.AppTheme.setMode(mode);
      }, { id: theme.id, mode });
      await expect(page.locator("[data-debt-badge]")).toHaveClass(/badge-green/);
      expect(await contrast(page, "[data-debt-badge]")).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(errors).toEqual([]);
});

test("Seasonal headings, body text and debt amounts keep readable contrast", async ({ page }) => {
  await app(page);
  for (const theme of seasonalThemes) {
    for (const mode of ["light", "dark"]) {
      await page.evaluate(({ id, mode }) => {
        window.AppTheme.setSeason(id);
        window.AppTheme.setMode(mode);
      }, { id: theme.id, mode });
      await expect.poll(() => contrast(page, ".section-title")).toBeGreaterThanOrEqual(4.5);
      const debtContrast = await page.locator("#myDebtCard").evaluate(el => {
        const style = getComputedStyle(el);
        const l = hex => {
          const c = hex.trim().replace("#", "").match(/.{2}/g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
          return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
        };
        const ratio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        const ends = ["--balance-start", "--balance-end"].map(key => l(style.getPropertyValue(key)));
        return Math.min(...["--balance-ink", "--balance-meta"].flatMap(key => ends.map(end => ratio(l(style.getPropertyValue(key)), end))));
      });
      expect(debtContrast, theme.id + " " + mode + " debt text").toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("Reduced motion is respected by the theme picker", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await app(page, { season: "tet", mode: "dark" });
  await preferences(page);
  await page.getByRole("radio", { name: "Quốc khánh" }).check();
  const durations = await page.locator("#accountModal .bottom-sheet").evaluate(el => ({
    animation: getComputedStyle(el).animationName,
    transition: getComputedStyle(document.body).transitionDuration,
  }));
  expect(durations.animation).toBe("none");
  expect(durations.transition).toBe("0s");
});

const novemberSchedule = [
  { id: "halloween", start: "10-24", end: "11-10" },
  { id: "teachers-day", start: "11-10", end: "12-01" },
];
test.describe("Automatic Vietnam calendar", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("New visitor follows the Vietnam calendar even with a wrong device date and foreign timezone", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2035-06-01T00:00:00Z"));
    const errors = await app(page, { mode: "dark", schedule: novemberSchedule, scheduleNow: "2026-11-09T17:00:00.000Z" });
    await expect(page.locator("html")).toHaveAttribute("data-theme-selection", "auto");
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "teachers-day");
    await preferences(page);
    await expect(page.getByRole("radio", { name: "Tự động theo lịch" })).toBeChecked();
    await expect(page.locator("[data-theme-schedule-status]")).toContainText("Nhà giáo Việt Nam");
    await page.screenshot({ path: "test-results/automatic-vietnam-calendar.png", animations: "disabled" });
    expect(errors).toEqual([]);
  });

  test("The app waits for initial schedule before revealing the member screen", async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const opening = app(page, { schedule: novemberSchedule, scheduleNow: "2026-11-15T00:00:00.000Z", scheduleGate: gate });
    await expect(page.locator("#userSection")).toBeAttached();
    await expect(page.locator("#appSection")).toBeHidden();
    release();
    await opening;
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "teachers-day");
  });

  test("The page switches at Vietnam midnight without reloading", async ({ page }) => {
    const start = new Date("2026-11-09T16:59:00Z");
    await page.clock.install({ time: start });
    await app(page, { schedule: novemberSchedule, scheduleNow: start.toISOString() });
    await page.clock.pauseAt("2026-11-09T16:59:10Z");
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "halloween");
    await page.clock.runFor(61000);
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "teachers-day");
    await expect(page.locator("html")).toHaveAttribute("data-theme-selection", "auto");
  });

  test("Manual choice survives midnight and reload; choosing Auto resumes the group calendar", async ({ page }) => {
    await app(page, { season: "christmas", mode: "light", schedule: novemberSchedule, scheduleNow: "2026-11-15T00:00:00.000Z" });
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "christmas");
    await page.reload();
    await expect(page.locator("#userSection")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "christmas");
    await preferences(page);
    await page.getByRole("radio", { name: "Tự động theo lịch" }).check();
    await closePreferences(page);
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "teachers-day");
    await page.reload();
    await expect(page.locator("#userSection")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme-selection", "auto");
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "teachers-day");
    await expect(page.locator("html")).not.toHaveClass("dark");
  });

  test("A manual theme is not replaced by a midnight boundary", async ({ page }) => {
    const start = new Date("2026-11-09T16:59:00Z");
    await page.clock.install({ time: start });
    await app(page, { season: "tet", schedule: novemberSchedule, scheduleNow: start.toISOString() });
    await page.clock.pauseAt("2026-11-09T16:59:10Z");
    await page.clock.runFor(61000);
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "tet");
    await preferences(page);
    await page.getByRole("radio", { name: "Tự động theo lịch" }).check();
    await closePreferences(page);
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "teachers-day");
  });

  test("Visible tabs refresh env schedules periodically and preserve manual overrides", async ({ page }) => {
    const start = new Date("2026-11-05T00:00:00Z");
    let configured = novemberSchedule;
    await page.clock.install({ time: start });
    await app(page, { schedule: () => configured, scheduleNow: start.toISOString() });
    await page.clock.pauseAt("2026-11-05T00:00:10Z");
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "halloween");
    configured = [{ id: "national-day", start: "11-01", end: "12-01" }];
    // Stop just after the 5-minute poll so virtual time cannot expire the HTTP timeout before routing completes.
    await page.clock.runFor(291000);
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "national-day");
    await page.evaluate(() => window.AppTheme.setSeason("tet"));
    configured = novemberSchedule;
    await page.clock.runFor(300001);
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "tet");
  });


  test("Returning to a tab refreshes changed schedules before the next periodic poll", async ({ page }) => {
    const start = new Date("2026-11-05T00:00:00Z");
    let configured = novemberSchedule;
    await page.clock.install({ time: start });
    await app(page, { schedule: () => configured, scheduleNow: start.toISOString() });
    await page.clock.pauseAt("2026-11-05T00:00:10Z");
    configured = [{ id: "tet", start: "2026-11-01", end: "2026-12-01" }];
    await page.clock.runFor(61000);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "tet");
  });

  test("Resume gets fresh server time even if the device clock jumps while monotonic time stays paused", async ({ page }) => {
    const start = new Date("2026-11-05T00:00:00Z");
    let serverTime = start.toISOString();
    await page.clock.install({ time: start });
    await app(page, { schedule: novemberSchedule, scheduleNow: () => serverTime });
    await page.clock.pauseAt("2026-11-05T00:00:10Z");
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "halloween");
    serverTime = "2026-11-15T00:00:00.000Z";
    await page.clock.setSystemTime(serverTime);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "teachers-day");
  });

  test("A loaded schedule still changes at midnight when a later refresh loses connection", async ({ page }) => {
    const start = new Date("2026-11-09T16:59:00Z");
    let offline = false;
    await page.clock.install({ time: start });
    await app(page, { schedule: novemberSchedule, scheduleNow: start.toISOString(), scheduleFailure: () => offline });
    await page.clock.pauseAt("2026-11-09T16:59:10Z");
    await page.clock.runFor(61000);
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "teachers-day");
    offline = true;
    await page.clock.runFor(230000);
    await preferences(page);
    await expect(page.locator("[data-theme-schedule-status]")).toContainText("Vẫn áp dụng lịch đã tải");
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "teachers-day");
  });

  test("Unavailable schedule falls back safely and still allows manual selection", async ({ page }) => {
    const errors = await app(page, { scheduleFailure: true });
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "default");
    await preferences(page);
    await expect(page.locator("[data-theme-schedule-status]")).toContainText("Chưa tải được lịch");
    await page.getByRole("radio", { name: "Halloween" }).check();
    await closePreferences(page);
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "halloween");
    expect(errors).toEqual([]);
  });

  test("A hanging schedule request times out without blocking the app", async ({ page }) => {
    const errors = await app(page, { scheduleFailure: "timeout" });
    await expect(page.locator("#userSection")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "default");
    expect(errors).toEqual([]);
  });

  test("Malformed schedule data is rejected without changing the app or exposing raw content", async ({ page }) => {
    const errors = await app(page, {
      scheduleNow: "2026-11-15T00:00:00.000Z",
      scheduleOverride: { schedules: [{ id: "<script>bad</script>", start: "11-01", end: "12-01" }] },
    });
    await expect(page.locator("html")).toHaveAttribute("data-member-theme", "default");
    await preferences(page);
    await expect(page.locator("[data-theme-schedule-status]")).toContainText("Chưa tải được lịch");
    expect(errors).toEqual([]);
  });

  test("Automatic theme applies only to members, including after logout", async ({ page }) => {
    await app(page, { role: "admin", schedule: novemberSchedule, scheduleNow: "2026-11-15T00:00:00.000Z" });
    await expect(page.locator("html")).toHaveAttribute("data-seasonal", "false");
    expect((await palette(page)).accent).toBe("#12804b");
    await page.locator("#adminSection .avatar-button[data-open-account]").click();
    await page.locator("#logoutBtn").click();
    await expect(page.locator("#loginSection")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-seasonal", "false");
  });
});
