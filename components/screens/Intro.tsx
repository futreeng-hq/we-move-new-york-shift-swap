"use client";

import { useState, useEffect } from "react";
import { C } from "@/constants/colors";

// Static star positions so they don't re-randomize on re-render
const STARS = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  x: ((i * 73 + 17) % 100),
  y: ((i * 47 + 31) % 100),
  size: ((i * 13) % 3) + 1,
  delay: ((i * 37) % 30) / 10,
  dur: 2 + ((i * 19) % 30) / 10,
}));

export default function Intro({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState(0);
  const [pc, setPc] = useState(0);
  const [exiting, setExiting] = useState(false);
  // (was: useCallback(onDone, [onDone]) — an identity wrapper that stabilised
  // nothing, since its dep is the value itself. onDone is used directly now.)

  useEffect(() => {
    const t = [
      setTimeout(() => setP(1), 250),
      setTimeout(() => setP(2), 1000),
      setTimeout(() => setP(3), 3000),
      setTimeout(() => { setExiting(true); }, 3400),
      setTimeout(onDone, 4100),
    ];
    return () => t.forEach(clearTimeout);
  }, [onDone]);

  useEffect(() => {
    if (p >= 2) {
      const i = setInterval(() => setPc(v => Math.min(v + 2, 100)), 28);
      return () => clearInterval(i);
    }
  }, [p]);

  const skip = () => { setExiting(true); setTimeout(onDone, 500); };

  return (
    <div
      onClick={skip}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(ellipse at 40% 30%, #000070 0%, #010028 55%, #000010 100%)`,
        opacity: exiting ? 0 : 1,
        transition: "opacity .65s ease",
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes starTwinkle { 0%,100%{opacity:.15;transform:scale(1)} 50%{opacity:.9;transform:scale(1.4)} }
        @keyframes introBounce { 0%{opacity:0;transform:scale(0.3) rotate(-15deg)} 60%{transform:scale(1.12) rotate(3deg)} 80%{transform:scale(0.96) rotate(-1deg)} 100%{opacity:1;transform:scale(1) rotate(0deg)} }
        @keyframes introGlow { 0%,100%{box-shadow:0 0 40px ${C.gold}20,0 0 80px ${C.gold}08} 50%{box-shadow:0 0 80px ${C.gold}50,0 0 160px ${C.gold}20} }
        @keyframes introTagline { from{opacity:0;letter-spacing:20px;transform:translateY(8px)} to{opacity:1;letter-spacing:5px;transform:translateY(0)} }
        @keyframes introSubtitle { from{opacity:0;transform:translateY(16px)} to{opacity:.6;transform:translateY(0)} }
        @keyframes introPulseRing { 0%{transform:scale(1);opacity:.4} 100%{transform:scale(1.8);opacity:0} }
        @keyframes busSlide { from{transform:translateX(-80px);opacity:0} to{transform:translateX(0);opacity:1} }
      `}</style>

      {/* Star field */}
      {STARS.map(s => (
        <div
          key={s.id}
          style={{
            position: "absolute",
            left: s.x + "%",
            top: s.y + "%",
            width: s.size,
            height: s.size,
            borderRadius: "50%",
            background: "#fff",
            animation: `starTwinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}

      {/* Pulse ring behind logo */}
      {p >= 1 && (
        <>
          <div style={{ position: "absolute", width: 180, height: 180, borderRadius: "50%", border: `1px solid ${C.gold}`, animation: "introPulseRing 2.5s ease-out .3s infinite" }} />
          <div style={{ position: "absolute", width: 180, height: 180, borderRadius: "50%", border: `1px solid ${C.gold}`, animation: "introPulseRing 2.5s ease-out 1.5s infinite" }} />
        </>
      )}

      {/* Logo */}
      <div style={{
        opacity: p >= 1 ? 1 : 0,
        animation: p >= 1 ? "introBounce .9s cubic-bezier(.34,1.56,.64,1) both, introGlow 3s ease-in-out 1s infinite" : "none",
        marginBottom: 32,
        position: "relative",
      }}>
        <div style={{
          width: 130,
          height: 130,
          borderRadius: "50%",
          background: `conic-gradient(from 45deg,${C.navy},${C.blue},${C.navy},${C.blue},${C.navy})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `3px solid ${C.gold}`,
        }}>
          <div style={{ fontWeight: 900, fontSize: 15, color: C.gold, textAlign: "center", lineHeight: 1.2, letterSpacing: 2 }}>
            WE<br />MOVE<br />NY
          </div>
        </div>
      </div>

      {/* Title */}
      <div style={{
        textAlign: "center",
        opacity: p >= 1 ? 1 : 0,
        transition: "opacity .4s ease .3s",
      }}>
        <h1 style={{
          fontSize: "clamp(32px,6vw,52px)",
          fontWeight: 900,
          background: `linear-gradient(135deg,${C.gold},${C.gold}cc)`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          animation: p >= 1 ? "introTagline .9s cubic-bezier(.34,1.1,.64,1) .4s both" : "none",
          margin: 0,
          letterSpacing: 5,
        }}>
          SHIFT SWAP
        </h1>

        <div style={{
          fontSize: 12,
          color: C.m,
          letterSpacing: 4,
          marginTop: 10,
          textTransform: "uppercase",
          animation: p >= 1 ? "introSubtitle .8s ease .8s both" : "none",
        }}>
          It&apos;s more than a uniform, it&apos;s a lifestyle
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        position: "absolute",
        bottom: 60,
        width: 200,
        opacity: p >= 2 ? 1 : 0,
        transition: "opacity .4s ease",
      }}>
        <div style={{ height: 2, borderRadius: 2, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: pc + "%",
            background: `linear-gradient(90deg,${C.gold},${C.blue},${C.gold})`,
            backgroundSize: "200% 100%",
            transition: "width .05s linear",
            animation: "shimmer 1.5s linear infinite",
          }} />
        </div>
        <div style={{ textAlign: "center", marginTop: 10, fontSize: 10, color: "rgba(255,255,255,.25)", letterSpacing: 2 }}>
          TAP TO SKIP
        </div>
      </div>
    </div>
  );
}
