"use client";

import { useRouter } from "next/navigation";
import { C } from "@/constants/colors";
import Icon from "@/components/ui/Icon";

const s = {
  page: { minHeight: "100vh", color: C.white } as React.CSSProperties,
  header: { position: "sticky" as const, top: 0, zIndex: 100, background: "rgba(1,0,40,.85)", backdropFilter: "blur(24px)", borderBottom: `1px solid ${C.bd}`, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 },
  content: { maxWidth: 680, margin: "0 auto", padding: "32px 24px 80px" },
  h1: { fontSize: 26, fontWeight: 800, color: C.white, marginBottom: 6 },
  updated: { fontSize: 12, color: C.m, marginBottom: 36 },
  section: { marginBottom: 32 },
  h2: { fontSize: 15, fontWeight: 700, color: C.gold, textTransform: "uppercase" as const, letterSpacing: 2, marginBottom: 12 },
  p: { fontSize: 14, color: "rgba(255,255,255,.75)", lineHeight: 1.8, marginBottom: 12 },
  li: { fontSize: 14, color: "rgba(255,255,255,.75)", lineHeight: 1.8, marginBottom: 6, paddingLeft: 16 },
  divider: { borderColor: C.bd, margin: "28px 0" },
  callout: { background: C.gs, border: `1px solid ${C.gg}`, borderRadius: 10, padding: "14px 16px", marginBottom: 12 },
  calloutLabel: { fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase" as const, letterSpacing: 1.5, marginBottom: 6 },
};

export default function TermsPage() {
  const router = useRouter();
  return (
    <div style={s.page}>
      <div style={s.header}>
        <button onClick={() => router.back()} aria-label="Go back" style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.bd}`, background: C.s, color: C.gold, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon n="back" s={16} />
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.white }}>Terms of Use</div>
      </div>

      <main id="main-content" tabIndex={-1} style={s.content}>
        <h1 style={s.h1}>Terms of Use</h1>
        <p style={s.updated}>Last updated: October 1, 2026</p>

        <div style={s.section}>
          <h2 style={s.h2}>1. Acceptance of Terms</h2>
          <p style={s.p}>By accessing or using We Move New York (&ldquo;the App,&rdquo; &ldquo;WMNY&rdquo;), you agree to be bound by these Terms of Use. If you do not agree to these terms, do not use the App. These terms apply to all users of the platform.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>2. Who Can Use This App</h2>
          <p style={s.p}>We Move New York is intended exclusively for active New York City transit workers. The App launches with bus operator support and will extend to additional transit titles over time; the roles currently permitted to register are listed in the App at the time of signup. Access may require a valid invite code issued by an existing member or a depot-code gate during limited launches. By registering, you confirm that:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>You are a current transit worker in a role supported by the App.</li>
            <li style={s.li}>The information you provide is accurate and truthful.</li>
            <li style={s.li}>You will not share your account credentials with others.</li>
            <li style={s.li}>You are at least 18 years of age.</li>
          </ul>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>3. Shift Swap Coordination — Supervisor Approval Required</h2>
          <div style={s.callout}>
            <div style={s.calloutLabel}>Important</div>
            <p style={{ ...s.p, marginBottom: 0 }}>Agreeing to a swap on WMNY does not mean the swap is approved. Every swap must still be submitted through your depot&apos;s official channels and approved by a supervisor. WMNY is a coordination tool, not a substitute for your employer&apos;s process.</p>
          </div>
          <p style={s.p}>We Move New York does not replace, supersede, or conflict with any MTA, TWU, or union collective bargaining agreements or any employer policy. All shift swaps must be conducted in accordance with your depot&apos;s official procedures. WMNY makes no guarantee that a swap listed on the platform will be approved by management, and WMNY is not responsible for missed shifts, denied swaps, discipline, or any employment consequence arising from a mutual agreement reached through the App.</p>
          <p style={s.p}>You are solely responsible for ensuring your swap complies with all applicable work rules, collective bargaining agreements, and employer policies.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>4. User Conduct</h2>
          <p style={s.p}>You agree not to use the App to:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>Post false, misleading, or fraudulent swap listings.</li>
            <li style={s.li}>Harass, threaten, or intimidate other users.</li>
            <li style={s.li}>Share personal information of others without consent.</li>
            <li style={s.li}>Use the App for any commercial purpose or for financial gain, including paying for or selling shifts.</li>
            <li style={s.li}>Attempt to gain unauthorized access to the platform or other users&apos; accounts.</li>
            <li style={s.li}>Post content that is discriminatory, hateful, or offensive.</li>
            <li style={s.li}>Scrape, mirror, or systematically copy data from the App.</li>
            <li style={s.li}>Interfere with or circumvent rate limits, security controls, or other platform safeguards.</li>
          </ul>
          <p style={s.p}>Violations may result in immediate account suspension or termination.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>5. Reporting and Blocking</h2>
          <p style={s.p}>We Move New York includes tools to help you manage unwanted contact:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>You may block any other user at any time from within the app. Blocked users cannot send you direct messages, contact you about your swap posts, or access your conversation thread.</li>
            <li style={s.li}>You may report users who violate these Terms, including users engaged in harassment, fraud, or other prohibited conduct.</li>
          </ul>
          <p style={s.p}>We review reports in good faith and may take action including warnings, suspension, or permanent account termination. We do not guarantee a specific response timeline, but we take harassment and safety concerns seriously. Users found to be retaliating against reporters may have their accounts terminated.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>6. Reputation System</h2>
          <p style={s.p}>The App includes a reputation and rating system. Reviews must be honest and based on actual swap experiences. Attempting to manipulate ratings — including self-reviewing, coordinating fake reviews, or paying for ratings — is prohibited and may result in account termination.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>7. Invite Codes</h2>
          <p style={s.p}>Each registered user may receive invite codes to share with fellow transit workers. You are responsible for who you invite. Do not share invite codes publicly or with people who are not current transit workers in a role supported by the App. Misuse of invite codes may result in suspension of your account and the invited account.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>8. Account Termination</h2>
          <p style={s.p}>You may delete your account at any time from the Profile page or by emailing wemovenewyork.net@gmail.com. We may suspend or terminate your account at any time if we reasonably believe you have violated these Terms, if required by law, or to protect the safety of other users or the integrity of the App. On termination, your personal information will be handled as described in our Privacy Policy.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>9. Disclaimer of Warranties</h2>
          <p style={s.p}>We Move New York is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, non-infringement, and uninterrupted or error-free operation. We do not warrant that any particular swap will be matched, approved, or completed.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>10. Limitation of Liability</h2>
          <p style={s.p}>To the maximum extent permitted by law, We Move New York (WMNY), FutreEng, and their officers, employees, and agents shall not be liable for any indirect, incidental, consequential, special, or punitive damages, including loss of wages, loss of employment, loss of goodwill, or loss of data, arising out of or related to your use of the App. In no event shall our aggregate liability to you exceed one hundred United States dollars (US $100.00). Some jurisdictions do not allow the exclusion or limitation of certain damages; in those jurisdictions, our liability is limited to the maximum extent permitted by law.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>11. Indemnification</h2>
          <p style={s.p}>You agree to indemnify and hold harmless We Move New York (WMNY), FutreEng, and their officers, employees, and agents from any claim, demand, loss, or damage, including reasonable attorneys&apos; fees, arising out of your use of the App, your violation of these Terms, your violation of any employer policy or collective bargaining agreement, or your violation of any third-party right.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>12. Governing Law and Dispute Resolution</h2>
          <p style={s.p}>These Terms are governed by the laws of the State of New York, without regard to its conflict of laws rules. Any dispute arising out of or relating to these Terms or the App shall be resolved exclusively in the state or federal courts located in New York County, New York, and you consent to the personal jurisdiction of those courts. You and WMNY each waive the right to a jury trial to the extent permitted by law.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>13. Changes to Terms</h2>
          <p style={s.p}>We reserve the right to update these Terms at any time. Continued use of the App after changes are posted constitutes your acceptance of the revised Terms. We will make reasonable efforts to notify users of significant changes through the App or by email.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>14. Contact</h2>
          <p style={s.p}>For questions about these Terms, email wemovenewyork.net@gmail.com or contact us through the app.</p>
        </div>
      </main>
    </div>
  );
}
