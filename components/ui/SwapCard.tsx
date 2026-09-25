"use client";

import { useState, useRef, useEffect } from "react";
import { Swap, User } from "@/types";
import { C, CM, STC, SWAP_TYPES } from "@/constants/colors";
import { useAuth } from "@/lib/AuthContext";
import { useT } from "@/lib/i18n";
import Icon from "./Icon";
import RepBadge from "./RepBadge";
import VerifiedBadge from "./VerifiedBadge";
import { playClick, playPop } from "@/lib/sound";
import { analytics } from "@/lib/analytics";

const ft = (t?: string | null) => {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hr = +h;
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
};

const timeAgo = (d: string) => {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

interface Props {
  swap: Swap;
  user: User | null;
  onDelete?: (id: string) => void;
  onStatusChange?: (id: string, status: string) => void;
  onEdit?: (s: Swap) => void;
  onReport?: (s: Swap) => void;
  onSaveTemplate?: (s: Swap) => void;
  onToggleSave?: (s: Swap, saved: boolean) => void;
  onShare?: (s: Swap) => void;
  lastVisit?: number;
  onClick?: () => void;
}

const activeAgo = (d?: string | null) => {
  if (!d) return null;
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 300) return "Active now";
  if (s < 3600) return `Active ${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `Active ${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `Active ${Math.floor(s / 86400)}d ago`;
  return null; // older than a week — don't show
};

export default function SwapCard({ swap: s, user, onDelete, onStatusChange, onEdit, onReport, onSaveTemplate, onToggleSave, onShare, lastVisit, onClick }: Props) {
  const { user: authUser } = useAuth();
  const tr = useT(authUser?.language);
  const m = CM[s.category] ?? CM.work;
  const co = SWAP_TYPES.find(x => x.id === s.category);
  const own = user && s.userId === user.id;
  const activeLabel = activeAgo(s.posterLastActive);
  const st2 = STC[s.status] ?? STC.open;
  const isNew = lastVisit && new Date(s.createdAt).getTime() > lastVisit - 3600000;

  // The clock is read after mount, not during render. Calling Date.now() in the
  // render body made the server and client disagree whenever a card crossed the
  // "recently new" or "urgent" threshold between the two — a real hydration
  // mismatch on decorative badges, and what react-hooks/purity was flagging.
  // Until `now` is set, the time-dependent badges simply do not render, which
  // matches what the server produced.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: reading the clock on mount is the fix for the hydration mismatch above, not a cascading render
    setNow(Date.now());
  }, []);

  const isRecentlyNew = now !== null && now - new Date(s.createdAt).getTime() < 2 * 60 * 60 * 1000;

  const urgentMs = 48 * 60 * 60 * 1000;
  const swapDate = s.date || s.fromDate;
  const msToSwap = swapDate && now !== null ? new Date(swapDate + "T12:00").getTime() - now : null;
  const isUrgent = msToSwap !== null && s.status === "open" && msToSwap < urgentMs && msToSwap > 0;
  const [tapped, setTapped] = useState(false);
  const tappedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const categoryGlow: Record<string, string> = {
    work: "#0249B5",
    daysoff: "#D1AD38",
    vacation: "#00C9A7",
  };
  const glowColor = categoryGlow[s.category] ?? "#0249B5";

  const statusLabel: Record<string, string> = {
    open: tr("status.open"),
    pending: tr("status.pending"),
    filled: tr("status.filled"),
    expired: tr("status.expired"),
  };

  return (
    <div
      style={{ background: "rgba(255,255,255,.03)", backdropFilter: "blur(12px)", borderRadius: 18, padding: 20, border: "1px solid rgba(255,255,255,.06)", transition: "all .3s cubic-bezier(.4,0,.2,1)", cursor: onClick ? "pointer" : "default", borderLeft: "3px solid transparent", opacity: !own && s.status !== "open" ? 0.62 : 1, transform: tapped ? "scale(0.97)" : "" }}
      onMouseEnter={e => { const el = e.currentTarget; el.style.transform = "translateY(-2px)"; el.style.borderColor = m.c + "33"; el.style.boxShadow = `0 8px 32px ${glowColor}20`; el.style.borderLeftColor = m.c + "44"; }}
      onMouseLeave={e => { const el = e.currentTarget; el.style.transform = tapped ? "scale(0.97)" : ""; el.style.borderColor = "rgba(255,255,255,.06)"; el.style.boxShadow = ""; el.style.borderLeftColor = "transparent"; }}
      onClick={() => {
        playClick();
        setTapped(true);
        if (tappedTimer.current) clearTimeout(tappedTimer.current);
        tappedTimer.current = setTimeout(() => setTapped(false), 120);
        onClick?.();
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: m.c, letterSpacing: 1, textTransform: "uppercase" }}>{co?.f}</span>
          {isNew && <span style={{ padding: "1px 6px", borderRadius: 4, background: C.gold, color: C.bg, fontSize: 8, fontWeight: 800, letterSpacing: 1 }}>{tr("browse.new")}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {isRecentlyNew && (
            <span style={{ background: "rgba(46,213,115,.15)", border: "1px solid rgba(46,213,115,.3)", color: "#2ED573", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 8, letterSpacing: 1 }}>NEW</span>
          )}
          {isUrgent && (
            <span style={{ background: "rgba(251,146,60,.15)", border: "1px solid rgba(251,146,60,.3)", color: "#FB923C", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 8, letterSpacing: 1 }}>⚡ URGENT</span>
          )}
          <span style={{ padding: "4px 10px", borderRadius: 20, background: st2.bg, border: `1px solid ${st2.bd}`, fontSize: 9, fontWeight: 700, color: st2.c, textTransform: "uppercase", letterSpacing: 1, boxShadow: `0 0 8px ${st2.c}15`, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: st2.c, animation: s.status === "open" ? "pulseGlow 2s ease infinite" : "none" }} />
            {statusLabel[s.status] ?? s.status}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: C.white }}>{s.posterName}{s.posterVerified && <VerifiedBadge size={14} />}</span>
        <RepBadge rep={s.reputation} size="small" />
        {activeLabel && (
          <span style={{ fontSize: 9, fontWeight: 700, color: "#00C9A7", background: "rgba(0,201,167,.12)", border: "1px solid rgba(0,201,167,.25)", borderRadius: 6, padding: "2px 6px", letterSpacing: .5 }}>
            {activeLabel}
          </span>
        )}
      </div>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,.6)", lineHeight: 1.5, marginTop: 6 }}>{s.details}</p>

      {s.category === "work" && (
        <div style={{ marginTop: 10, borderRadius: 12, background: C.blue + "0d", border: `1px solid ${C.blue}22`, padding: "10px 12px" }}>
          {(s.run || s.route) && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {s.run && (
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, color: C.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{tr("detail.run")}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.white }}>{s.run}</div>
                </div>
              )}
              {s.route && (
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, color: C.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{tr("detail.route")}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.white }}>{s.route}</div>
                </div>
              )}
            </div>
          )}
          {(s.startTime || s.clearTime) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: s.swingStart ? 8 : 0 }}>
              <div style={{ flex: 1, padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,.04)", border: `1px solid ${C.blue}22` }}>
                <div style={{ fontSize: 9, color: C.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{tr("detail.startTime")}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.white }}>{ft(s.startTime) || "—"}</div>
              </div>
              <Icon n="arr" s={14} c={C.m} />
              <div style={{ flex: 1, padding: "6px 10px", borderRadius: 8, background: "rgba(255,255,255,.04)", border: `1px solid ${C.blue}22` }}>
                <div style={{ fontSize: 9, color: C.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{tr("detail.clearTime")}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.white }}>{ft(s.clearTime) || "—"}</div>
              </div>
            </div>
          )}
          {(s.swingStart || s.swingEnd) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, borderTop: `1px solid ${C.blue}18` }}>
              <div style={{ fontSize: 9, color: C.m, textTransform: "uppercase", letterSpacing: 1, flexShrink: 0 }}>{tr("detail.swingBreak")}</div>
              <div style={{ flex: 1, padding: "4px 8px", borderRadius: 6, background: "rgba(255,255,255,.03)", border: `1px solid ${C.blue}18`, textAlign: "center" }}>
                <div style={{ fontSize: 9, color: C.m, textTransform: "uppercase", letterSpacing: 1, marginBottom: 1 }}>{tr("detail.swingIn")}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,.8)" }}>{ft(s.swingStart) || "—"}</div>
              </div>
              <Icon n="arr" s={12} c={C.m} />
              <div style={{ flex: 1, padding: "4px 8px", borderRadius: 6, background: "rgba(255,255,255,.03)", border: `1px solid ${C.blue}18`, textAlign: "center" }}>
                <div style={{ fontSize: 9, color: C.m, textTransform: "uppercase", letterSpacing: 1, marginBottom: 1 }}>{tr("detail.swingOut")}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,.8)" }}>{ft(s.swingEnd) || "—"}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {s.category === "daysoff" && (s.fromDay || s.fromDate) && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 6, alignItems: "center" }}>
            <div style={{ padding: "6px 10px", borderRadius: 8, background: C.gs }}>
              <div style={{ fontSize: 8, color: C.gold, textTransform: "uppercase" }}>{tr("detail.swappingFrom")}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.white }}>{s.fromDay}</div>
              {s.fromDate && <div style={{ fontSize: 10, color: C.m, marginTop: 2 }}>{new Date(s.fromDate + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>}
            </div>
            <Icon n="swap" s={14} c={C.m} />
            <div style={{ padding: "6px 10px", borderRadius: 8, background: C.blue + "12" }}>
              <div style={{ fontSize: 8, color: C.blue, textTransform: "uppercase" }}>{tr("detail.swappingTo")}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.white }}>{s.toDay}</div>
              {s.toDate && <div style={{ fontSize: 10, color: C.m, marginTop: 2 }}>{new Date(s.toDate + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>}
            </div>
          </div>
        </div>
      )}

      {s.category === "vacation" && (s.vacationHave || s.vacationWant) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 6, marginTop: 8, alignItems: "center" }}>
          <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(0,201,167,.08)" }}>
            <div style={{ fontSize: 8, color: "#00C9A7", textTransform: "uppercase" }}>{tr("detail.haveWeek")}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.white }}>{s.vacationHave}</div>
          </div>
          <Icon n="swap" s={14} c={C.m} />
          <div style={{ padding: "6px 10px", borderRadius: 8, background: C.blue + "12" }}>
            <div style={{ fontSize: 8, color: C.blue, textTransform: "uppercase" }}>{tr("detail.wantWeek")}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.white }}>{s.vacationWant}</div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.bd}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: C.m }}>{timeAgo(s.createdAt)}</span>
          {!own && onClick && <Icon n="chev" s={12} c={C.m} />}
        </div>
        <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
          {own ? (
            <>
              {onShare && (
                <button onClick={() => onShare(s)} title={tr("share.button")} aria-label={tr("share.button")} style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${C.gold}33`, background: C.gs, cursor: "pointer", color: C.gold, display: "flex", alignItems: "center" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                </button>
              )}
              {onSaveTemplate && (
                <button onClick={() => onSaveTemplate(s)} title="Save as template" aria-label="Save as template" style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${C.gold}33`, background: C.gs, cursor: "pointer", color: C.gold, display: "flex", alignItems: "center" }}><Icon n="clk" s={13} /></button>
              )}
              {onEdit && (
                <button onClick={() => onEdit(s)} aria-label={tr("action.edit")} style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${C.blue}33`, background: C.blue + "12", cursor: "pointer", color: C.blue, display: "flex", alignItems: "center" }}><Icon n="edit" s={13} /></button>
              )}
              {onStatusChange && (
                <select value={s.status} onChange={e => onStatusChange(s.id, e.target.value)} style={{ padding: "4px 8px", borderRadius: 8, fontSize: 10, fontWeight: 600, width: "auto", cursor: "pointer", appearance: "auto", background: C.s, border: `1px solid ${C.bd}`, color: C.white }}>
                  <option value="open">{tr("status.open")}</option>
                  <option value="pending">{tr("status.pending")}</option>
                  <option value="filled">{tr("status.filled")}</option>
                  <option value="expired">{tr("status.expired")}</option>
                </select>
              )}
              {onDelete && (
                <button onClick={() => onDelete(s.id)} aria-label={tr("action.delete")} style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${C.red}33`, background: C.red + "12", cursor: "pointer", color: C.red, display: "flex", alignItems: "center" }}><Icon n="del" s={13} /></button>
              )}
            </>
          ) : (
            <>
              {onToggleSave && s.status === "open" && (
                <button
                  onClick={() => { playPop(); if (!s.saved) analytics.swapSaved(s.id); onToggleSave(s, !s.saved); }}
                  title={s.saved ? "Unsave" : "Save swap"}
                  aria-label={s.saved ? "Unsave swap" : "Save swap"}
                  style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${s.saved ? C.gold + "55" : C.bd}`, background: s.saved ? C.gold + "18" : "transparent", cursor: "pointer", color: s.saved ? C.gold : C.m, display: "flex", alignItems: "center" }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill={s.saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
                </button>
              )}
              {onReport && (
                <button onClick={() => onReport(s)} title={tr("action.report")} aria-label={tr("action.report")} style={{ padding: "4px 6px", borderRadius: 6, border: `1px solid ${C.bd}`, background: "transparent", cursor: "pointer", color: C.m, display: "flex", alignItems: "center", opacity: 0.5 }}><Icon n="inf" s={11} /></button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
