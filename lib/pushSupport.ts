// Pure, testable logic for web-push availability. The React hook
// (lib/usePush.ts) owns all browser/DOM wiring — same split as
// lib/installPrompt.ts.
//
// Why this file exists at all: NotifToggle and PushBanner both used to read
// `Notification.permission` directly inside a mount effect, guarded only by
// checks for `serviceWorker` and `PushManager`. On iOS Safari in an ordinary
// browser tab that combination is a crash: `PushManager` IS present on the
// window from 16.4 on, but `Notification` is exposed ONLY inside an installed
// home-screen app, so `Notification.permission` threw a TypeError before any
// promise existed to catch it. components/InstallPrompt.tsx already had the
// correct `"Notification" in window` guard, which is how we know this was an
// oversight in the other two rather than a deliberate difference.

export type PushState =
  /** Can subscribe right now. */
  | "supported"
  /** iOS in a browser tab: push is real, but only for the home-screen app. */
  | "needs-install"
  /** Permission denied — only the user can undo this, in system settings. */
  | "blocked"
  /** No service worker or no push support at all. Hide the affordance. */
  | "unsupported";

export interface PushEnv {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  /** iOS Safari exposes Notification only inside an installed standalone PWA. */
  hasNotification: boolean;
  /** undefined when the Notification API is absent — reading it there throws. */
  permission: NotificationPermission | undefined;
  isIOS: boolean;
  isStandalone: boolean;
}

/**
 * Decide what the UI may offer. Ordering matters:
 *
 * `needs-install` is checked before `hasNotification` because on iOS the
 * missing Notification API is a symptom of not being installed, not of the
 * browser lacking push. Reporting "unsupported" there would hide the one
 * action that actually fixes it, which is exactly the trap that made iOS look
 * like it had no push support.
 */
export function evaluatePushSupport(e: PushEnv): PushState {
  if (!e.hasServiceWorker || !e.hasPushManager) return "unsupported";
  if (e.isIOS && !e.isStandalone) return "needs-install";
  if (!e.hasNotification) return "unsupported";
  if (e.permission === "denied") return "blocked";
  return "supported";
}

/** iPadOS 13+ reports a Mac UA; `maxTouchPoints` disambiguates. */
export function detectIOS(ua: string, maxTouchPoints: number): boolean {
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /macintosh/i.test(ua) && maxTouchPoints > 1;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** Read the live browser environment. Safe to call during SSR (returns a
 *  no-support shape) and safe on iOS-in-tab, which is the whole point. */
export function readPushEnv(): PushEnv {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      hasServiceWorker: false,
      hasPushManager: false,
      hasNotification: false,
      permission: undefined,
      isIOS: false,
      isStandalone: false,
    };
  }
  const hasNotification = "Notification" in window;
  return {
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification,
    // Only read it when it exists. This line is the bug that was crashing iOS.
    permission: hasNotification ? Notification.permission : undefined,
    isIOS: detectIOS(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    isStandalone: isStandaloneDisplay(),
  };
}

/** VAPID keys arrive base64url-encoded; `applicationServerKey` wants bytes. */
export function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out.buffer as ArrayBuffer;
}
