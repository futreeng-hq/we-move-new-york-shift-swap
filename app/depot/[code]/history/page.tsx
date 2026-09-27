"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import { Swap } from "@/types";
import { C, CM, STC, SWAP_TYPES } from "@/constants/colors";
import Icon from "@/components/ui/Icon";
import BottomNav from "@/components/ui/BottomNav";
import NotifIcon from "@/components/ui/NotifIcon";
import InboxIcon from "@/components/ui/InboxIcon";
import { parseSwapDate } from "@/lib/swapDate";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// History rows are augmented Swaps tagged with how the user is involved.
// "posted" = user is the swap.userId. "agreed" = user is userA on the
// most recent agreement. The history API also includes the swap.user
// (the poster's name) on agreed rows so we can show "with John D."
interface HistorySwapAgreement {
  id: string;
  status: string;
  createdAt: string;
  userA?: { id: string; firstName: string; lastName: string };
  userB?: { id: string; firstName: string; lastName: string };
}
interface HistorySwap extends Swap {
  myRole: "posted" | "agreed";
  agreements?: HistorySwapAgreement[];
  user?: { id: string; firstName: string; lastName: string };
}

type Tab = "all" | "posted" | "agreed";

function groupByMonth(swaps: HistorySwap[]): Map<string, HistorySwap[]> {
  const map = new Map<string, HistorySwap[]>();
  for (const s of swaps) {
    // For agreed swaps, group by when the user agreed (agreement.createdAt)
    // not when the swap was originally posted — that's the date the user
    // actually became involved.
    const ref = s.myRole === "agreed" && s.agreements?.[0]
      ? new Date(s.agreements[0].createdAt)
      : new Date(s.createdAt);
    const key = `${MONTHS[ref.getMonth()]} ${ref.getFullYear()}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return map;
}

export default function HistoryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = params.code;
  const [swaps, setSwaps] = useState<HistorySwap[]>([]);
  const [fetching, setFetching] = useState(true);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [tab, setTab] = useState<Tab>("all");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    if (!loading && user && !user.depotId) router.replace("/setup-profile");
    if (!loading && user?.depot && user.depot.code !== code && user.role !== "admin" && user.role !== "subAdmin") router.replace(`/depot/${user.depot.code}/swaps`);
  }, [user, loading, router, code]);

  useEffect(() => {
    if (!user) return;
    api.get<HistorySwap[]>("/users/me/history")
      .then(setSwaps)
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [user]);

  // Filter by tab
  const filtered = useMemo(() => {
    if (tab === "all") return swaps;
    return swaps.filter(s => s.myRole === tab);
  }, [swaps, tab]);

  const grouped = groupByMonth(filtered);

  // Counts shown on the tabs
  const counts = useMemo(() => {
    let posted = 0, agreed = 0;
    for (const s of swaps) {
      if (s.myRole === "posted") posted++;
      else if (s.myRole === "agreed") agreed++;
    }
    return { all: posted + agreed, posted, agreed };
  }, [swaps]);

  // Calendar — build a monthly view for the current month showing swap dates
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();
  const daysInMonth = new Date(thisYear, thisMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(thisYear, thisMonth, 1).getDay();

  const swapsByDay = new Map<number, HistorySwap[]>();
  for (const s of filtered) {
    const d = parseSwapDate(s.date);
    if (d && d.getMonth() === thisMonth && d.getFullYear() === thisYear) {
      const day = d.getDate();
      if (!swapsByDay.has(day)) swapsByDay.set(day, []);
      swapsByDay.get(day)!.push(s);
    }
  }

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(1,0,40,.85)", backdropFilter: "blur(24px)", borderBottom: `1px solid ${C.bd}`, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push(`/depot/${code}`)} aria-label="Go back" style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.bd}`, background: C.s, color: C.gold, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon n="back" s={16} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.white }}>My Swaps</div>
          <div style={{ fontSize: 10, color: C.gold, letterSpacing: 2, textTransform: "uppercase" }}>
            {counts.all} total · {counts.posted} posted · {counts.agreed} agreed
          </div>
        </div>
        <NotifIcon />
        <InboxIcon />
        {/* View toggle */}
        <div style={{ display: "flex", gap: 4, background: C.s, borderRadius: 10, padding: 3 }}>
          {(["list", "calendar"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{ width: 34, height: 28, borderRadius: 8, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: view === v ? C.gold : "transparent", color: view === v ? C.bg : C.m }}>
              <Icon n={v === "list" ? "list" : "cal"} s={14} />
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, padding: "12px 16px 0", maxWidth: 520, margin: "0 auto" }}>
        {([
          { id: "all" as const, label: "All", count: counts.all },
          { id: "posted" as const, label: "Posted", count: counts.posted },
          { id: "agreed" as const, label: "Agreed", count: counts.agreed },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              padding: "9px 12px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              background: tab === t.id ? C.gold : "rgba(255,255,255,.04)",
              color: tab === t.id ? C.bg : C.m,
              transition: "all .15s",
            }}
          >
            {t.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{t.count}</span>
          </button>
        ))}
      </div>

      <main id="main-content" tabIndex={-1} style={{ maxWidth: 520, margin: "0 auto", padding: "16px 16px 0" }}>
        {fetching ? (
          <div style={{ textAlign: "center", paddingTop: 60, color: C.m }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", paddingTop: 60 }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#60A5FA12", border: "1px solid #60A5FA33", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon n="clk" s={28} c="#60A5FA" />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.white, marginBottom: 8 }}>
              {tab === "agreed" ? "No agreed swaps yet" : tab === "posted" ? "No posted swaps yet" : "No swap history yet"}
            </div>
            <div style={{ fontSize: 13, color: C.m }}>
              {tab === "agreed"
                ? "Swaps you accept will appear here."
                : tab === "posted"
                  ? "Swaps you post will appear here."
                  : "Swaps you post or agree to will appear here."}
            </div>
          </div>
        ) : view === "list" ? (
          <div>
            {Array.from(grouped.entries()).map(([month, monthSwaps]) => (
              <div key={month} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 2, marginBottom: 10 }}>{month}</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {monthSwaps.map(s => {
                    const cat = CM[s.category] ?? CM.work;
                    const co = SWAP_TYPES.find(x => x.id === s.category);
                    const st2 = STC[s.status] ?? STC.open;
                    // For agreed swaps, show the poster's name. For posted swaps,
                    // show the agreer's name if there's a confirmed agreement.
                    const partner = s.myRole === "agreed"
                      ? s.user
                      : s.agreements?.[0]?.userA;
                    return (
                      <div
                        key={s.id}
                        onClick={() => router.push(`/depot/${code}/swaps/${s.id}`)}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, background: "rgba(255,255,255,.04)", border: `1px solid rgba(255,255,255,.06)`, cursor: "pointer" }}
                      >
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: cat.c + "18", border: `1px solid ${cat.c}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Icon n={co?.ic || "swap"} s={16} c={cat.c} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.details.substring(0, 55)}…</div>
                          <div style={{ fontSize: 10, color: C.m, marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span>{co?.f}</span>
                            <span>·</span>
                            <span>{new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                            {partner && (
                              <>
                                <span>·</span>
                                <span style={{ color: s.myRole === "agreed" ? "#60A5FA" : "#00C9A7" }}>
                                  {s.myRole === "agreed" ? "from" : "with"} {partner.firstName} {partner.lastName?.[0] ?? ""}.
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                          {s.myRole === "agreed" && (
                            <span style={{ padding: "2px 7px", borderRadius: 6, background: "#60A5FA22", border: "1px solid #60A5FA44", fontSize: 9, fontWeight: 700, color: "#60A5FA", textTransform: "uppercase", letterSpacing: 1 }}>Agreed</span>
                          )}
                          <span style={{ padding: "3px 9px", borderRadius: 8, background: st2.bg, border: `1px solid ${st2.bd}`, fontSize: 9, fontWeight: 700, color: st2.c, textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap" }}>{s.status}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Calendar view */
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.white, textAlign: "center", marginBottom: 16 }}>
              {MONTHS[thisMonth]} {thisYear}
            </div>
            {/* Day headers */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 6 }}>
              {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
                <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: C.m, padding: "4px 0" }}>{d}</div>
              ))}
            </div>
            {/* Calendar cells */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const daySwaps = swapsByDay.get(day) ?? [];
                const isToday = day === now.getDate();
                return (
                  <div key={day} style={{ aspectRatio: "1", borderRadius: 8, background: daySwaps.length > 0 ? C.gold + "15" : "rgba(255,255,255,.03)", border: `1px solid ${isToday ? C.gold + "44" : daySwaps.length > 0 ? C.gold + "22" : "rgba(255,255,255,.06)"}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative" }}>
                    <span style={{ fontSize: 12, fontWeight: isToday ? 800 : 400, color: isToday ? C.gold : C.white }}>{day}</span>
                    {daySwaps.length > 0 && (
                      <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
                        {daySwaps.slice(0, 3).map(s => (
                          <div key={s.id} style={{ width: 4, height: 4, borderRadius: "50%", background: CM[s.category]?.c ?? C.blue }} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
              {Object.entries(CM).map(([cat, colors]) => {
                const co = SWAP_TYPES.find(x => x.id === cat);
                return (
                  <div key={cat} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: colors.c }} />
                    <span style={{ fontSize: 10, color: C.m }}>{co?.f ?? cat}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <BottomNav depotCode={code} active="my" />
    </div>
  );
}
