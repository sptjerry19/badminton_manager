importScripts("/firebase-config.js");
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js");

firebase.initializeApp(self.FIREBASE_CONFIG);
firebase.messaging();

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => String(client.url || "").startsWith(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    })
  );
});
