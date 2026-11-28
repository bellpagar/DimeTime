/* DimeTime web push worker: keep syntax compatible with mobile Safari. */
self.addEventListener("push", function (event) {
  var message = {};
  try {
    if (event.data) message = event.data.json() || {};
  } catch (error) {
    try { message = { body: event.data ? event.data.text() : "" }; } catch (_) { message = {}; }
  }
  var title = message.title || "DimeTime reminder";
  var options = {
    body: message.body || "You have a reminder.",
    icon: "favicon.svg",
    badge: "favicon.svg",
    tag: message.tag || "dimetime-reminder",
    renotify: false,
    data: { url: message.url || "./" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = new URL(event.notification.data && event.notification.data.url || "./", self.location.href).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
    for (var i = 0; i < windows.length; i++) {
      if (new URL(windows[i].url).origin === self.location.origin) {
        windows[i].focus();
        return windows[i].navigate(target);
      }
    }
    return clients.openWindow(target);
  }));
});

