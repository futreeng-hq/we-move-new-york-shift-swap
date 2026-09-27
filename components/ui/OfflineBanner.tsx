"use client";
import { useState, useEffect } from "react";
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const on = () => setOffline(true);
    const off = () => setOffline(false);
    window.addEventListener("offline", on);
    window.addEventListener("online", off);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator.onLine does not exist during SSR, so the initial value can only be read after mount
    setOffline(!navigator.onLine);
    return () => { window.removeEventListener("offline", on); window.removeEventListener("online", off); };
  }, []);
  if (!offline) return null;
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, background: "rgba(255,71,87,.95)", backdropFilter: "blur(8px)", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8, justifyContent: "center", fontSize: 13, fontWeight: 600, color: "#fff" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>
      No connection — some features may not work
    </div>
  );
}
