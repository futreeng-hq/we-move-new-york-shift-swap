"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import { C, CM, STC, SWAP_TYPES } from "@/constants/colors";
import Icon from "@/components/ui/Icon";
import RepBadge from "@/components/ui/RepBadge";
import { QRCodeSVG } from "qrcode.react";
import { parseSwapDate } from "@/lib/swapDate";

interface DayData { date: string; posted: number; agreements: number; }

function ActivityChart({ data }: { data: DayData[] }) {
  const maxVal = Math.max(...data.map(d => Math.max(d.posted, d.agreements)), 1);
  const W = 300; const H = 60; const padB = 18;
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => (1 - v / maxVal) * (H - padB);

  const linePath = (key: "posted" | "agreements") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");

  const areaPath = (key: "posted" | "agreements") =>
    `${linePath(key)} L${W},${H - padB} L0,${H - padB} Z`;

  // Show every 7th label
  const labelIdxs = [0, 7, 14, 21, 29];
  const fmt = (d: string) => { const dt = parseSwapDate(d); return dt ? `${dt.getMonth() + 1}/${dt.getDate()}` : ""; };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 72 }} aria-label="30-day activity chart" role="img">
      <defs>
        <linearGradient id="rc-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D1AD38" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#D1AD38" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="rc-teal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00C9A7" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#00C9A7" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath("posted")} fill="url(#rc-gold)" />
      <path d={areaPath("agreements")} fill="url(#rc-teal)" />
      <path d={linePath("posted")} fill="none" stroke="#D1AD38" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={linePath("agreements")} fill="none" stroke="#00C9A7" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 2" />
      <line x1="0" y1={H - padB} x2={W} y2={H - padB} stroke="rgba(255,255,255,.06)" strokeWidth="1" />
      {labelIdxs.map(i => data[i] ? (
        <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : i === 29 ? "end" : "middle"} fontSize="7" fill="rgba(255,255,255,.3)">
          {fmt(data[i].date)}
        </text>
      ) : null)}
    </svg>
  );
}

interface DashData {
  depot: { name: string; code: string; operator: string };
  swapCounts: { status: string; category: string; _count: number }[];
  recentAgreements: {
    id: string;
    status: string;
    createdAt: string;
    swap: { id: string; details: string; category: string; posterName: string };
    userA: { id: string; firstName: string; lastName: string };
    userB: { id: string; firstName: string; lastName: string };
  }[];
  topOperators: {
    id: string;
    completed: number;
    cancelled: number;
    noShow: number;
    user: { id: string; firstName: string; lastName: string };
  }[];
  reportCount: number;
}

export default function RepDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = params.code;
  const [data, setData] = useState<DashData | null>(null);
  const [analytics, setAnalytics] = useState<DayData[]>([]);
  const [error, setError] = useState("");
  const [inviteCodes, setInviteCodes] = useState<{ code: string; isValid: boolean; usedBy?: string | null }[]>([]);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const appUrl = typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL ?? "");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    if (!loading && user && !user.depotId) router.replace("/setup-profile");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== "depotRep" && user.role !== "admin") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- role guard: the check needs the loaded user, so the state can only be set after render
      setError("Access restricted to depot reps and admins.");
      return;
    }
    api.get<DashData>(`/depots/${code}/rep-dashboard`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
    api.get<DayData[]>(`/depots/${code}/rep-dashboard/analytics`)
      .then(setAnalytics)
      .catch(() => {});
    api.get<{ inviteCodes: { code: string; isValid: boolean }[] }>("/users/me")
      .then(d => setInviteCodes(d.inviteCodes ?? []))
      .catch(() => {});
  }, [user, code]);

  if (!user) return null;

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <Icon n="shield" s={40} c={C.red} />
          <div style={{ fontSize: 16, fontWeight: 700, color: C.white, marginTop: 12 }}>{error}</div>
          <button onClick={() => router.back()} style={{ marginTop: 16, padding: "12px 24px", borderRadius: 14, border: `1px solid ${C.bd}`, background: C.s, cursor: "pointer", fontSize: 14, color: C.m }}>Go Back</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.m }}>Loading...</div>;
  }

  // Build summary stats
  const open = data.swapCounts.filter(c => c.status === "open").reduce((a, c) => a + c._count, 0);
  const pending = data.swapCounts.filter(c => c.status === "pending").reduce((a, c) => a + c._count, 0);
  const filled = data.swapCounts.filter(c => c.status === "filled").reduce((a, c) => a + c._count, 0);
  const byCategory: Record<string, number> = {};
  for (const c of data.swapCounts) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + c._count;
  }

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(1,0,40,.85)", backdropFilter: "blur(24px)", borderBottom: `1px solid ${C.bd}`, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push(`/depot/${code}`)} aria-label="Go back" style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.bd}`, background: C.s, color: C.gold, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon n="back" s={16} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.white }}>Rep Dashboard</div>
          <div style={{ fontSize: 10, color: C.gold, letterSpacing: 2, textTransform: "uppercase" }}>{data.depot.name} — Read Only</div>
        </div>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "#C084FC18", border: "1px solid #C084FC33", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon n="shield" s={18} c="#C084FC" />
        </div>
      </div>

      <main id="main-content" tabIndex={-1} style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px" }}>
        {/* 30-day activity chart */}
        {analytics.length > 0 && (
          <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 14, padding: 16, border: `1px solid ${C.bd}`, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 2 }}>30-Day Activity</div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 12, height: 2, background: C.gold, borderRadius: 1 }} />
                  <span style={{ fontSize: 9, color: C.m }}>Posted</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 12, height: 2, background: "#00C9A7", borderRadius: 1, borderTop: "1px dashed #00C9A7" }} />
                  <span style={{ fontSize: 9, color: C.m }}>Agreements</span>
                </div>
              </div>
            </div>
            <ActivityChart data={analytics} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
              <div style={{ padding: "8px 12px", borderRadius: 10, background: C.gold + "08", border: `1px solid ${C.gold}22` }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.gold }}>
                  {analytics.reduce((s, d) => s + d.posted, 0)}
                </div>
                <div style={{ fontSize: 9, color: C.m, textTransform: "uppercase", letterSpacing: 1 }}>Swaps posted</div>
              </div>
              <div style={{ padding: "8px 12px", borderRadius: 10, background: "#00C9A708", border: "1px solid #00C9A722" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#00C9A7" }}>
                  {analytics.reduce((s, d) => s + d.agreements, 0)}
                </div>
                <div style={{ fontSize: 9, color: C.m, textTransform: "uppercase", letterSpacing: 1 }}>Agreements</div>
              </div>
            </div>
          </div>
        )}

        {/* Summary stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { l: "Open", v: open, c: STC.open.c },
            { l: "Pending", v: pending, c: STC.pending.c },
            { l: "Filled", v: filled, c: STC.filled.c },
          ].map(stat => (
            <div key={stat.l} style={{ padding: 14, borderRadius: 14, background: stat.c + "12", border: `1px solid ${stat.c}22`, textAlign: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: stat.c }}>{stat.v}</div>
              <div style={{ fontSize: 10, color: C.m, textTransform: "uppercase", letterSpacing: 1 }}>{stat.l}</div>
            </div>
          ))}
        </div>

        {/* By category */}
        <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 14, padding: 16, border: `1px solid ${C.bd}`, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Swaps by Category</div>
          <div style={{ display: "grid", gap: 8 }}>
            {Object.entries(byCategory).map(([cat, count]) => {
              const co = SWAP_TYPES.find(x => x.id === cat);
              const colors = CM[cat as keyof typeof CM] ?? CM.work;
              const maxCount = Math.max(...Object.values(byCategory));
              return (
                <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 80, fontSize: 11, color: colors.c, fontWeight: 600 }}>{co?.f ?? cat}</div>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(count / maxCount) * 100}%`, background: colors.c, borderRadius: 4, transition: "width .4s" }} />
                  </div>
                  <div style={{ width: 28, textAlign: "right", fontSize: 12, fontWeight: 700, color: C.white }}>{count}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Reports */}
        {data.reportCount > 0 && (
          <div style={{ padding: "12px 16px", borderRadius: 14, background: C.red + "12", border: `1px solid ${C.red}33`, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <Icon n="inf" s={18} c={C.red} />
            <div style={{ fontSize: 13, fontWeight: 600, color: C.red }}>{data.reportCount} open report{data.reportCount !== 1 ? "s" : ""} pending review</div>
          </div>
        )}

        {/* Top operators */}
        <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 14, padding: 16, border: `1px solid ${C.bd}`, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Top Operators</div>
          <div style={{ display: "grid", gap: 8 }}>
            {data.topOperators.map((op, i) => (
              <div key={op.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: i === 0 ? C.gold + "08" : "rgba(255,255,255,.02)", border: `1px solid ${i === 0 ? C.gold + "22" : "rgba(255,255,255,.04)"}` }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: i === 0 ? C.gold + "22" : "rgba(255,255,255,.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: i === 0 ? C.gold : C.m }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.white }}>{op.user.firstName} {op.user.lastName}</div>
                  <div style={{ fontSize: 10, color: C.m }}>{op.completed} completed · {op.cancelled} cancelled</div>
                </div>
                <RepBadge rep={undefined} size="small" />
              </div>
            ))}
          </div>
        </div>

        {/* QR Code Onboarding */}
        <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 14, padding: 16, border: `1px solid ${C.bd}`, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>QR Onboarding</div>
          <p style={{ fontSize: 12, color: C.m, marginBottom: 12, lineHeight: 1.6 }}>
            Select an unused invite code to generate a QR code. New operators scan it to register with the code pre-filled.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {inviteCodes.filter(c => c.isValid).map(c => (
              <button
                key={c.code}
                onClick={() => setQrCode(qrCode === c.code ? null : c.code)}
                style={{ padding: "8px 14px", borderRadius: 10, border: `1.5px solid ${qrCode === c.code ? C.gold : C.bd}`, background: qrCode === c.code ? C.gold + "15" : C.s, color: qrCode === c.code ? C.gold : C.m, fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: 1.5 }}
              >
                {c.code}
              </button>
            ))}
            {inviteCodes.filter(c => c.isValid).length === 0 && (
              <div style={{ fontSize: 12, color: C.m }}>No unused invite codes — generate more from your profile.</div>
            )}
          </div>
          {qrCode && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 20, background: C.white, borderRadius: 16 }}>
              <QRCodeSVG
                value={`${appUrl}/login?invite=${qrCode}`}
                size={200}
                bgColor="#ffffff"
                fgColor="#010028"
                level="M"
              />
              <div style={{ fontSize: 11, color: "#010028", fontWeight: 700, letterSpacing: 2 }}>{qrCode}</div>
              <div style={{ fontSize: 10, color: "#666", textAlign: "center" }}>Scan to register with this invite code pre-filled</div>
            </div>
          )}
        </div>

        {/* Recent agreements */}
        {data.recentAgreements.length > 0 && (
          <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 14, padding: 16, border: `1px solid ${C.bd}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Recent Agreements</div>
            <div style={{ display: "grid", gap: 8 }}>
              {data.recentAgreements.map(ag => {
                const co = SWAP_TYPES.find(x => x.id === ag.swap.category);
                const colors = CM[ag.swap.category as keyof typeof CM] ?? CM.work;
                return (
                  <div key={ag.id} style={{ padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.04)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <Icon n={co?.ic || "swap"} s={12} c={colors.c} />
                      <span style={{ fontSize: 10, color: colors.c, fontWeight: 600, textTransform: "uppercase" }}>{co?.f}</span>
                      <span style={{ marginLeft: "auto", fontSize: 9, color: ag.status === "completed" ? "#00C9A7" : ag.status === "cancelled" ? C.red : C.m, fontWeight: 700, textTransform: "uppercase" }}>{ag.status.replace("_", " ")}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,.7)" }}>
                      {ag.userA.firstName} {ag.userA.lastName} ↔ {ag.userB.firstName} {ag.userB.lastName}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
