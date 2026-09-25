"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import { Depot, Swap } from "@/types";
import { C, CM, SWAP_TYPES } from "@/constants/colors";
import DepotBadge from "@/components/ui/DepotBadge";
import Icon from "@/components/ui/Icon";
import Toast from "@/components/ui/Toast";
import NotifIcon from "@/components/ui/NotifIcon";
import { parseSwapDate } from "@/lib/swapDate";
import InboxIcon from "@/components/ui/InboxIcon";
import TimePicker from "@/components/ui/TimePicker";
import { playClick, playSuccess } from "@/lib/sound";
import FirstSwapCelebration from "@/components/ui/FirstSwapCelebration";
import { markChecklistItem } from "@/components/ui/OnboardingChecklist";
import { analytics } from "@/lib/analytics";

const lb: React.CSSProperties = {
  display: "block", marginBottom: 6, fontSize: 11, fontWeight: 600,
  color: C.m, letterSpacing: 1.5, textTransform: "uppercase",
};

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

function getWeekOptions(): { value: string; label: string }[] {
  const year = new Date().getFullYear();
  const jan1 = new Date(year, 0, 1);
  // Find first Monday
  const firstMonday = new Date(jan1);
  firstMonday.setDate(jan1.getDate() + ((8 - jan1.getDay()) % 7 || 7));
  const opts = [];
  for (let i = 0; i < 52; i++) {
    const start = new Date(firstMonday);
    start.setDate(firstMonday.getDate() + i * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    opts.push({ value: `Week ${i + 1}`, label: `Week ${i + 1}  (${fmt(start)} – ${fmt(end)})` });
  }
  return opts;
}

const WEEK_OPTIONS = getWeekOptions();

function getToday() {
  // Use local date, not UTC, so EST users get the correct "today"
  const d = new Date();
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isPastDate(dateStr: string): boolean {
  if (!dateStr) return false;
  const today = getToday();
  return dateStr < today;
}

// Returns true if the date+time combination is in the past.
// Time is optional — if omitted, only the date is checked.
function isPastDateTime(dateStr: string, timeStr?: string): boolean {
  if (!dateStr) return false;
  if (isPastDate(dateStr)) return true;
  if (dateStr > getToday()) return false;
  // dateStr === today
  if (!timeStr) return false;
  const now = new Date();
  const [h, m] = timeStr.split(":").map(Number);
  return h < now.getHours() || (h === now.getHours() && m <= now.getMinutes());
}
function getDayFromDate(dateStr: string): string {
  // The form's own <input type="date"> yields "YYYY-MM-DD", but this also runs
  // against values round-tripped from the API, which are full ISO instants.
  const d = parseSwapDate(dateStr);
  if (!d) return "";
  return DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1] ?? "";
}

interface FormState {
  category: "work" | "daysoff" | "vacation";
  details: string; contact: string;
  date: string; run: string; route: string;
  startTime: string; clearTime: string; swingStart: string; swingEnd: string;
  fromDate: string; toDate: string;
  vacationHave: string; vacationWant: string;
}

// ── ShiftFields ────────────────────────────────────────────────────────────────
function ShiftFields({ f, sF, idPrefix = "sf", dateStr }: {
  f: FormState;
  sF: (v: FormState) => void;
  idPrefix?: string;
  dateStr?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><label htmlFor={`${idPrefix}-run`} style={lb}>Run</label><input id={`${idPrefix}-run`} value={f.run} onChange={e => sF({ ...f, run: e.target.value })} placeholder="401" style={{ fontSize: 16 }} /></div>
        <div><label htmlFor={`${idPrefix}-route`} style={lb}>Route</label><input id={`${idPrefix}-route`} value={f.route} onChange={e => sF({ ...f, route: e.target.value })} placeholder="Bx1" style={{ fontSize: 16 }} /></div>
      </div>
      <TimePicker id={`${idPrefix}-start`} label="Start Time" value={f.startTime} onChange={v => sF({ ...f, startTime: v })} dateStr={dateStr} />
      <TimePicker id={`${idPrefix}-clear`} label="Clear Time" value={f.clearTime} onChange={v => sF({ ...f, clearTime: v })} dateStr={dateStr} />
      <TimePicker id={`${idPrefix}-swingS`} label="Swing Start" value={f.swingStart} onChange={v => sF({ ...f, swingStart: v })} dateStr={dateStr} />
      <TimePicker id={`${idPrefix}-swingE`} label="Swing End" value={f.swingEnd} onChange={v => sF({ ...f, swingEnd: v })} dateStr={dateStr} />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function PostSwapPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const code = params.code;

  const [depot, setDepot] = useState<Depot | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<(Swap & { templateName: string })[]>([]);
  const [f, sF] = useState<FormState>({
    category: "work", details: "", contact: "",
    date: "", run: "", route: "",
    startTime: "", clearTime: "", swingStart: "", swingEnd: "",
    fromDate: "", toDate: "",
    vacationHave: "", vacationWant: "",
  });

  const showToast = useCallback((msg: string) => {
    setToast(msg); setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    const t = JSON.parse(localStorage.getItem("templates") ?? "[]");
    setTemplates(t);
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    if (!loading && user && !user.depotId) router.replace("/setup-profile");
    if (!loading && user?.depot && user.depot.code !== code && user.role !== "admin" && user.role !== "subAdmin") router.replace(`/depot/${user.depot.code}/swaps`);
  }, [user, loading, router, code]);

  useEffect(() => {
    if (!code) return;
    api.get<Depot>(`/depots/${code}`).then(setDepot).catch(() => router.replace("/depots"));
    if (editId) {
      api.get<Swap>(`/swaps/${editId}`).then(sw => {
        sF({
          category: sw.category,
          details: sw.details,
          contact: sw.contact ?? "",
          date: sw.date ? sw.date.split("T")[0] : "",
          run: sw.run ?? "",
          route: sw.route ?? "",
          startTime: sw.startTime ?? "",
          clearTime: sw.clearTime ?? "",
          swingStart: sw.swingStart ?? "",
          swingEnd: sw.swingEnd ?? "",
          fromDate: sw.fromDate ? sw.fromDate.split("T")[0] : "",
          toDate: sw.toDate ? sw.toDate.split("T")[0] : "",
          vacationHave: sw.vacationHave ?? "",
          vacationWant: sw.vacationWant ?? "",
        });
      }).catch(() => {});
    }
  }, [code, editId, router]);

  const fromDay = getDayFromDate(f.fromDate);
  const toDay = getDayFromDate(f.toDate);
  const today = getToday();

  // Clear any times that are now in the past after a date change
  const clearPastTimes = (next: FormState, dateField: "date" | "fromDate"): FormState => {
    const d = dateField === "date" ? next.date : next.fromDate;
    if (!d || d > today) return next;
    // date is today — clear times already past
    const clearIfPast = (t: string) => (t && isPastDateTime(d, t) ? "" : t);
    return {
      ...next,
      startTime: clearIfPast(next.startTime),
      clearTime: clearIfPast(next.clearTime),
      swingStart: clearIfPast(next.swingStart),
      swingEnd: clearIfPast(next.swingEnd),
    };
  };

  const [dateError, setDateError] = useState("");

  const validate = () => {
    if (!f.details.trim()) return false;
    if (f.category === "work" && !f.date) return false;
    if (f.category === "daysoff" && !f.fromDate) return false;
    if (f.category === "vacation" && (!f.vacationHave || !f.vacationWant)) return false;
    return true;
  };

  // Hard validation of dates/times before submit
  const validatePast = (): string => {
    if (f.category === "work") {
      if (f.date && isPastDate(f.date)) return "Swap date cannot be in the past.";
      if (f.startTime && isPastDateTime(f.date, f.startTime)) return "Start time is in the past.";
      if (f.clearTime && isPastDateTime(f.date, f.clearTime)) return "Clear time is in the past.";
      if (f.swingStart && isPastDateTime(f.date, f.swingStart)) return "Swing start is in the past.";
      if (f.swingEnd && isPastDateTime(f.date, f.swingEnd)) return "Swing end is in the past.";
    }
    if (f.category === "daysoff") {
      if (f.fromDate && isPastDate(f.fromDate)) return "From date cannot be in the past.";
      if (f.toDate && isPastDate(f.toDate)) return "To date cannot be in the past.";
      if (f.startTime && isPastDateTime(f.fromDate, f.startTime)) return "Start time is in the past.";
      if (f.clearTime && isPastDateTime(f.fromDate, f.clearTime)) return "Clear time is in the past.";
    }
    return "";
  };

  const handleSubmit = async () => {
    playClick();
    if (!validate()) { setShowErrors(true); return; }
    const pastErr = validatePast();
    if (pastErr) { setDateError(pastErr); return; }
    setDateError("");
    setSubmitting(true);
    try {
      const payload = {
        category: f.category,
        details: f.details.trim(),
        contact: f.contact.trim() || undefined,
        date: f.category === "work" ? f.date : undefined,
        run: f.run || undefined,
        route: f.route || undefined,
        startTime: f.startTime || undefined,
        clearTime: f.clearTime || undefined,
        swingStart: f.swingStart || undefined,
        swingEnd: f.swingEnd || undefined,
        fromDay: f.category === "daysoff" ? fromDay : undefined,
        fromDate: f.category === "daysoff" ? f.fromDate : undefined,
        toDay: f.category === "daysoff" ? toDay : undefined,
        toDate: f.category === "daysoff" ? f.toDate : undefined,
        vacationHave: f.category === "vacation" ? f.vacationHave : undefined,
        vacationWant: f.category === "vacation" ? f.vacationWant : undefined,
      };
      if (editId) {
        await api.put(`/swaps/${editId}`, payload);
        showToast("Swap updated!");
        analytics.swapPosted({ type: f.category, depot: code, swapType: "edit" });
      } else {
        await api.post("/swaps", payload);
        showToast("Swap posted!");
        analytics.swapPosted({ type: f.category, depot: code });
        if (user && !localStorage.getItem("first-swap-done")) {
          localStorage.setItem("first-swap-done", "1");
          if (user) markChecklistItem(user.id, "posted");
          setShowCelebration(true);
        } else if (user) {
          markChecklistItem(user.id, "posted");
        }
      }
      playSuccess();
      setSubmitted(true);
      setTimeout(() => router.push(`/depot/${code}/swaps`), showCelebration ? 4500 : 600);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Failed to post swap");
    } finally { setSubmitting(false); }
  };

  if (!depot) return null;

  const dateInputStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    fontSize: 16,      // prevents iOS auto-zoom
    boxSizing: "border-box",
    display: "block",
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      {showCelebration && <FirstSwapCelebration onDismiss={() => setShowCelebration(false)} />}
      <style>{`
        @keyframes rippleOut { from { transform: scale(0); opacity: 0.6; } to { transform: scale(2.5); opacity: 0; } }
      `}</style>
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(1,0,40,.75)", borderBottom: `1px solid ${C.bd}`, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push(`/depot/${code}`)} aria-label="Go back" style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.bd}`, background: C.s, color: C.gold, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon n="back" s={16} /></button>
        <DepotBadge depot={depot} size={38} />
        <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.white }}>{depot.name}</div>
        <NotifIcon />
        <InboxIcon />
      </div>

      <main id="main-content" tabIndex={-1} style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px 60px", width: "100%" }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, background: `linear-gradient(135deg,${C.white},${C.gold}88)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 16 }}>
          {editId ? "Edit Swap" : "Post a Swap"}
        </h2>

        <div style={{ display: "grid", gap: 16 }}>
          {/* Template picker */}
          {templates.length > 0 && (
            <button
              onClick={() => setShowTemplates(true)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 14, border: `1px solid ${C.gold}33`, background: C.gold + "08", cursor: "pointer", textAlign: "left" }}
            >
              <Icon n="saved" s={18} c={C.gold} />
              <span style={{ fontSize: 14, fontWeight: 700, color: C.gold }}>Use a Template</span>
            </button>
          )}

          {/* Swap type */}
          <div>
              <label style={lb}>Swap Type</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {SWAP_TYPES.map(sc => {
                  const sel = f.category === sc.id;
                  const m = CM[sc.id as keyof typeof CM];
                  return (
                    <button key={sc.id} onClick={() => sF({ ...f, category: sc.id as FormState["category"] })} style={{ padding: "14px 8px", borderRadius: 14, border: "none", cursor: "pointer", textAlign: "center", background: sel ? m.bg : C.s, boxShadow: sel ? `inset 0 0 0 2px ${m.c}` : `inset 0 0 0 1px ${C.bd}` }}>
                      <div style={{ display: "flex", justifyContent: "center", marginBottom: 6, color: sel ? m.c : C.m }}><Icon n={sc.ic} s={20} /></div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: sel ? m.c : C.m, lineHeight: 1.2 }}>{sc.l}</div>
                    </button>
                  );
                })}
              </div>
            </div>

          {/* Work fields */}
          {f.category === "work" && (
            <>
              <div>
                <label htmlFor="work-date" style={lb}>
                  Date {showErrors && !f.date && <span style={{ color: C.red, fontSize: 10 }}>Required</span>}
                </label>
                <input
                  id="work-date"
                  type="date"
                  value={f.date}
                  min={today}
                  onChange={e => {
                    const val = e.target.value;
                    if (val && isPastDate(val)) return;
                    sF(clearPastTimes({ ...f, date: val }, "date"));
                  }}
                  style={{ ...dateInputStyle, ...(showErrors && !f.date ? { borderColor: C.red + "66" } : {}) }}
                />
              </div>
              <div style={{ background: "rgba(2,73,181,.04)", borderRadius: 16, border: "1px solid rgba(2,73,181,.12)", padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>Shift Details</div>
                <ShiftFields f={f} sF={sF} idPrefix="work" dateStr={f.date} />
              </div>
            </>
          )}

          {/* Days off fields */}
          {f.category === "daysoff" && (
            <>
              <div style={{ background: "rgba(209,173,56,.04)", borderRadius: 16, border: "1px solid rgba(209,173,56,.12)", padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>
                  Your Shift (the day you&apos;re giving away)
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="doff-fromDate" style={lb}>
                    Date {showErrors && !f.fromDate && <span style={{ color: C.red, fontSize: 10 }}>Required</span>}
                  </label>
                  <input
                    id="doff-fromDate"
                    type="date"
                    value={f.fromDate}
                    min={today}
                    onChange={e => {
                      const val = e.target.value;
                      if (val && isPastDate(val)) return;
                      sF(clearPastTimes({ ...f, fromDate: val }, "fromDate"));
                    }}
                    style={{ ...dateInputStyle, ...(showErrors && !f.fromDate ? { borderColor: C.red + "66" } : {}) }}
                  />
                  {fromDay && <div style={{ fontSize: 12, color: C.gold, marginTop: 6, fontWeight: 600 }}>📅 {fromDay}</div>}
                </div>
                <ShiftFields f={f} sF={sF} idPrefix="doff" dateStr={f.fromDate} />
              </div>
              <div style={{ background: "rgba(2,73,181,.04)", borderRadius: 16, border: "1px solid rgba(2,73,181,.12)", padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>
                  Wanted Shift (the day you want off)
                </div>
                <label htmlFor="doff-toDate" style={lb}>Date</label>
                <input
                  id="doff-toDate"
                  type="date"
                  value={f.toDate}
                  min={f.fromDate || today}
                  onChange={e => {
                    const val = e.target.value;
                    if (val && isPastDate(val)) return;
                    sF({ ...f, toDate: val });
                  }}
                  style={dateInputStyle}
                />
                {toDay && <div style={{ fontSize: 12, color: C.blue, marginTop: 6, fontWeight: 600 }}>📅 {toDay}</div>}
              </div>
            </>
          )}

          {/* Vacation fields */}
          {f.category === "vacation" && (
            <>
              <div style={{ background: "rgba(0,201,167,.04)", borderRadius: 16, border: "1px solid rgba(0,201,167,.12)", padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#00C9A7", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Vacation week you have</div>
                <select value={f.vacationHave} onChange={e => sF({ ...f, vacationHave: e.target.value })} style={{ cursor: "pointer", fontSize: 16 }}>
                  <option value="">Select week...</option>
                  {WEEK_OPTIONS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
              </div>
              <div style={{ background: "rgba(2,73,181,.04)", borderRadius: 16, border: "1px solid rgba(2,73,181,.12)", padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Vacation week you want</div>
                <select value={f.vacationWant} onChange={e => sF({ ...f, vacationWant: e.target.value })} style={{ cursor: "pointer", fontSize: 16 }}>
                  <option value="">Select week...</option>
                  {WEEK_OPTIONS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Details */}
          <div>
            <label htmlFor="post-details" style={lb}>
              Details {showErrors && !f.details.trim() && <span style={{ color: C.red, fontSize: 10 }}>Required</span>}
            </label>
            <textarea
              id="post-details"
              value={f.details}
              onChange={e => sF({ ...f, details: e.target.value })}
              placeholder="Details about this swap..."
              rows={3}
              style={{ resize: "vertical", fontSize: 16, ...(showErrors && !f.details.trim() ? { borderColor: C.red + "66" } : {}) }}
              maxLength={500}
            />
            <div style={{ fontSize: 10, color: f.details.length > 450 ? C.red : C.m, textAlign: "right", marginTop: 4 }}>{f.details.length}/500</div>
          </div>

          {/* Contact */}
          <div>
            <label htmlFor="post-contact" style={lb}>Contact (optional)</label>
            <input id="post-contact" value={f.contact} onChange={e => sF({ ...f, contact: e.target.value })} placeholder="Phone or email" style={{ fontSize: 16 }} />
          </div>

          {dateError && (
            <div role="alert" style={{ padding: "10px 14px", borderRadius: 12, background: C.red + "15", border: `1px solid ${C.red}33`, fontSize: 13, color: C.red }}>
              {dateError}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 8 }}>
            <button onClick={() => router.back()} style={{ padding: 16, borderRadius: 14, border: `1px solid ${C.bd}`, background: "transparent", color: C.m, cursor: "pointer", fontSize: 15, fontWeight: 600 }}>Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={submitting || submitted}
              style={{ position: "relative", overflow: "hidden", padding: 16, borderRadius: 14, border: "none", cursor: "pointer", background: submitted ? "#2ED573" : `linear-gradient(135deg,${C.gold},${C.gold}dd)`, fontSize: 15, fontWeight: 700, color: submitted ? "#fff" : C.bg, opacity: submitting ? 0.5 : 1, transition: "background 0.3s ease" }}
            >
              {submitted ? (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline-block", verticalAlign: "middle" }}><polyline points="20 6 9 17 4 12"/></svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "rgba(255,255,255,0.4)", animation: "rippleOut 0.6s ease-out forwards" }} />
                  </div>
                </>
              ) : submitting ? "Saving..." : editId ? "Save Changes" : "Post Swap"}
            </button>
          </div>
        </div>
      </main>
      {toast && <Toast message={toast} />}

      {showTemplates && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 300, display: "flex", alignItems: "flex-end" }} onClick={() => setShowTemplates(false)}>
          <div style={{ width: "100%", maxWidth: 520, margin: "0 auto", background: "rgb(6,5,52)", borderRadius: "20px 20px 0 0", padding: "20px 16px 40px", maxHeight: "70vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.white, marginBottom: 16 }}>Your Templates</div>
            {templates.map((t, i) => (
              <button key={i} onClick={() => {
                sF({
                  category: t.category,
                  details: t.details ?? "",
                  contact: t.contact ?? "",
                  date: "",
                  run: t.run ?? "",
                  route: t.route ?? "",
                  startTime: t.startTime ?? "",
                  clearTime: t.clearTime ?? "",
                  swingStart: t.swingStart ?? "",
                  swingEnd: t.swingEnd ?? "",
                  fromDate: "",
                  toDate: "",
                  vacationHave: t.vacationHave ?? "",
                  vacationWant: t.vacationWant ?? "",
                });
                setShowTemplates(false);
              }} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,.06)", background: "rgba(255,255,255,.03)", marginBottom: 8, cursor: "pointer" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.white }}>{t.templateName}</div>
                <div style={{ fontSize: 11, color: C.m, marginTop: 2 }}>{t.category} · {t.details?.slice(0, 60)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
