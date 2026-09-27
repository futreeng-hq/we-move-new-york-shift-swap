"use client";

import { useState } from "react";
import { C } from "@/constants/colors";
import Icon from "@/components/ui/Icon";
import { usePush } from "@/lib/usePush";

/** Read once during render rather than in an effect — setState inside an effect
 *  trips react-hooks/set-state-in-effect, and there is no hydration mismatch to
 *  worry about because usePush() starts in "loading" and this component renders
 *  null on the first pass either way. */
function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("push-banner-dismissed") !== null;
  } catch {
    // Private mode or blocked storage: just show the banner.
    return false;
  }
}

export default function PushBanner() {
  const { state, busy, error, toggle } = usePush();
  const [dismissed, setDismissed] = useState(readDismissed);

  const dismiss = () => {
    try {
      localStorage.setItem("push-banner-dismissed", "1");
    } catch {
      // Non-fatal — the banner still hides for this page view.
    }
    setDismissed(true);
  };

  // `needs-install` is deliberately not handled here. On iOS in a browser tab
  // the fix is installing the app, and components/InstallPrompt.tsx already
  // owns that prompt — its pushWillAsk() gate returns false in exactly this
  // case so it takes the slot. Rendering a second banner would double up.
  if (
    dismissed ||
    state === "loading" ||
    state === "unsupported" ||
    state === "needs-install" ||
    state === "on"
  ) {
    return null;
  }

  const isBlocked = state === "blocked";

  return (
    <div
      style={{
        margin: "0 0 12px",
        borderRadius: 16,
        border: `1px solid ${isBlocked ? C.red + "44" : C.gold + "33"}`,
        background: isBlocked ? "rgba(239,68,68,.06)" : "rgba(209,173,56,.06)",
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          flexShrink: 0,
          background: isBlocked ? "rgba(239,68,68,.12)" : "rgba(209,173,56,.12)",
          border: `1px solid ${isBlocked ? C.red + "33" : C.gold + "33"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon n="bell" s={18} c={isBlocked ? C.red : C.gold} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.white }}>
          {isBlocked ? "Notifications blocked" : "Turn on notifications"}
        </div>
        <div style={{ fontSize: 11, color: C.m, marginTop: 2, lineHeight: 1.4 }}>
          {isBlocked
            ? "Allow notifications in your device settings"
            : "Get alerted when someone messages you or posts a matching swap"}
        </div>
        {error && (
          <div style={{ fontSize: 11, color: C.red, marginTop: 4, lineHeight: 1.4 }} role="alert">
            {error}
          </div>
        )}
      </div>

      {!isBlocked && (
        <button
          onClick={toggle}
          disabled={busy}
          aria-label="Turn on notifications"
          aria-checked={false}
          role="switch"
          style={{
            flexShrink: 0,
            width: 50,
            height: 28,
            borderRadius: 14,
            border: "none",
            cursor: busy ? "default" : "pointer",
            background: "rgba(255,255,255,.12)",
            position: "relative",
            transition: "background .2s",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: 3,
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 1px 4px rgba(0,0,0,.35)",
              transition: "left .2s",
            }}
          />
        </button>
      )}

      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 4,
          flexShrink: 0,
          lineHeight: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.m} strokeWidth="2" strokeLinecap="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
