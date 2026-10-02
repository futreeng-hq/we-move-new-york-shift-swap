"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { C } from "@/constants/colors";
import Icon from "@/components/ui/Icon";

const s = {
  page: { minHeight: "100vh", background: C.bg, color: C.white } as React.CSSProperties,
  header: { position: "sticky" as const, top: 0, zIndex: 100, background: "rgba(1,0,40,.85)", backdropFilter: "blur(24px)", borderBottom: `1px solid ${C.bd}`, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 },
  content: { maxWidth: 640, margin: "0 auto", padding: "32px 20px 60px" },
  h1: { fontSize: 22, fontWeight: 800, color: C.white, marginBottom: 6 },
  updated: { fontSize: 12, color: C.m, marginBottom: 28 },
  section: { marginBottom: 24 },
  h2: { fontSize: 14, fontWeight: 700, color: C.gold, marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: 1 },
  p: { fontSize: 14, color: "rgba(255,255,255,.75)", lineHeight: 1.7, marginBottom: 10 },
  callout: { background: C.gs, border: `1px solid ${C.gg}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10 },
  calloutLabel: { fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase" as const, letterSpacing: 1.5, marginBottom: 6 },
  seeAlso: { fontSize: 13, color: "rgba(255,255,255,.6)", padding: "16px 18px", background: C.s, border: `1px solid ${C.bd}`, borderRadius: 10, marginTop: 28 },
  link: { color: C.gold, textDecoration: "underline" },
  footer: { fontSize: 12, color: "rgba(255,255,255,.3)", marginTop: 32 },
};

export default function DisclaimerPage() {
  const router = useRouter();
  return (
    <div style={s.page}>
      <div style={s.header}>
        <button onClick={() => router.back()} aria-label="Go back" style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.bd}`, background: C.s, color: C.gold, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon n="back" s={16} />
        </button>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.white }}>Disclaimer</div>
      </div>

      <main id="main-content" tabIndex={-1} style={s.content}>
        <h1 style={s.h1}>Disclaimer</h1>
        <p style={s.updated}>Last updated: October 1, 2026</p>

        <section style={s.section}>
          <h2 style={s.h2}>No Affiliation</h2>
          <p style={s.p}>
            WMNY Shift Swap is operated by We Move New York. It is not affiliated with, endorsed by, or operated by New York City Transit, the Metropolitan Transportation Authority (MTA), TWU Local 100, any transit agency, or any labor union.
          </p>
        </section>

        <section style={s.section}>
          <h2 style={s.h2}>Unofficial Tool</h2>
          <p style={s.p}>
            This platform is an unofficial, peer-to-peer tool intended solely to help transit workers coordinate shift swaps with each other. It does not replace or override any official agency procedures, work rules, collective bargaining agreements, or employer policies.
          </p>
        </section>

        <section style={s.section}>
          <h2 style={s.h2}>Supervisor Approval Required</h2>
          <div style={s.callout}>
            <div style={s.calloutLabel}>Important</div>
            <p style={{ ...s.p, marginBottom: 0 }}>
              Agreeing to a swap on WMNY does not mean the swap is approved. Every swap must still go through your depot&apos;s official channels and be approved by a supervisor.
            </p>
          </div>
          <p style={s.p}>
            All shift swaps must be formally approved in accordance with depot rules, regulations, union guidelines, and the direction of supervisors or management. Using this platform does not constitute official approval of any swap. You are responsible for following your employer&apos;s approval procedures; failing to do so may result in discipline from your employer, and WMNY has no role in that process.
          </p>
        </section>

        <section style={s.section}>
          <h2 style={s.h2}>Disclaimer of Liability</h2>
          <p style={s.p}>
            WMNY Shift Swap is provided as-is, without warranties of any kind. To the maximum extent permitted by law, we are not responsible for disputes, missed shifts, denied swaps, disciplinary actions, or any other consequences arising from use of this platform. Users are solely responsible for verifying and complying with all applicable rules. The full limitation of liability and disclaimer of warranties appear in our Terms of Use.
          </p>
        </section>

        <div style={s.seeAlso}>
          For the full user agreement and data practices, see our{" "}
          <Link href="/terms" style={s.link}>Terms of Use</Link> and{" "}
          <Link href="/privacy" style={s.link}>Privacy Policy</Link>.
        </div>

        <div style={s.footer}>
          &copy; {new Date().getFullYear()} We Move New York. All rights reserved.
        </div>
      </main>
    </div>
  );
}
