"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import { Depot, Swap, Announcement, FlexibleOperator } from "@/types";
import { C, CM, SWAP_TYPES } from "@/constants/colors";
import SwapCard from "@/components/ui/SwapCard";
import DepotBadge from "@/components/ui/DepotBadge";
import ConfirmModal from "@/components/ui/ConfirmModal";
import BottomNav from "@/components/ui/BottomNav";
import Toast from "@/components/ui/Toast";
import Icon from "@/components/ui/Icon";
import Footer from "@/components/ui/Footer";
import AnnouncementBanner from "@/components/ui/AnnouncementBanner";
import FlexibleStrip from "@/components/ui/FlexibleStrip";
import PostAnnouncementModal from "@/components/ui/PostAnnouncementModal";
import NotifIcon from "@/components/ui/NotifIcon";
import InboxIcon from "@/components/ui/InboxIcon";
import FirstSwapBanner from "@/components/ui/FirstSwapBanner";
import CountUp from "@/components/ui/CountUp";
import OfflineBanner from "@/components/ui/OfflineBanner";
import FeedbackButton from "@/components/ui/FeedbackButton";
import { playClick } from "@/lib/sound";
import { markChecklistItem } from "@/components/ui/OnboardingChecklist";
import { parseSwapDate } from "@/lib/swapDate";

export default function BrowsePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = params.code;
  const searchParams = useSearchParams();

  // Allow callers to deep-link to a specific status filter via ?status=...
  // Used by the depot home stat pills (active swaps → ?status=open default,
  // completed this month → ?status=filled). Only honour known status values.
  const initialStatus = (() => {
    const s = searchParams.get("status");
    return s && ["open", "pending", "filled", "expired", "all"].includes(s) ? s : "open";
  })();

  const [depot, setDepot] = useState<Depot | null>(null);
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [catCounts, setCatCounts] = useState<Record<string, number>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [swapsLoaded, setSwapsLoaded] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [flexibleOps, setFlexibleOps] = useState<FlexibleOperator[]>([]);
  const [toast, setToast] = useState<{ message: string; type?: "success" | "error" | "info" } | null>(null);
  const [dmTarget, setDmTarget] = useState<FlexibleOperator | null>(null);
  const [dmText, setDmText] = useState("");
  const [dmBusy, setDmBusy] = useState(false);
  const [postAnnModal, setPostAnnModal] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: () => void } | null>(null);
  const [lastVisit] = useState(() => Date.now());
  const scrollKey = `swaps-scroll-${code}`;
  const mainRef = useRef<HTMLDivElement>(null);
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef<number>(0);

  // Restore scroll position when returning from a swap detail
  useEffect(() => {
    const saved = sessionStorage.getItem(scrollKey);
    if (saved) {
      const y = parseInt(saved, 10);
      setTimeout(() => window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior }), 80);
      sessionStorage.removeItem(scrollKey);
    }
  }, [scrollKey]);
  const isRep = user?.role === "depotRep" || user?.role === "admin";

  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [sf, setSf] = useState(initialStatus);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [quickF, setQuickF] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [runFilter, setRunFilter] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string, type?: "success" | "error" | "info") => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    if (!loading && user && !user.depotId) router.replace("/setup-profile");
    if (!loading && user?.depot && user.depot.code !== code && user.role !== "admin" && user.role !== "subAdmin") router.replace(`/depot/${user.depot.code}/swaps`);
    if (!loading && user) markChecklistItem(user.id, "browsed");
  }, [user, loading, router, code]);

  useEffect(() => {
    if (!code || !user) return;
    api.get<Depot>(`/depots/${code}`).then(setDepot).catch(() => router.replace("/depots"));
    api.get<Announcement[]>(`/depots/${code}/announcements`).then(setAnnouncements).catch(() => {});
    api.get<FlexibleOperator[]>(`/depots/${code}/flexible`).then(setFlexibleOps).catch(() => {});
    fetchSwaps();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, user]);

  const fetchSwaps = async () => {
    if (!user) return;
    const params = new URLSearchParams();
    if (cat !== "all") params.set("category", cat);
    if (sf !== "all") params.set("status", sf);
    if (q) params.set("search", q);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    params.set("sort", sortBy);
    try {
      const data = await api.get<{ swaps: Swap[]; nextCursor: string | null }>(`/swaps?${params}`);
      setSwaps(data.swaps);
      setNextCursor(data.nextCursor);
      if (cat === "all") {
        const counts: Record<string, number> = {};
        data.swaps.forEach(s => { counts[s.category] = (counts[s.category] ?? 0) + 1; });
        setCatCounts(counts);
      }
    } catch (e) { console.error(e); showToast("Failed to load swaps — pull to refresh", "error"); }
    finally { setSwapsLoaded(true); }
  };

  const loadMore = async () => {
    if (!user || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    const params = new URLSearchParams();
    if (cat !== "all") params.set("category", cat);
    if (sf !== "all") params.set("status", sf);
    if (q) params.set("search", q);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    params.set("sort", sortBy);
    params.set("cursor", nextCursor);
    try {
      const data = await api.get<{ swaps: Swap[]; nextCursor: string | null }>(`/swaps?${params}`);
      setSwaps(prev => [...prev, ...data.swaps]);
      setNextCursor(data.nextCursor);
    } catch (e) { console.error(e); showToast("Failed to load more swaps", "error"); }
    setLoadingMore(false);
  };

  useEffect(() => { if (user) fetchSwaps(); }, [cat, sf, q, dateFrom, dateTo, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let r = [...swaps];
    if (quickF === "am") r = r.filter(s => s.startTime && parseInt(s.startTime) < 12);
    if (quickF === "pm") r = r.filter(s => s.startTime && parseInt(s.startTime) >= 12);
    if (quickF === "weekend") r = r.filter(s => s.fromDay === "Saturday" || s.fromDay === "Sunday" || s.toDay === "Saturday" || s.toDay === "Sunday" || (s.date && [0,6].includes(parseSwapDate(s.date)?.getDay() ?? -1)));
    if (quickF === "thisweek") {
      const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
      const we = weekEnd.toISOString().split("T")[0];
      r = r.filter(s => s.date && s.date <= we);
    }
    if (runFilter) {
      const rf = runFilter.toLowerCase();
      r = r.filter(s =>
        (s.run && s.run.toLowerCase().includes(rf)) ||
        (s.route && s.route.toLowerCase().includes(rf))
      );
    }
    return r;
  }, [swaps, quickF, runFilter]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && nextCursor && !loadingMore) loadMore();
    }, { rootMargin: "200px" });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [nextCursor, loadingMore]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = (id: string) => {
    setConfirm({ title: "Delete Swap", text: "Are you sure? This cannot be undone.", action: async () => {
      try {
        await api.del(`/swaps/${id}`);
        setSwaps(p => p.filter(s => s.id !== id));
        showToast("Deleted");
      } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Delete failed", "error"); }
      setConfirm(null);
    }});
  };

  const handleStatus = async (id: string, status: string) => {
    try {
      await api.put(`/swaps/${id}/status`, { status });
      setSwaps(p => p.map(s => s.id === id ? { ...s, status: status as Swap["status"] } : s));
      showToast("Status updated");
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
  };

  const handleReport = (s: Swap) => {
    setConfirm({ title: "Report Swap", text: "Report this swap as inappropriate or spam?", action: async () => {
      try {
        await api.post(`/swaps/${s.id}/report`, {});
        showToast("Reported. Thank you.");
      } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Report failed", "error"); }
      setConfirm(null);
    }});
  };

  const handleToggleSave = async (swap: Swap, save: boolean) => {
    try {
      if (save) {
        await api.post(`/swaps/${swap.id}/save`, {});
      } else {
        await api.del(`/swaps/${swap.id}/save`);
      }
      setSwaps(p => p.map(s => s.id === swap.id ? { ...s, saved: save } : s));
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
  };

  const handleFlexToggle = async () => {
    try {
      const { flexibleMode } = await api.post<{ flexibleMode: boolean }>("/users/me/flexible", {});
      if (flexibleMode) {
        // add self to list optimistically — re-fetch to get real data
        api.get<FlexibleOperator[]>(`/depots/${code}/flexible`).then(setFlexibleOps).catch(() => {});
        showToast("You're now in \"I'll Take Anything\" mode!");
      } else {
        setFlexibleOps(prev => prev.filter(op => op.id !== user?.id));
        showToast("Flexible mode off");
      }
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Toggle failed", "error"); }
  };

  const handleDmSend = async () => {
    if (!dmTarget || !dmText.trim()) return;
    setDmBusy(true);
    try {
      await api.post(`/users/${dmTarget.id}/message`, { text: dmText.trim() });
      showToast(`Message sent to ${dmTarget.firstName}!`);
      setDmTarget(null);
      setDmText("");
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Send failed", "error"); }
    setDmBusy(false);
  };

  const handleDeleteAnn = async (id: string) => {
    try {
      await api.del(`/depots/${code}/announcements/${id}`);
      setAnnouncements(prev => prev.filter(a => a.id !== id));
      showToast("Announcement removed");
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (window.scrollY > 0) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 70) {
      setPulling(true);
    } else {
      setPulling(false);
    }
  };

  const handleTouchEnd = async () => {
    if (pulling) {
      setPulling(false);
      setRefreshing(true);
      await fetchSwaps();
      setRefreshing(false);
    }
  };

  if (!depot) return null;

  return (
    <div className="page-enter" style={{ minHeight: "100vh", background: C.bg }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <OfflineBanner />
      <div style={{ textAlign: "center", fontSize: 12, color: C.m, padding: "8px 0", opacity: pulling || refreshing ? 1 : 0, transition: "opacity 0.2s", pointerEvents: "none" }}>
        {refreshing ? (
          <span style={{ display: "inline-block", width: 14, height: 14, border: `2px solid ${C.m}`, borderTopColor: "transparent", borderRadius: "50%", animation: "rotateLogo 0.6s linear infinite", verticalAlign: "middle" }} />
        ) : "↓ Pull to refresh"}
      </div>
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(1,0,40,.75)", borderBottom: `1px solid ${C.bd}`, padding: "12px 12px", display: "flex", alignItems: "center", gap: 6 }}>
        <button onClick={() => router.push(`/depot/${code}`)} aria-label="Go back" style={{ width: 32, height: 32, borderRadius: 10, border: `1px solid ${C.bd}`, background: C.s, color: C.gold, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon n="back" s={15} /></button>
        <DepotBadge depot={depot} size={32} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: C.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{depot.name}</div>
        <NotifIcon />
        <InboxIcon />
        <button onClick={() => router.push(`/depot/${code}/saved`)} aria-label="Saved swaps" title="Saved Swaps" style={{ width: 32, height: 32, borderRadius: 10, border: `1px solid ${C.bd}`, background: C.s, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.m, flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
        </button>
        {isRep && (
          <>
            <button onClick={() => setPostAnnModal(true)} title="Post Announcement" style={{ width: 32, height: 32, borderRadius: 10, border: `1px solid ${C.gold}44`, background: C.gs, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.gold, flexShrink: 0 }}>
              <Icon n="bell" s={14} c={C.gold} />
            </button>
            <button onClick={() => router.push(`/depot/${code}/rep`)} title="Rep Dashboard" style={{ width: 32, height: 32, borderRadius: 10, border: "1px solid #C084FC33", background: "#C084FC12", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon n="shield" s={14} c="#C084FC" />
            </button>
          </>
        )}
        <button onClick={() => { playClick(); router.push(`/depot/${code}/post`); }} style={{ padding: "7px 12px", borderRadius: 10, border: "none", cursor: "pointer", background: "#D1AD38", fontSize: 12, fontWeight: 700, color: "#010028", flexShrink: 0 }}>+ Post</button>
      </div>

      <main id="main-content" tabIndex={-1} style={{ maxWidth: 720, margin: "0 auto", padding: "0 20px" }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, background: `linear-gradient(135deg,${C.white},${C.gold}88)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", padding: "18px 0 8px" }}>Available Swaps</h2>

        <FirstSwapBanner depotCode={code} />

        {/* Announcements */}
        <AnnouncementBanner
          announcements={announcements}
          isRep={!!isRep}
          onDelete={handleDeleteAnn}
        />

        {/* I'll Take Anything strip */}
        <FlexibleStrip
          operators={flexibleOps}
          onMessage={setDmTarget}
          currentUserId={user?.id ?? ""}
          isFlexible={user?.flexibleMode ?? false}
          onToggle={handleFlexToggle}
        />

        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search swaps..." style={{ height: 40, fontSize: 13, width: "100%", marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select value={sf} onChange={e => setSf(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 14, fontSize: 11, fontWeight: 600, appearance: "auto", cursor: "pointer", background: C.s, border: `1px solid ${C.bd}`, color: C.white }}>
            <option value="all">All</option><option value="open">Open</option><option value="pending">Pending</option><option value="filled">Filled</option><option value="expired">Expired</option>
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 14, fontSize: 11, fontWeight: 600, appearance: "auto", cursor: "pointer", background: C.s, border: `1px solid ${C.bd}`, color: C.white }}>
            <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="date">By Date</option>
          </select>
          <button onClick={() => setShowFilters(!showFilters)} style={{ padding: "8px 14px", borderRadius: 14, border: `1px solid ${showFilters ? C.gold + "44" : C.bd}`, background: showFilters ? C.gs : C.s, cursor: "pointer", color: showFilters ? C.gold : C.m, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
            <Icon n="tmr" s={12} /> Filters
          </button>
        </div>

        {showFilters && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: C.m, flexShrink: 0 }}>Date:</span>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ height: 36, fontSize: 12, flex: 1, padding: "8px 12px" }} />
              <span style={{ fontSize: 11, color: C.m }}>to</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ height: 36, fontSize: 12, flex: 1, padding: "8px 12px" }} />
              {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(""); setDateTo(""); }} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.bd}`, background: C.s, color: C.m, cursor: "pointer", fontSize: 10, flexShrink: 0 }}>Clear</button>}
            </div>
            <div style={{ marginBottom: 8 }}>
              <input
                value={runFilter}
                onChange={e => setRunFilter(e.target.value)}
                placeholder="Filter by run # or route…"
                style={{ height: 36, fontSize: 12, padding: "8px 12px", width: "100%" }}
              />
            </div>
          </>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 10 }}>
          {SWAP_TYPES.map(x => {
            const m = CM[x.id as keyof typeof CM];
            const ct = catCounts[x.id] ?? 0;
            return (
              <button key={x.id} onClick={() => setCat(cat === x.id ? "all" : x.id)} style={{ padding: "12px 10px", borderRadius: 12, border: "none", cursor: "pointer", textAlign: "left", background: cat === x.id ? m.bg : "rgba(255,255,255,.025)", backdropFilter: "blur(8px)", boxShadow: cat === x.id ? `inset 0 0 0 1.5px ${m.bd2}, 0 0 12px ${m.c}10` : `inset 0 0 0 1px rgba(255,255,255,.05)` }}>
                <Icon n={x.ic} s={18} c={cat === x.id ? m.c : C.m} />
                <div style={{ fontSize: 11, fontWeight: 700, color: cat === x.id ? m.c : C.white, marginTop: 4 }}>{x.l}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: cat === x.id ? m.c : C.m }}><CountUp value={ct} /></div>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", paddingBottom: 4 }}>
          {[{ k: "", l: "All" }, { k: "am", l: "AM Shifts" }, { k: "pm", l: "PM Shifts" }, { k: "weekend", l: "Weekend" }, { k: "thisweek", l: "This Week" }].map(f => (
            <button key={f.k} onClick={() => setQuickF(quickF === f.k ? "" : f.k)} style={{ padding: "6px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, background: quickF === f.k ? C.gold : C.s, color: quickF === f.k ? C.bg : C.m }}>{f.l}</button>
          ))}
        </div>

        <div style={{ display: "grid", gap: 8, paddingBottom: 80 }}>
          {!swapsLoaded && swaps.length === 0 && (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ background: "rgba(255,255,255,.03)", borderRadius: 18, padding: 20, border: "1px solid rgba(255,255,255,.06)", opacity: 1 - i * 0.12, animation: `fadeIn .4s ease ${i * 0.07}s both` }}>
                {/* Header row */}
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <div className="skeleton" style={{ height: 16, width: "30%", borderRadius: 6 }} />
                  <div className="skeleton" style={{ height: 20, width: 60, borderRadius: 20 }} />
                </div>
                {/* Name row */}
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <div className="skeleton" style={{ height: 18, width: "45%", borderRadius: 6 }} />
                  <div className="skeleton" style={{ height: 16, width: 40, borderRadius: 8 }} />
                </div>
                {/* Details */}
                <div className="skeleton" style={{ height: 13, width: "80%", borderRadius: 5, marginBottom: 6 }} />
                <div className="skeleton" style={{ height: 13, width: "60%", borderRadius: 5, marginBottom: 14 }} />
                {/* Shift block */}
                <div style={{ display: "flex", gap: 8 }}>
                  <div className="skeleton" style={{ height: 44, flex: 1, borderRadius: 10 }} />
                  <div className="skeleton" style={{ height: 44, width: 24, borderRadius: 6, alignSelf: "center" }} />
                  <div className="skeleton" style={{ height: 44, flex: 1, borderRadius: 10 }} />
                </div>
              </div>
            ))
          )}
          {swapsLoaded && swaps.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: C.m }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.white, marginBottom: 8 }}>No swaps posted yet — be the first!</div>
              <button onClick={() => router.push(`/depot/${code}/post`)} style={{ marginTop: 8, padding: "10px 22px", borderRadius: 12, border: "none", cursor: "pointer", background: `linear-gradient(135deg,${C.gold},${C.gold}dd)`, fontSize: 13, fontWeight: 700, color: C.bg }}>
                + Post a Swap
              </button>
            </div>
          )}
          {swaps.length > 0 && filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: C.m }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.white, marginBottom: 8 }}>No swaps match your filters</div>
              <div style={{ fontSize: 13, color: C.m, marginBottom: 16 }}>Try adjusting your search or filter criteria.</div>
              <button
                onClick={() => { setCat("all"); setQ(""); setSf("open"); setDateFrom(""); setDateTo(""); setSortBy("newest"); setQuickF(""); setRunFilter(""); }}
                style={{ padding: "10px 20px", borderRadius: 12, border: `1px solid ${C.bd}`, background: C.s, color: C.gold, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
              >
                Clear filters
              </button>
            </div>
          ) : filtered.map((s, idx) => (
            <div key={s.id} style={{ animation: `fadeUp .5s cubic-bezier(.4,0,.2,1) ${idx * 0.06}s both` }}>
              <SwapCard
                swap={s}
                user={user}
                onDelete={handleDelete}
                onStatusChange={handleStatus}
                onEdit={s.userId === user?.id ? (sw) => router.push(`/depot/${code}/post?edit=${sw.id}`) : undefined}
                onReport={handleReport}
                onToggleSave={s.userId !== user?.id ? handleToggleSave : undefined}
                lastVisit={lastVisit}
                onClick={() => { sessionStorage.setItem(scrollKey, String(window.scrollY)); router.push(`/depot/${code}/swaps/${s.id}`); }}
              />
            </div>
          ))}
          {loadingMore && (
            <div style={{ textAlign: "center", padding: 20, color: C.m, fontSize: 13 }}>
              <div style={{ display: "inline-block", width: 20, height: 20, borderRadius: "50%", border: `2px solid ${C.bd}`, borderTopColor: C.gold, animation: "rotateLogo .8s linear infinite" }} />
            </div>
          )}
          {nextCursor && !loadingMore && (
            <div ref={sentinelRef} style={{ height: 1 }} />
          )}
        </div>
        <Footer />
      </main>

      <BottomNav active="browse" depotCode={code} lang={user?.language} />
      {confirm && <ConfirmModal title={confirm.title} text={confirm.text} onConfirm={confirm.action} onCancel={() => setConfirm(null)} />}
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Post Announcement modal (reps only) */}
      {postAnnModal && (
        <PostAnnouncementModal
          depotCode={code}
          onPosted={ann => { setAnnouncements(prev => [ann, ...prev]); setPostAnnModal(false); showToast("Announcement posted!"); }}
          onClose={() => setPostAnnModal(false)}
        />
      )}

      <FeedbackButton />

      {/* DM modal for flexible operator */}
      {dmTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", display: "flex", alignItems: "flex-end", zIndex: 300 }} onClick={() => { setDmTarget(null); setDmText(""); }}>
          <div style={{ width: "100%", background: "rgb(6,5,52)", borderRadius: "20px 20px 0 0", padding: "24px 20px 44px", maxWidth: 520, margin: "0 auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.white, marginBottom: 2 }}>Message {dmTarget.firstName} {dmTarget.lastName}</div>
            <div style={{ fontSize: 11, color: C.m, marginBottom: 16 }}>They&apos;re open to any swap — introduce yourself and share what you have.</div>
            <textarea
              value={dmText}
              onChange={e => setDmText(e.target.value)}
              placeholder={`Hi ${dmTarget.firstName}, I'm interested in swapping. I have…`}
              maxLength={500}
              rows={4}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.04)", color: C.white, fontSize: 14, resize: "none", fontFamily: "inherit", boxSizing: "border-box", marginBottom: 14 }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
              <button onClick={() => { setDmTarget(null); setDmText(""); }} style={{ padding: 14, borderRadius: 14, border: `1px solid ${C.bd}`, background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.m }}>Cancel</button>
              <button onClick={handleDmSend} disabled={dmBusy || !dmText.trim()} style={{ padding: 14, borderRadius: 14, border: "none", background: "linear-gradient(135deg,#22C55E,#22C55Ecc)", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#fff", opacity: dmBusy || !dmText.trim() ? 0.6 : 1 }}>
                {dmBusy ? "Sending..." : "Send Message"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
