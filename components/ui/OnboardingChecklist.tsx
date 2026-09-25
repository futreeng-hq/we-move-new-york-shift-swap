"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/constants/colors";

interface ChecklistState {
  browsed: boolean;
  posted: boolean;
  pushEnabled: boolean;
  avatarSet: boolean;
  agreed: boolean;
}

const DEFAULT_STATE: ChecklistState = {
  browsed: false,
  posted: false,
  pushEnabled: false,
  avatarSet: false,
  agreed: false,
};

const ITEMS: { key: keyof ChecklistState; label: string; cta: string; href?: string }[] = [
  { key: "posted", label: "Post your first swap", cta: "Post now", href: "post" },
  { key: "browsed", label: "Browse available swaps", cta: "Browse", href: "swaps" },
  { key: "pushEnabled", label: "Enable push notifications", cta: "Enable" },
  { key: "avatarSet", label: "Add a profile photo", cta: "Add photo", href: "/profile" },
  { key: "agreed", label: "Complete a swap agreement", cta: "View swaps", href: "swaps" },
];

export function getChecklistState(userId: string): ChecklistState {
  if (typeof window === "undefined") return { ...DEFAULT_STATE };
  try {
    return JSON.parse(localStorage.getItem(`ob-${userId}`) || "null") ?? { ...DEFAULT_STATE };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function markChecklistItem(userId: string, key: keyof ChecklistState) {
  if (typeof window === "undefined") return;
  const state = getChecklistState(userId);
  state[key] = true;
  localStorage.setItem(`ob-${userId}`, JSON.stringify(state));
}

interface Props {
  userId: string;
  depotCode: string;
}

export default function OnboardingChecklist({ userId, depotCode }: Props) {
  const router = useRouter();
  const [state, setState] = useState<ChecklistState>({ ...DEFAULT_STATE });
  const [minimized, setMinimized] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage, which is unavailable during SSR, so it must happen after mount
    setState(getChecklistState(userId));
    if (typeof window !== "undefined" && localStorage.getItem(`ob-dismissed-${userId}`)) {
      setDismissed(true);
    }
  }, [userId]);

  const completedCount = Object.values(state).filter(Boolean).length;
  const total = ITEMS.length;
  const pct = Math.round((completedCount / total) * 100);
  const allDone = completedCount === total;

  if (dismissed || allDone) return null;

  const handleCTA = (item: typeof ITEMS[number]) => {
    if (item.href) {
      if (item.href.startsWith("/")) {
        router.push(item.href);
      } else {
        router.push(`/depot/${depotCode}/${item.href}`);
      }
    } else if (item.key === "pushEnabled") {
      Notification.requestPermission().then(p => {
        if (p === "granted") {
          const next = { ...state, pushEnabled: true };
          setState(next);
          localStorage.setItem(`ob-${userId}`, JSON.stringify(next));
        }
      });
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(`ob-dismissed-${userId}`, "1");
    setDismissed(true);
  };

  return (
    <div style={{
      position: "fixed",
      bottom: 72,
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(92vw, 400px)",
      background: "rgba(10,8,30,.95)",
      border: `1px solid ${C.bd}`,
      borderRadius: 16,
      boxShadow: "0 8px 32px rgba(0,0,0,.5)",
      zIndex: 200,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer" }} onClick={() => setMinimized(m => !m)}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.white }}>
          Getting started · {completedCount}/{total}
        </div>
        <div style={{ fontSize: 11, color: C.m, fontWeight: 600 }}>{pct}%</div>
        <button onClick={e => { e.stopPropagation(); handleDismiss(); }} style={{ background: "none", border: "none", color: C.m, fontSize: 16, cursor: "pointer", padding: "0 2px" }} aria-label="Dismiss checklist">×</button>
        <div style={{ color: C.m, fontSize: 12 }}>{minimized ? "▲" : "▼"}</div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: "rgba(255,255,255,.08)", margin: "0 14px 10px" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: C.gold, borderRadius: 2, transition: "width .4s ease" }} />
      </div>

      {!minimized && (
        <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          {ITEMS.map(item => {
            const done = state[item.key];
            const isFirst = item.key === "posted";
            return (
              <div key={item.key} style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 10,
                background: isFirst && !done ? "rgba(209,173,56,.08)" : "rgba(255,255,255,.03)",
                border: `1px solid ${isFirst && !done ? "rgba(209,173,56,.2)" : "rgba(255,255,255,.06)"}`,
                opacity: done ? 0.5 : 1,
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%",
                  border: done ? "none" : `2px solid ${isFirst ? C.gold : C.bd}`,
                  background: done ? "#10b981" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, fontSize: 12, color: "#fff",
                }}>
                  {done ? "✓" : ""}
                </div>
                <div style={{ flex: 1, fontSize: 12, color: done ? C.m : C.white, fontWeight: isFirst && !done ? 700 : 500 }}>
                  {item.label}
                  {isFirst && !done && <span style={{ marginLeft: 6, fontSize: 10, color: C.gold, fontWeight: 700 }}>← Start here</span>}
                </div>
                {!done && (
                  <button
                    onClick={() => handleCTA(item)}
                    style={{
                      background: isFirst ? C.gold : "rgba(255,255,255,.08)",
                      color: isFirst ? "#000" : C.m,
                      border: "none", borderRadius: 8, padding: "4px 10px",
                      fontSize: 11, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    {item.cta}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
