let pushTask = null;
let foregroundBound = false;

function preparePushPermission() {
  if (!("Notification" in window)) return Promise.resolve("unsupported");
  if (Notification.permission !== "default") return Promise.resolve(Notification.permission);
  return Notification.requestPermission();
}

async function registerPush(options = {}) {
  if (pushTask) return pushTask;
  pushTask = subscribeForPush(options).finally(() => {
    pushTask = null;
  });
  return pushTask;
}

async function subscribeForPush(options) {
  try {
    return await subscribeForPushOnce(options);
  } catch (error) {
    console.warn("Không đăng ký được thông báo:", error?.message || error);
    return { ok: false, reason: "error" };
  }
}

async function subscribeForPushOnce(options) {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return { ok: false, reason: "unsupported" };
  if (!self.FIREBASE_CONFIG?.projectId) return { ok: false, reason: "missing-config" };

  const configResponse = await fetch("/api/push/config", { credentials: "include" });
  const config = await configResponse.json().catch(() => ({}));
  const vapidKey = String(config.vapidKey || "").trim();
  if (!vapidKey) {
    console.warn("Thiếu FIREBASE_VAPID_KEY nên chưa đăng ký được push.");
    return { ok: false, reason: "missing-vapid" };
  }

  let permission = Notification.permission;
  if (permission === "default" && options.prompt) permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: permission || "denied" };

  const { getApps, initializeApp } = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js");
  const { getMessaging, getToken, onMessage, isSupported } = await import(
    "https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js"
  );
  if (!(await isSupported())) return { ok: false, reason: "unsupported" };

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;
  const app = getApps().length ? getApps()[0] : initializeApp(self.FIREBASE_CONFIG);
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) return { ok: false, reason: "no-token" };

  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn(data.message || "Không lưu được token thông báo.");
    return { ok: false, reason: "subscribe-failed" };
  }

  if (!foregroundBound) {
    foregroundBound = true;
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || "Nhóm cầu lông";
      const body = payload.notification?.body || "";
      if (Notification.permission === "granted" && body) new Notification(title, { body });
    });
  }
  return { ok: true };
}

function pushStatusText(result) {
  if (result?.ok) return "Đã bật thông báo trên máy này.";
  if (result?.reason === "ios-install") {
    return "Trên iPhone, Safari không hỏi quyền trong tab. Hãy bấm Chia sẻ, chọn Thêm vào Màn hình chính, rồi mở app từ icon đó và bấm lại.";
  }
  if (result?.reason === "unsupported") {
    return "Trình duyệt chỉ hỏi quyền thông báo trên http://localhost:3000 hoặc HTTPS.";
  }
  if (result?.reason === "denied") {
    return "Thông báo đang bị chặn. Bấm ổ khóa trên thanh địa chỉ, chọn Allow, rồi bấm lại.";
  }
  if (result?.reason === "missing-vapid") return "Server chưa có FIREBASE_VAPID_KEY.";
  if (result?.reason === "subscribe-failed") {
    return "Trình duyệt đã cho phép. Hãy đăng nhập bằng tài khoản thành viên rồi bấm lại để lưu máy này.";
  }
  return "Chưa bật được thông báo. Bấm lại nút Bật thông báo.";
}

function askNotificationPermission() {
  if (!("Notification" in window)) return Promise.resolve("unsupported");
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Promise.resolve(Notification.permission);
  }
  const request = Notification.requestPermission();
  return request && typeof request.then === "function" ? request : Promise.resolve(Notification.permission);
}

function isIosBrowser() {
  const ua = navigator.userAgent || "";
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInstalledApp() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

function labelForPermission(permission) {
  if (permission === "granted") return "Đã cho phép thông báo";
  if (permission === "denied") return "Thông báo đang bị chặn";
  return "Bật thông báo";
}

function showPushStatus(status, result) {
  if (!status) return;
  status.hidden = false;
  status.textContent = pushStatusText(result);
  status.classList.toggle("is-error", !result?.ok);
  status.classList.toggle("text-red-600", !result?.ok);
}

function bindPushButtons() {
  document.querySelectorAll("[data-push-button]").forEach((button) => {
    const status = button.dataset.pushStatus ? document.querySelector(button.dataset.pushStatus) : null;
    button.type = "button";
    button.textContent = labelForPermission(typeof Notification === "undefined" ? "" : Notification.permission);
    if (status) status.hidden = true;
    button.addEventListener("click", () => {
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("Notification" in window)) {
        const reason = isIosBrowser() && !isInstalledApp() ? "ios-install" : "unsupported";
        showPushStatus(status, { ok: false, reason });
        return;
      }
      const permissionRequest = askNotificationPermission();
      button.disabled = true;
      permissionRequest
        .then(async (permission) => {
          if (permission !== "granted") {
            const reason = permission === "default" && isIosBrowser() && !isInstalledApp() ? "ios-install" : permission || "denied";
            showPushStatus(status, { ok: false, reason });
            return;
          }
          const result = await registerPush({ prompt: false });
          showPushStatus(status, result);
        })
        .catch(() => {
          showPushStatus(status, { ok: false, reason: "error" });
        })
        .finally(() => {
          button.textContent = labelForPermission(typeof Notification === "undefined" ? "" : Notification.permission);
          button.disabled = false;
        });
    });
  });
}

window.preparePushPermission = preparePushPermission;
window.registerPush = registerPush;
window.enablePushFromClick = function enablePushFromClick() {
  const button = document.querySelector("[data-push-button]");
  button?.click();
  return Promise.resolve({ ok: false, reason: "prompt" });
};
window.pushStatusText = pushStatusText;
bindPushButtons();
