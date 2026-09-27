"use client";

import { C } from "@/constants/colors";
import Icon from "./Icon";
import { usePush } from "@/lib/usePush";

export default function NotifToggle() {
  const { state, busy, error, toggle } = usePush();

  if (state === "unsupported" || state === "loading") return null;

  const isOn = state === "on";
  const isBlocked = state === "blocked";
  const needsInstall = state === "needs-install";
  // On iOS in a browser tab there is nothing to toggle — push exists only for
  // the home-screen app — so the control explains that instead of failing.
  const interactive = !isBlocked && !needsInstall;

  const label = isOn
    ? "Notifications On"
    : isBlocked
      ? "Notifications Blocked"
      : needsInstall
        ? "Add to Home Screen first"
        : "Enable Notifications";

  const color = isOn ? "#00C9A7" : isBlocked ? C.red : needsInstall ? C.gold : C.m;

  const hint = isBlocked
    ? "Allow notifications in your device settings"
    : needsInstall
      ? "Tap Share, then Add to Home Screen — iPhone only sends notifications to the installed app"
      : isOn
        ? "You'll get daily swap digests"
        : null;

  return (
    <button
      onClick={interactive ? toggle : undefined}
      disabled={!interactive || busy}
      aria-pressed={isOn}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "14px 16px",
        borderRadius: 14,
        border: `1px solid ${color}33`,
        background: isOn ? "rgba(0,201,167,.08)" : "rgba(255,255,255,.03)",
        cursor: interactive ? "pointer" : "default",
        opacity: busy ? 0.6 : 1,
        textAlign: "left",
      }}
    >
      <Icon n="bell" s={18} c={color} />
      <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.white }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 10, color: isOn ? color : C.m, marginTop: 1, lineHeight: 1.4 }}>
            {hint}
          </div>
        )}
        {error && (
          <div style={{ fontSize: 10, color: C.red, marginTop: 3, lineHeight: 1.4 }} role="alert">
            {error}
          </div>
        )}
      </div>
      {interactive && (
        <div
          style={{
            width: 36,
            height: 20,
            borderRadius: 10,
            background: isOn ? "#00C9A7" : C.s,
            border: `1px solid ${color}33`,
            display: "flex",
            alignItems: "center",
            padding: "0 3px",
            transition: "background .2s",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: isOn ? "#fff" : C.m,
              marginLeft: isOn ? "auto" : 0,
              transition: "margin .2s",
            }}
          />
        </div>
      )}
    </button>
  );
}
