"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  duration?: number;
  suffix?: string;
}

export default function CountUp({ value, duration = 800, suffix = "" }: Props) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  // The value this component has already animated to. Previously this was a
  // plain `hasStarted` latch, which was the bug: the swap board's category
  // tiles are above the fold, so the observer fired on mount while the counts
  // were still 0 (the fetch had not resolved), the latch closed, and the tiles
  // then read "0" forever no matter what the real counts turned out to be.
  // Tracking the animated value instead lets a later arrival re-run.
  const animatedTo = useRef<number | null>(null);
  // Where the current animation starts from, so a late update counts up from
  // what the viewer can already see rather than snapping back to zero. Written
  // only from effects and animation frames, never during render.
  const displayRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const run = () => {
      if (animatedTo.current === value) return;
      const from = displayRef.current;
      animatedTo.current = value;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);

      const reduce = typeof window !== "undefined"
        && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduce || duration <= 0) { displayRef.current = value; setDisplay(value); return; }

      const start = performance.now();
      const animate = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const next = Math.round(from + (value - from) * eased);
        displayRef.current = next;
        setDisplay(next);
        if (progress < 1) {
          frameRef.current = requestAnimationFrame(animate);
        }
      };
      frameRef.current = requestAnimationFrame(animate);
    };

    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) run(); },
      { threshold: 0.1 }
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  return (
    <span ref={containerRef}>
      {display}{suffix}
    </span>
  );
}
