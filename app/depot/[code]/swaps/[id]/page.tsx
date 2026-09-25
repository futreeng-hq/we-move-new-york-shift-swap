"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import { shareSwap } from "@/lib/shareSwap";
import { Swap, SwapAgreement } from "@/types";
import { C, CM, STC, SWAP_TYPES } from "@/constants/colors";
import Icon from "@/components/ui/Icon";
import RepBadge from "@/components/ui/RepBadge";
import MsgModal from "@/components/ui/MsgModal";
import Toast from "@/components/ui/Toast";
import ConfirmModal from "@/components/ui/ConfirmModal";
import AgreementPanel from "@/components/ui/AgreementPanel";
import TimePicker from "@/components/ui/TimePicker";
import { timeAgo, fmtTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { formatSwapDate } from "@/lib/swapDate";

export default function SwapDetailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ code: string; id: string }>();
  const { code, id } = params;

  const [swap, setSwap] = useState<Swap | null>(null);
  const [agreement, setAgreement] = useState<SwapAgreement | null>(null);
  const [proposals, setProposals] = useState<SwapAgreement[]>([]);
  const [agreeLoaded, setAgreeLoaded] = useState(false);
  const [proposeModal, setProposeModal] = useState(false);
  const [proposeNote, setProposeNote] = useState("");
  // Schedule fields for propose modal
  const [pRun, setPRun] = useState("");
  const [pRoute, setPRoute] = useState("");
  const [pStart, setPStart] = useState("");
  const [pClear, setPClear] = useState("");
  const [pFromDay, setPFromDay] = useState("");
  const [pFromDate, setPFromDate] = useState("");
  const [pToDay, setPToDay] = useState("");
  const [pToDate, setPToDate] = useState("");
  const [pVacHave, setPVacHave] = useState("");
  const [pVacWant, setPVacWant] = useState("");
  const [proposeBusy, setProposeBusy] = useState(false);
  const [msgModal, setMsgModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: () => void } | null>(null);

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); }, []);
  const agreementRef = useRef<HTMLDivElement>(null);

  const handleShare = async () => {
    if (!id) return;
    await shareSwap(id, () => showToast(t("share.copied", user?.language ?? "en")));
  };

  useEffect(() => {
    if (agreeLoaded && agreement && agreementRef.current) {
      setTimeout(() => agreementRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 150);
    }
  }, [agreeLoaded, agreement]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    if (!loading && user && !user.depotId) router.replace("/setup-profile");
    if (!loading && user?.depot && user.depot.code !== code && user.role !== "admin" && user.role !== "subAdmin") router.replace(`/depot/${user.depot.code}/swaps`);
  }, [user, loading, router, code]);

  useEffect(() => {
    if (!id || !user) return;
    api.get<Swap>(`/swaps/${id}`).then((s) => {
      setSwap(s);
      // Owners also load the pending proposals list (trust v2: several
      // operators can propose concurrently).
      if (s.userId === user.id) {
        api.get<SwapAgreement[]>(`/swaps/${id}/agreement?list=1`)
          .then((list) => setProposals(list.filter((a) => a.status === "pending")))
          .catch(() => {});
      }
    }).catch(() => router.replace(`/depot/${code}/swaps`));
    api.get<SwapAgreement>(`/swaps/${id}/agreement`)
      .then(setAgreement)
      .catch(() => {})
      .finally(() => setAgreeLoaded(true));
    // Clear any in-app notifications pointing at this swap. The bell badge
    // stops counting "interested in your swap" / "swap confirmed" / etc. once
    // the user has actually opened the destination. Notifications themselves
    // are kept (mark read, not delete) for history.
    api.post(`/notifications/mark-read-by-url`, {
      url: `/depot/${code}/swaps/${id}`,
    }).then(() => {
      window.dispatchEvent(new Event("wmny:notifications-changed"));
    }).catch(() => {});
  }, [id, user, code, router]);

  const buildProposeNote = () => {
    if (!swap) return proposeNote || undefined;
    const lines: string[] = [];
    if (swap.category === "work") {
      if (pRun) lines.push(`Run: ${pRun}`);
      if (pRoute) lines.push(`Route: ${pRoute}`);
      if (pStart) lines.push(`Start: ${fmtTime(pStart)}`);
      if (pClear) lines.push(`Clear: ${fmtTime(pClear)}`);
    } else if (swap.category === "daysoff") {
      if (pFromDay || pFromDate) lines.push(`I have: ${[pFromDay, pFromDate].filter(Boolean).join(" ")}`);
      if (pToDay || pToDate) lines.push(`I want: ${[pToDay, pToDate].filter(Boolean).join(" ")}`);
    } else if (swap.category === "vacation") {
      if (pVacHave) lines.push(`I have: ${pVacHave}`);
      if (pVacWant) lines.push(`I want: ${pVacWant}`);
    }
    if (proposeNote.trim()) lines.push(proposeNote.trim());
    return lines.length ? lines.join("\n") : undefined;
  };

  const handlePropose = async () => {
    if (!id) return;
    setProposeBusy(true);
    try {
      const a = await api.post<SwapAgreement>(`/swaps/${id}/agreement`, { note: buildProposeNote() });
      setAgreement(a);
      // Trust v2: proposing does NOT lock the swap — it stays open on the board.
      setProposeModal(false);
      setProposeNote(""); setPRun(""); setPRoute(""); setPStart(""); setPClear("");
      setPFromDay(""); setPFromDate(""); setPToDay(""); setPToDate("");
      setPVacHave(""); setPVacWant("");
      showToast(t("trust.proposalToast", user?.language ?? "en"));
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Failed to propose"); }
    setProposeBusy(false);
  };

  // Trust v2 status side-effects: accepted locks the swap, completed fills it,
  // cancelling an accepted agreement reopens it.
  const handleAgreementUpdate = (a: SwapAgreement) => {
    setAgreement(a);
    if (a.status === "accepted") setSwap(prev => prev ? { ...prev, status: "pending" } : null);
    if (a.status === "completed") setSwap(prev => prev ? { ...prev, status: "filled" } : null);
    if (a.status === "cancelled") setSwap(prev => prev ? { ...prev, status: "open" } : null);
    refreshProposals();
  };

  const refreshProposals = () => {
    if (!id) return;
    api.get<SwapAgreement[]>(`/swaps/${id}/agreement?list=1`)
      .then((list) => setProposals(list.filter((p) => p.status === "pending")))
      .catch(() => {});
  };

  const handleSend = async (s: Swap, text: string) => {
    try {
      await api.post(`/users/${s.userId}/message`, { text });
      setMsgModal(false);
      router.push(`/depot/${code}/messages/${s.userId}`);
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Send failed"); }
  };

  const handleReport = () => {
    setConfirm({ title: "Report Swap", text: "Report this swap as inappropriate or spam?", action: async () => {
      try { await api.post(`/swaps/${id}/report`, {}); showToast("Reported. Thank you."); } catch {}
      setConfirm(null);
    }});
  };

  if (!swap) return null;
  const m = CM[swap.category] ?? CM.work;
  const co = SWAP_TYPES.find(x => x.id === swap.category);
  const st2 = STC[swap.status] ?? STC.open;
  const own = user && swap.userId === user.id;

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(1,0,40,.8)", backdropFilter: "blur(24px)", borderBottom: "1px solid rgba(255,255,255,.06)", padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push(`/depot/${code}/swaps`)} aria-label="Go back" style={{ width: 36, height: 36, borderRadius: 10, border: "1px solid " + C.bd, background: C.s, color: C.gold, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon n="back" s={16} /></button>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.white }}>Swap Details</div>
        <button onClick={handleShare} aria-label="Share this swap" style={{ width: 32, height: 32, borderRadius: 10, border: `1px solid ${C.bd}`, background: C.s, color: C.m, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
        {!own && <button onClick={handleReport} aria-label="Report this swap" style={{ width: 36, height: 36, borderRadius: 10, border: "1px solid " + C.bd, background: C.s, color: C.m, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon n="inf" s={14} /></button>}
      </div>

      <main id="main-content" tabIndex={-1} style={{ maxWidth: 520, margin: "0 auto", padding: "24px 20px 100px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: m.c }}>
            <Icon n={co?.ic || "swap"} s={18} />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{co?.f}</span>
          </div>
          <span style={{ padding: "4px 12px", borderRadius: 8, background: st2.bg, border: "1px solid " + st2.bd, fontSize: 11, fontWeight: 700, color: st2.c, textTransform: "uppercase", boxShadow: "0 0 8px " + st2.c + "22", letterSpacing: 1 }}>{swap.status === "filled" ? "Taken" : swap.status}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: `linear-gradient(135deg,${C.navy},${C.blue})`, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid " + C.gold + "44", flexShrink: 0 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: C.gold }}>{swap.posterName.split(" ").map(w => w[0]).join("").substring(0, 2)}</span>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.white }}>{swap.posterName}</div>
            <div style={{ fontSize: 12, color: C.m, marginTop: 2 }}>Posted {timeAgo(swap.createdAt)}</div>
          </div>
        </div>

        <RepBadge rep={swap.reputation} size="full" />

        <div style={{ background: "rgba(255,255,255,.03)", backdropFilter: "blur(12px)", borderRadius: 16, padding: 20, border: "1px solid rgba(255,255,255,.06)", marginBottom: 20, marginTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.m, textTransform: "uppercase", letterSpacing: 2, marginBottom: 10 }}>Details</div>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,.8)", lineHeight: 1.7 }}>{swap.details}</p>
        </div>

        {swap.category === "work" && (
          <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 16, padding: 20, border: "1px solid " + C.blue + "22", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <Icon n="tmr" s={16} c={C.blue} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: 2 }}>Shift Details</span>
            </div>
            {/* Run + Route */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              {[{ l: "Run Number", v: swap.run || "—" }, { l: "Route", v: swap.route || "—" }].map(t => (
                <div key={t.l} style={{ padding: 14, borderRadius: 12, background: C.blue + "0a", border: "1px solid " + C.blue + "18" }}>
                  <div style={{ fontSize: 10, color: C.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{t.l}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.white }}>{t.v}</div>
                </div>
              ))}
            </div>
            {/* Start → Clear */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: (swap.swingStart || swap.swingEnd) ? 10 : 0 }}>
              <div style={{ flex: 1, padding: 14, borderRadius: 12, background: C.blue + "0a", border: "1px solid " + C.blue + "18" }}>
                <div style={{ fontSize: 10, color: C.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Start Time</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: C.white }}>{fmtTime(swap.startTime) || "—"}</div>
              </div>
              <Icon n="arr" s={18} c={C.m} />
              <div style={{ flex: 1, padding: 14, borderRadius: 12, background: C.blue + "0a", border: "1px solid " + C.blue + "18" }}>
                <div style={{ fontSize: 10, color: C.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Clear Time</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: C.white }}>{fmtTime(swap.clearTime) || "—"}</div>
              </div>
            </div>
            {/* Swing times — only shown when present */}
            {(swap.swingStart || swap.swingEnd) && (
              <div style={{ padding: 14, borderRadius: 12, background: "rgba(255,255,255,.02)", border: "1px solid " + C.blue + "18" }}>
                <div style={{ fontSize: 10, color: C.m, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Swing Break</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: C.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Swing In</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.white }}>{fmtTime(swap.swingStart) || "—"}</div>
                  </div>
                  <Icon n="arr" s={16} c={C.m} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: C.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Swing Out</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.white }}>{fmtTime(swap.swingEnd) || "—"}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {swap.category === "daysoff" && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "stretch", marginBottom: 14 }}>
              <div style={{ padding: 16, borderRadius: 14, background: C.gs, border: "1px solid " + C.gg }}>
                <div style={{ fontSize: 10, color: C.gold, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Swapping From</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.white }}>{swap.fromDay || "—"}</div>
                {swap.fromDate && <div style={{ fontSize: 12, color: C.m, marginTop: 4 }}>{formatSwapDate(swap.fromDate, { month: "long", day: "numeric", year: "numeric" })}</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center" }}><Icon n="swap" s={20} c={C.m} /></div>
              <div style={{ padding: 16, borderRadius: 14, background: C.blue + "12", border: "1px solid " + C.blue + "22" }}>
                <div style={{ fontSize: 10, color: C.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Swapping To</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.white }}>{swap.toDay || "—"}</div>
                {swap.toDate && <div style={{ fontSize: 12, color: C.m, marginTop: 4 }}>{formatSwapDate(swap.toDate, { month: "long", day: "numeric", year: "numeric" })}</div>}
              </div>
            </div>
          </div>
        )}

        {swap.category === "vacation" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "stretch", marginBottom: 20 }}>
            <div style={{ padding: 20, borderRadius: 14, background: "rgba(0,201,167,.06)", border: "1px solid rgba(0,201,167,.2)", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#00C9A7", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Week You Have</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.white }}>{swap.vacationHave || "—"}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center" }}><Icon n="swap" s={20} c={C.m} /></div>
            <div style={{ padding: 20, borderRadius: 14, background: C.blue + "12", border: "1px solid " + C.blue + "22", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: C.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Week You Want</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.white }}>{swap.vacationWant || "—"}</div>
            </div>
          </div>
        )}

        {swap.contact && (
          <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 14, padding: 16, border: "1px solid rgba(255,255,255,.06)", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <Icon n="ph" s={18} c={C.gold} />
            <div>
              <div style={{ fontSize: 10, color: C.m, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>Contact</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.white }}>{swap.contact}</div>
            </div>
          </div>
        )}

        {!own && swap.status === "open" && (
          <button onClick={() => setMsgModal(true)} style={{ width: "100%", padding: 14, borderRadius: 16, border: `1px solid ${m.c}55`, cursor: "pointer", background: "transparent", fontSize: 14, fontWeight: 600, color: m.c, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Icon n="msg" s={16} c={m.c} /> Send Message
          </button>
        )}

        {!own && swap.status === "open" && agreeLoaded && !agreement && (
          <div style={{ textAlign: "center", fontSize: 11, color: C.m, margin: "12px 0 0", lineHeight: 1.5 }}>
            Ready to make it official? Use the agreement below.
          </div>
        )}

        <div ref={agreementRef}>
          {!own && agreeLoaded && (
            <AgreementPanel
              swap={swap}
              agreement={agreement}
              isOwner={false}
              currentUserId={user?.id ?? ""}
              onUpdate={handleAgreementUpdate}
              onPropose={() => setProposeModal(true)}
              onPrint={() => window.open(`/depot/${code}/swaps/${id}/print`, "_blank")}
            />
          )}

          {own && agreeLoaded && (
            <AgreementPanel
              swap={swap}
              agreement={agreement}
              proposals={proposals}
              isOwner={true}
              currentUserId={user?.id ?? ""}
              onUpdate={handleAgreementUpdate}
              onProposalsChanged={refreshProposals}
              onPropose={() => {}}
              onPrint={() => window.open(`/depot/${code}/swaps/${id}/print`, "_blank")}
            />
          )}
        </div>
      </main>

      {msgModal && swap && <MsgModal swap={swap} onSend={handleSend} onClose={() => setMsgModal(false)} />}
      {confirm && <ConfirmModal title={confirm.title} text={confirm.text} onConfirm={confirm.action} onCancel={() => setConfirm(null)} />}
      {toast && <Toast message={toast} />}

      {proposeModal && swap && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", display: "flex", alignItems: "flex-end", zIndex: 200 }} onClick={() => setProposeModal(false)}>
          <div style={{ width: "100%", background: "rgb(4,3,45)", borderRadius: "24px 24px 0 0", padding: "24px 20px 44px", maxWidth: 520, margin: "0 auto", maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.white, marginBottom: 4 }}>Agree to Swap</div>
            <div style={{ fontSize: 12, color: C.m, lineHeight: 1.5, marginBottom: 18 }}>Enter your schedule — both operators must confirm to complete the swap.</div>

            {swap.category === "work" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: C.m, marginBottom: 4 }}>Run #</div>
                    <input value={pRun} onChange={e => setPRun(e.target.value)} placeholder="e.g. 42" style={{ width: "100%", padding: "10px 13px", borderRadius: 10, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.05)", color: C.white, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: C.m, marginBottom: 4 }}>Route</div>
                    <input value={pRoute} onChange={e => setPRoute(e.target.value)} placeholder="e.g. M15" style={{ width: "100%", padding: "10px 13px", borderRadius: 10, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.05)", color: C.white, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                  <TimePicker
                    id="propose-start"
                    label="Start Time"
                    value={pStart}
                    onChange={setPStart}
                    dateStr={swap.date ?? undefined}
                  />
                  <TimePicker
                    id="propose-clear"
                    label="Clear Time"
                    value={pClear}
                    onChange={setPClear}
                    dateStr={swap.date ?? undefined}
                  />
                </div>
              </>
            )}

            {swap.category === "daysoff" && (
              <>
                <div style={{ fontSize: 11, color: C.m, marginBottom: 6 }}>What are you offering?</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: C.m, marginBottom: 4 }}>Day I have</div>
                    <select value={pFromDay} onChange={e => setPFromDay(e.target.value)} style={{ width: "100%", padding: "10px 13px", borderRadius: 10, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.05)", color: C.white, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }}>
                      <option value="">Select</option>
                      {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: C.m, marginBottom: 4 }}>Date (optional)</div>
                    <input type="date" value={pFromDate} onChange={e => setPFromDate(e.target.value)} style={{ width: "100%", padding: "10px 13px", borderRadius: 10, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.05)", color: C.white, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ fontSize: 11, color: C.m, marginBottom: 6 }}>What do you want in return?</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, color: C.m, marginBottom: 4 }}>Day I want</div>
                    <select value={pToDay} onChange={e => setPToDay(e.target.value)} style={{ width: "100%", padding: "10px 13px", borderRadius: 10, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.05)", color: C.white, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }}>
                      <option value="">Select</option>
                      {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: C.m, marginBottom: 4 }}>Date (optional)</div>
                    <input type="date" value={pToDate} onChange={e => setPToDate(e.target.value)} style={{ width: "100%", padding: "10px 13px", borderRadius: 10, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.05)", color: C.white, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }} />
                  </div>
                </div>
              </>
            )}

            {swap.category === "vacation" && (
              <div style={{ marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 11, color: C.m, marginBottom: 4 }}>Vacation I have</div>
                  <input value={pVacHave} onChange={e => setPVacHave(e.target.value)} placeholder="e.g. Week of July 14–18" style={{ width: "100%", padding: "10px 13px", borderRadius: 10, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.05)", color: C.white, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", marginBottom: 10 }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.m, marginBottom: 4 }}>Vacation I want</div>
                  <input value={pVacWant} onChange={e => setPVacWant(e.target.value)} placeholder="e.g. Week of Aug 4–8" style={{ width: "100%", padding: "10px 13px", borderRadius: 10, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.05)", color: C.white, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              </div>
            )}

            <div style={{ borderTop: `1px solid rgba(255,255,255,.07)`, marginBottom: 16 }} />
            <div style={{ fontSize: 11, color: C.m, marginBottom: 4 }}>Additional note (optional)</div>
            <textarea
              value={proposeNote}
              onChange={e => setProposeNote(e.target.value)}
              placeholder="Anything else to add..."
              maxLength={200}
              rows={2}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.04)", color: C.white, fontSize: 14, resize: "none", fontFamily: "inherit", marginBottom: 16, boxSizing: "border-box" }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button onClick={() => setProposeModal(false)} style={{ padding: 14, borderRadius: 14, border: `1px solid ${C.bd}`, background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.m }}>Cancel</button>
              <button onClick={handlePropose} disabled={proposeBusy} style={{ padding: 14, borderRadius: 14, border: "none", background: "linear-gradient(135deg,#00C9A7,#00C9A7cc)", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#fff", opacity: proposeBusy ? 0.7 : 1 }}>
                {proposeBusy ? "Sending..." : "Agree to Swap"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
