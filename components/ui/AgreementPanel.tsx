"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Swap, SwapAgreement } from "@/types";
import { C } from "@/constants/colors";
import Icon from "./Icon";
import Confetti from "./Confetti";
import { playClick, playChime } from "@/lib/sound";
import { useAuth } from "@/lib/AuthContext";
import { useT } from "@/lib/i18n";
import { analytics } from "@/lib/analytics";
import { formatSwapDate } from "@/lib/swapDate";

interface Props {
  swap: Swap;
  agreement: SwapAgreement | null;
  /** Owner only: pending proposals on the swap (from GET ?list=1). */
  proposals?: SwapAgreement[];
  isOwner: boolean;
  currentUserId: string;
  onUpdate: (a: SwapAgreement) => void;
  /** Called after accept/decline so the parent can refetch the proposals list. */
  onProposalsChanged?: () => void;
  onPropose: () => void;
  onPrint?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B",
  userA_confirmed: "#60A5FA",
  accepted: "#60A5FA",
  completed: "#00C9A7",
  cancelled: "#EF4444",
  declined: "#888",
  disputed: "#F59E0B",
};

const STATUS_BADGES: Record<string, string> = {
  pending: "Proposal Sent",
  userA_confirmed: "Awaiting You",
  accepted: "Locked In",
  completed: "Taken",
  cancelled: "Cancelled",
  declined: "Declined",
  disputed: "Under Review",
};

function SwapSummary({ swap }: { swap: Swap }) {
  const lines: string[] = [];
  if (swap.category === "work") {
    if (swap.run) lines.push(`Run ${swap.run}`);
    if (swap.route) lines.push(`Route ${swap.route}`);
    if (swap.startTime) lines.push(`Start ${swap.startTime}`);
    if (swap.clearTime) lines.push(`Clear ${swap.clearTime}`);
  } else if (swap.category === "daysoff") {
    if (swap.fromDay) lines.push(`Has: ${swap.fromDay}${swap.fromDate ? " " + formatSwapDate(swap.fromDate) : ""}`);
    if (swap.toDay) lines.push(`Wants: ${swap.toDay}${swap.toDate ? " " + formatSwapDate(swap.toDate) : ""}`);
  } else if (swap.category === "vacation") {
    if (swap.vacationHave) lines.push(`Has: ${swap.vacationHave}`);
    if (swap.vacationWant) lines.push(`Wants: ${swap.vacationWant}`);
  }
  if (!lines.length) lines.push(swap.details.substring(0, 60));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize: 11, color: C.white, lineHeight: 1.4 }}>{l}</div>
      ))}
    </div>
  );
}

/** True once the shift is behind us and the "did it happen?" card should show. */
function isPostShift(agreement: SwapAgreement): boolean {
  const now = Date.now();
  if (agreement.shiftDate) {
    // shiftDate is a date-only value; the shift is "past" the following day.
    return now > new Date(agreement.shiftDate).getTime() + 24 * 3600_000;
  }
  if (agreement.acceptedAt) {
    // Undated (vacation) swaps: prompt after 30 days, mirroring the cron.
    return now > new Date(agreement.acceptedAt).getTime() + 30 * 86400_000;
  }
  return false;
}

/** Star rating input shown once the agreement is completed. */
function ReviewStars({ swapId }: { swapId: string }) {
  const { user } = useAuth();
  const tt = useT(user?.language);
  const [existing, setExisting] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hover, setHover] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<{ rating: number }>(`/swaps/${swapId}/review`)
      .then((r) => setExisting(r.rating))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [swapId]);

  const submit = async (rating: number) => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/swaps/${swapId}/review`, { rating });
      setExisting(rating);
      playChime();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Rating failed");
    } finally { setBusy(false); }
  };

  if (!loaded) return null;
  return (
    <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: "rgba(209,173,56,.06)", border: "1px solid rgba(209,173,56,.2)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 6 }}>
        {existing ? tt("trust.yourRating") : tt("trust.rate")}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = existing ? n <= existing : n <= hover;
          return (
            <button
              key={n}
              disabled={busy || existing != null}
              onClick={() => submit(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              style={{ background: "none", border: "none", cursor: existing ? "default" : "pointer", fontSize: 22, color: filled ? C.gold : "rgba(255,255,255,.2)", padding: 0, lineHeight: 1 }}
            >★</button>
          );
        })}
      </div>
      {!existing && <div style={{ fontSize: 10, color: C.m, marginTop: 6 }}>{tt("trust.rateHint")}</div>}
      {error && <div role="alert" style={{ fontSize: 11, color: "#EF4444", marginTop: 6 }}>{error}</div>}
    </div>
  );
}

/** Post-shift "did it happen?" card. */
function DidItHappenCard({ swapId, agreement, currentUserId, onUpdate }: {
  swapId: string; agreement: SwapAgreement; currentUserId: string; onUpdate: (a: SwapAgreement) => void;
}) {
  const { user } = useAuth();
  const tt = useT(user?.language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isUserA = agreement.userAId === currentUserId;
  const myAnswer = isUserA ? agreement.userAHappened : agreement.userBHappened;
  const otherAnswer = isUserA ? agreement.userBHappened : agreement.userAHappened;

  const answer = async (happened: boolean) => {
    setBusy(true);
    setError("");
    try {
      const updated = await api.patch<SwapAgreement>(`/swaps/${swapId}/agreement`, {
        action: happened ? "confirm_happened" : "report_noshow",
        agreementId: agreement.id,
      });
      if (updated.status === "completed") playChime();
      onUpdate(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally { setBusy(false); }
  };

  if (myAnswer != null) {
    return (
      <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,.04)", border: `1px solid ${C.bd}` }}>
        <div style={{ fontSize: 12, color: C.white, fontWeight: 600 }}>
          {myAnswer ? tt("trust.youAnsweredYes") : tt("trust.youAnsweredNo")}
        </div>
        {otherAnswer == null && (
          <div style={{ fontSize: 11, color: C.m, marginTop: 4 }}>{tt("trust.waitingOther")}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12, padding: "14px 16px", borderRadius: 12, background: "rgba(96,165,250,.08)", border: "1px solid rgba(96,165,250,.25)" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#60A5FA", marginBottom: 4 }}>{tt("trust.didItHappen")}</div>
      <div style={{ fontSize: 11, color: C.m, marginBottom: 10, lineHeight: 1.5 }}>
        {tt("trust.didItHappenHint")}
      </div>
      {error && <div role="alert" style={{ fontSize: 11, color: "#EF4444", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button onClick={() => { playClick(); answer(true); }} disabled={busy} style={{ padding: 12, borderRadius: 12, border: "none", background: "linear-gradient(135deg,#00C9A7,#00C9A7cc)", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#fff", opacity: busy ? 0.6 : 1 }}>
          {tt("trust.itHappened")}
        </button>
        <button onClick={() => answer(false)} disabled={busy} style={{ padding: 12, borderRadius: 12, border: "1px solid #EF444433", background: "#EF444412", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#EF4444", opacity: busy ? 0.6 : 1 }}>
          {tt("trust.itDidnt")}
        </button>
      </div>
    </div>
  );
}

/** Owner's list of pending proposals with Accept / Decline. */
function ProposalsList({ swapId, proposals, onUpdate, onProposalsChanged }: {
  swapId: string; proposals: SwapAgreement[]; onUpdate: (a: SwapAgreement) => void; onProposalsChanged?: () => void;
}) {
  const { user } = useAuth();
  const tt = useT(user?.language);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const act = async (proposal: SwapAgreement, action: "accept" | "decline") => {
    setBusyId(proposal.id);
    setError("");
    try {
      const updated = await api.patch<SwapAgreement>(`/swaps/${swapId}/agreement`, { action, agreementId: proposal.id });
      if (action === "accept") {
        playChime();
        analytics.agreementCompleted(swapId);
        onUpdate(updated);
      }
      onProposalsChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed");
      onProposalsChanged?.();
    } finally { setBusyId(null); }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon n="shield" s={16} c="#F59E0B" />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", textTransform: "uppercase", letterSpacing: 1 }}>
          {tt("trust.proposals")} ({proposals.length})
        </span>
      </div>
      <div style={{ fontSize: 11, color: C.m, marginBottom: 10, lineHeight: 1.5 }}>
        {tt("trust.proposalsHint")}
      </div>
      {error && <div role="alert" style={{ padding: "8px 12px", borderRadius: 10, background: "#EF444415", border: "1px solid #EF444433", fontSize: 12, color: "#EF4444", marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {proposals.map((p) => (
          <div key={p.id} style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,.04)", border: "1px solid rgba(245,158,11,.25)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.white, marginBottom: 6 }}>
              {p.userA ? `${p.userA.firstName} ${p.userA.lastName}` : "Operator"}
            </div>
            {p.userANote ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
                {p.userANote.split("\n").filter(Boolean).map((line, i) => (
                  <div key={i} style={{ fontSize: 11, color: C.white, lineHeight: 1.4 }}>{line}</div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: C.m, marginBottom: 10 }}>{tt("trust.noSchedule")}</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button onClick={() => act(p, "decline")} disabled={busyId != null} style={{ padding: 10, borderRadius: 10, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.04)", cursor: "pointer", fontSize: 12, fontWeight: 600, color: C.m, opacity: busyId ? 0.6 : 1 }}>
                {tt("trust.decline")}
              </button>
              <button onClick={() => { playClick(); act(p, "accept"); }} disabled={busyId != null} style={{ padding: 10, borderRadius: 10, border: "none", background: "linear-gradient(135deg,#00C9A7,#00C9A7cc)", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#fff", opacity: busyId ? 0.6 : 1 }}>
                {tt("trust.accept")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Add-to-calendar link — hidden for undated (vacation) agreements. Plain
 * <a href> so mobile OSes hand the .ics to the native calendar. */
function CalendarButton({ swapId, hasShiftDate, label, color }: { swapId: string; hasShiftDate: boolean; label: string; color: string }) {
  if (!hasShiftDate) return null;
  return (
    <a
      href={`/api/swaps/${swapId}/agreement/calendar`}
      style={{ width: "100%", marginTop: 8, padding: "10px 14px", borderRadius: 10, border: `1px solid ${color}66`, background: `${color}1f`, cursor: "pointer", fontSize: 13, fontWeight: 700, color, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, textDecoration: "none", boxSizing: "border-box" }}
    >
      📅 {label}
    </a>
  );
}

export default function AgreementPanel({ swap, agreement, proposals, isOwner, currentUserId, onUpdate, onProposalsChanged, onPropose, onPrint }: Props) {
  const { user } = useAuth();
  const tt = useT(user?.language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);

  const act = async (action: "confirm" | "cancel") => {
    setBusy(true);
    setError("");
    try {
      const updated = await api.patch<SwapAgreement>(`/swaps/${swap.id}/agreement`, {
        action,
        ...(agreement ? { agreementId: agreement.id } : {}),
      });
      if (updated.status === "completed") {
        setShowConfetti(true);
        playChime();
        analytics.agreementCompleted(swap.id);
      }
      onUpdate(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally { setBusy(false); }
  };

  // ── Owner with pending proposals and no live agreement ───────────────────
  const hasLiveAgreement =
    agreement && ["accepted", "userA_confirmed", "completed", "disputed"].includes(agreement.status);
  if (isOwner && !hasLiveAgreement) {
    if (proposals && proposals.length > 0) {
      return <ProposalsList swapId={swap.id} proposals={proposals} onUpdate={onUpdate} onProposalsChanged={onProposalsChanged} />;
    }
    return null; // Owner sees nothing until someone proposes
  }

  // ── Non-owner with no agreement: propose CTA ─────────────────────────────
  if (!agreement) {
    if (isOwner) return null;
    return (
      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => { playClick(); analytics.agreementStarted(swap.id); onPropose(); }}
          style={{ width: "100%", padding: "16px 20px", borderRadius: 16, border: `1px solid #00C9A744`, background: "rgba(0,201,167,.08)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#00C9A7" }}
        >
          <Icon n="agree" s={18} c="#00C9A7" />
          {tt("trust.propose")}
        </button>
        <div style={{ fontSize: 10, color: C.m, textAlign: "center", marginTop: 8, lineHeight: 1.5 }}>
          {tt("trust.proposeHint")}
        </div>
      </div>
    );
  }

  // ── Proposer's pending proposal: sent state + withdraw ───────────────────
  if (!isOwner && agreement.status === "pending") {
    return (
      <div style={{ marginTop: 16, background: "rgba(255,255,255,.03)", borderRadius: 16, padding: 18, border: "1px solid rgba(245,158,11,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Icon n="shield" s={16} c="#F59E0B" />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", textTransform: "uppercase", letterSpacing: 1 }}>{tt("trust.proposalSent")}</span>
        </div>
        <div style={{ fontSize: 12, color: C.m, lineHeight: 1.5, marginBottom: 12 }}>
          {tt("trust.proposalReviewing")}
        </div>
        {error && <div role="alert" style={{ padding: "8px 12px", borderRadius: 10, background: "#EF444415", border: "1px solid #EF444433", fontSize: 12, color: "#EF4444", marginBottom: 10 }}>{error}</div>}
        <button onClick={() => act("cancel")} disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 12, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.04)", cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.m, opacity: busy ? 0.6 : 1 }}>
          {tt("trust.withdraw")}
        </button>
      </div>
    );
  }

  // ── Proposer's declined proposal: neutral note ───────────────────────────
  if (!isOwner && agreement.status === "declined") {
    return (
      <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 12, background: "rgba(255,255,255,.03)", border: `1px solid ${C.bd}` }}>
        <div style={{ fontSize: 12, color: C.m, lineHeight: 1.5 }}>
          {tt("trust.declinedNote")}
        </div>
      </div>
    );
  }

  const color = STATUS_COLORS[agreement.status] ?? C.m;
  const isInitiator = agreement.userAId === currentUserId;
  // Legacy compat: initiator can still confirm old userA_confirmed records.
  const canConfirm = isInitiator && !isOwner && agreement.status === "userA_confirmed";
  const isAccepted = agreement.status === "accepted";
  const isDisputed = agreement.status === "disputed";
  const isCompleted = agreement.status === "completed";
  const canCancel = (isAccepted || agreement.status === "userA_confirmed") && !isPostShift(agreement);

  return (
    <div style={{ marginTop: 16, background: "rgba(255,255,255,.03)", borderRadius: 16, padding: 18, border: `1px solid ${color}22` }}>
      {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Icon n="shield" s={16} c={color} />
        <span style={{ fontSize: 12, fontWeight: 700, color: color, textTransform: "uppercase", letterSpacing: 1 }}>Swap Agreement</span>
        <span style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 20, background: color + "18", border: `1px solid ${color}33`, fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {tt(`trust.badge.${agreement.status}`) !== `trust.badge.${agreement.status}` ? tt(`trust.badge.${agreement.status}`) : (STATUS_BADGES[agreement.status] ?? agreement.status)}
        </span>
      </div>

      {/* Accepted banner */}
      {isAccepted && (
        <div style={{ background: "rgba(96,165,250,.08)", border: "1px solid rgba(96,165,250,.25)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#60A5FA" }}>{tt("trust.lockedIn")}</div>
          <div style={{ fontSize: 11, color: C.m, marginTop: 2, lineHeight: 1.5 }}>
            {tt("trust.lockedInHint")}
          </div>
          {onPrint && (
            <button
              onClick={onPrint}
              style={{ width: "100%", marginTop: 10, padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(96,165,250,.4)", background: "rgba(96,165,250,.12)", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#60A5FA", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>
              {tt("trust.printAgreement")}
            </button>
          )}
          <CalendarButton swapId={swap.id} hasShiftDate={agreement.shiftDate != null} label={tt("trust.addToCalendar")} color="#60A5FA" />
        </div>
      )}

      {/* Disputed banner */}
      {isDisputed && (
        <div style={{ background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#F59E0B" }}>{tt("trust.disputed")}</div>
          <div style={{ fontSize: 11, color: C.m, marginTop: 2, lineHeight: 1.5 }}>
            {tt("trust.disputedHint")}
          </div>
        </div>
      )}

      {/* TAKEN banner */}
      {isCompleted && (
        <div style={{ background: "rgba(0,201,167,.1)", border: "1px solid rgba(0,201,167,.3)", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: onPrint ? 12 : 0 }}>
            <Icon n="chk" s={20} c="#00C9A7" />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#00C9A7" }}>{tt("trust.taken")}</div>
              <div style={{ fontSize: 11, color: C.m, marginTop: 2 }}>
                Confirmed {agreement.completedAt ? new Date(agreement.completedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : ""}
              </div>
            </div>
          </div>
          {onPrint && (
            <button
              onClick={onPrint}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(0,201,167,.4)", background: "rgba(0,201,167,.12)", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#00C9A7", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>
              Print Agreement
            </button>
          )}
          <CalendarButton swapId={swap.id} hasShiftDate={agreement.shiftDate != null} label={tt("trust.addToCalendar")} color="#00C9A7" />
        </div>
      )}

      {/* Both parties side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "stretch", marginBottom: 14 }}>
        {/* Poster's swap info */}
        <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)" }}>
          <div style={{ fontSize: 9, color: C.m, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>Poster</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.white, marginBottom: 6 }}>
            {agreement.userB ? `${agreement.userB.firstName} ${agreement.userB.lastName}` : swap.posterName}
          </div>
          <SwapSummary swap={swap} />
          {agreement.userBAt && <div style={{ fontSize: 9, color: "#00C9A7", marginTop: 6 }}>✓ Confirmed</div>}
          {agreement.userBNote && (
            <div style={{ fontSize: 10, color: C.m, marginTop: 6, lineHeight: 1.4, borderTop: "1px solid rgba(255,255,255,.05)", paddingTop: 6 }}>{agreement.userBNote}</div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <Icon n="swap" s={16} c={color} />
        </div>

        {/* Proposer's schedule */}
        <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)" }}>
          <div style={{ fontSize: 9, color: C.m, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>Interested</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.white, marginBottom: 6 }}>
            {agreement.userA ? `${agreement.userA.firstName} ${agreement.userA.lastName}` : "—"}
          </div>
          {agreement.userANote ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {agreement.userANote.split("\n").filter(Boolean).map((line, i) => (
                <div key={i} style={{ fontSize: 11, color: C.white, lineHeight: 1.4 }}>{line}</div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: C.m }}>No schedule added</div>
          )}
          {agreement.userAAt && <div style={{ fontSize: 9, color: "#00C9A7", marginTop: 6 }}>✓ Confirmed</div>}
        </div>
      </div>

      {error && <div role="alert" style={{ padding: "8px 12px", borderRadius: 10, background: "#EF444415", border: "1px solid #EF444433", fontSize: 12, color: "#EF4444", marginBottom: 10 }}>{error}</div>}

      {/* Post-shift "did it happen?" card */}
      {isAccepted && isPostShift(agreement) && (
        <DidItHappenCard swapId={swap.id} agreement={agreement} currentUserId={currentUserId} onUpdate={onUpdate} />
      )}

      {/* Review stars after completion */}
      {isCompleted && <ReviewStars swapId={swap.id} />}

      {/* Legacy userA_confirmed confirm path */}
      {canConfirm && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button onClick={() => act("cancel")} disabled={busy} style={{ padding: 12, borderRadius: 12, border: "1px solid #EF444433", background: "#EF444412", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#EF4444", opacity: busy ? 0.6 : 1 }}>
            <Icon n="del" s={14} c="#EF4444" /> Cancel
          </button>
          <button onClick={() => { playClick(); act("confirm"); }} disabled={busy} style={{ padding: 12, borderRadius: 12, border: "none", background: `linear-gradient(135deg,#00C9A7,#00C9A7cc)`, cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#fff", opacity: busy ? 0.6 : 1 }}>
            <Icon n="chk" s={14} c="#fff" /> Confirm
          </button>
        </div>
      )}

      {/* Cancel an accepted agreement — real ding, say so */}
      {!canConfirm && canCancel && (
        <div style={{ marginTop: isAccepted ? 4 : 0 }}>
          <button onClick={() => act("cancel")} disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #EF444433", background: "#EF444412", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#EF4444", opacity: busy ? 0.6 : 1 }}>
            {tt("trust.cancelAgreement")}
          </button>
          <div style={{ fontSize: 10, color: C.m, textAlign: "center", marginTop: 6 }}>
            {tt("trust.cancelWarning")}
          </div>
        </div>
      )}
    </div>
  );
}
