"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  evaluatePushSupport,
  readPushEnv,
  urlBase64ToUint8Array,
  type PushState,
} from "@/lib/pushSupport";

export type PushUiState =
  | "loading"
  | "unsupported"
  | "needs-install"
  | "blocked"
  | "off"
  | "on";

export interface UsePush {
  state: PushUiState;
  busy: boolean;
  /** Set when an enable/disable attempt failed. Rendered to the user. */
  error: string | null;
  toggle: () => Promise<void>;
}

/**
 * Shared subscribe/unsubscribe flow for NotifToggle and PushBanner, which
 * previously carried two near-identical copies of it — and two copies of the
 * same iOS crash and the same silent failure.
 *
 * Three things here are deliberate:
 *
 * 1. The VAPID key is fetched at mount, not inside the click handler. Safari
 *    ties the permission prompt to the user gesture, and an intervening
 *    `await fetch(...)` can lose that context, so `subscribe()` must be the
 *    first await after the click.
 * 2. The registration is kept in a ref rather than re-derived from
 *    `navigator.serviceWorker.ready`, which never resolves if registration
 *    failed — the old code could hang the toggle forever in that case.
 * 3. Failures set `error` instead of being swallowed. The old `catch {}` meant
 *    a rejected `subscribe()` left the control in its previous state with no
 *    feedback: the user tapped, nothing happened, nothing explained why.
 */
export function usePush(): UsePush {
  const [state, setState] = useState<PushUiState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regRef = useRef<ServiceWorkerRegistration | null>(null);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const support: PushState = evaluatePushSupport(readPushEnv());
    if (support !== "supported") {
      setState(support);
      return;
    }

    // `updateViaCache: "none"` per the Next.js PWA guide: without it the
    // browser may serve sw.js from the HTTP cache and never notice a new
    // deploy's worker.
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(async (reg) => {
        if (cancelled) return;
        regRef.current = reg;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        setState(sub ? "on" : "off");
        // Prefetch, best-effort. A failure here is not worth surfacing; the
        // click path refetches and will report an error if it still fails.
        api
          .get<{ publicKey: string }>("/push/subscribe")
          .then(({ publicKey }) => {
            if (!cancelled) keyRef.current = publicKey || null;
          })
          .catch(() => {});
      })
      .catch(() => {
        if (!cancelled) setState("unsupported");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (busy || state === "loading" || state === "unsupported") return;
    if (state === "needs-install" || state === "blocked") return;

    setBusy(true);
    setError(null);
    try {
      const reg = regRef.current;
      if (!reg) throw new Error("Notifications aren't ready yet. Try again.");

      if (state === "on") {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          // Unsubscribe locally first: if the server call fails we must not
          // leave the UI claiming "off" while the browser still holds a live
          // subscription that keeps receiving pushes.
          await sub.unsubscribe();
          await api
            .delete("/push/subscribe", { endpoint: sub.endpoint })
            .catch(() => {});
        }
        setState("off");
        return;
      }

      let key = keyRef.current;
      if (!key) {
        const res = await api.get<{ publicKey: string }>("/push/subscribe");
        key = res.publicKey || null;
        keyRef.current = key;
      }
      if (!key) {
        throw new Error("Push isn't configured on the server yet.");
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = sub.toJSON();
      await api.post("/push/subscribe", {
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      });
      setState("on");
    } catch (e) {
      // Re-read support: the most common cause of a rejected subscribe() is
      // the user denying the prompt, which changes permission underneath us.
      const next = evaluatePushSupport(readPushEnv());
      if (next === "blocked") {
        setState("blocked");
      } else {
        setError(
          e instanceof Error && e.message
            ? e.message
            : "Couldn't change notifications. Try again."
        );
      }
    } finally {
      setBusy(false);
    }
  }, [busy, state]);

  return { state, busy, error, toggle };
}
