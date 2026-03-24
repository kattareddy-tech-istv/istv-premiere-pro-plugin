/**
 * Browser notifications — permission is requested on app load (required for step alerts).
 */

const logoIcon = () => {
  if (typeof window === "undefined") return undefined;
  try {
    return `${window.location.origin}/brand/inside-success-logo.png`;
  } catch {
    return undefined;
  }
};

export function getNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** Request notification permission. */
export function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return Promise.resolve("unsupported");
  }
  if (Notification.permission === "granted") return Promise.resolve("granted");
  if (Notification.permission === "denied") return Promise.resolve("denied");
  return Notification.requestPermission();
}

let notificationPromptStarted = false;

/**
 * Request permission once per page load (avoids duplicate prompts under React StrictMode).
 */
export async function ensureNotificationPermissionOnce() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  if (notificationPromptStarted) {
    return getNotificationPermission();
  }
  notificationPromptStarted = true;
  return requestNotificationPermission();
}

/**
 * Show a system notification when permission is granted.
 */
export function notifyPipelineStep(title, body) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body: body || "",
      icon: logoIcon(),
      badge: logoIcon(),
    });
  } catch {
    // ignore
  }
}
