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
        <p style={s.updated}>Last updated: April 17, 2026</p>

        <div style={s.section}>
          <h2 style={s.h2}>1. Acceptance of Terms</h2>
          <p style={s.p}>By accessing or using We Move New York (&ldquo;the App,&rdquo; &ldquo;WMNY&rdquo;), you agree to be bound by these Terms of Use. If you do not agree to these terms, do not use the App. These terms apply to all users of the platform.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>2. Who Can Use This App</h2>
          <p style={s.p}>We Move New York is intended exclusively for active NYC bus operators. Access requires a valid invite code issued by an existing member. By registering, you confirm that:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>You are a current bus operator.</li>
            <li style={s.li}>The information you provide is accurate and truthful.</li>
            <li style={s.li}>You will not share your account credentials with others.</li>
            <li style={s.li}>You are at least 18 years of age.</li>
          </ul>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>3. Shift Swap Coordination</h2>
          <p style={s.p}>We Move New York is a coordination tool only. It does not replace, supersede, or conflict with any MTA, TWU, or union collective bargaining agreements. All shift swaps must be conducted in accordance with your depot&apos;s official procedures and with supervisor approval.</p>
          <p style={s.p}>WMNY makes no guarantee that a swap listed on the platform will be approved by management. Users are solely responsible for ensuring their swap complies with all applicable rules and agreements.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>4. User Conduct</h2>
          <p style={s.p}>You agree not to use the App to:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>Post false, misleading, or fraudulent swap listings.</li>
            <li style={s.li}>Harass, threaten, or intimidate other users.</li>
            <li style={s.li}>Share personal information of others without consent.</li>
            <li style={s.li}>Use the App for any commercial purpose or for financial gain.</li>
            <li style={s.li}>Attempt to gain unauthorized access to the platform or other users&apos; accounts.</li>
            <li style={s.li}>Post content that is discriminatory, hateful, or offensive.</li>
          </ul>
          <p style={s.p}>Violations may result in immediate account suspension or termination.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>5. Reporting and Blocking</h2>
          <p style={s.p}>We Move New York includes tools to help you manage unwanted contact:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>You may block any other user at any time from within the app. Blocked users will not be able to send you direct messages, contact you about your swap posts, or access your conversation thread.</li>
            <li style={s.li}>You may report users who violate these Terms, including users engaged in harassment, fraud, or other prohibited conduct.</li>
          </ul>
          <p style={s.p}>We review reports in good faith and may take action including warnings, suspension, or permanent account termination. We do not guarantee a specific response timeline, but we take harassment and safety concerns seriously. Users found to be retaliating against reporters may have their accounts terminated.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>6. Reputation System</h2>
          <p style={s.p}>The App includes a reputation and rating system. Reviews must be honest and based on actual swap experiences. Attempting to manipulate ratings — including self-reviewing or coordinating fake reviews — is prohibited and may result in account termination.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>7. Invite Codes</h2>
          <p style={s.p}>Each registered user receives invite codes to share with fellow operators. You are responsible for who you invite. Do not share invite codes publicly or with non-MTA personnel. Misuse of invite codes may result in suspension of your account and the invited account.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>8. Disclaimer of Liability</h2>
          <p style={s.p}>We Move New York is provided &quot;as is&quot; without warranties of any kind. We are not responsible for any disputes, missed shifts, denied swaps, or disciplinary actions arising from the use of this platform. Use at your own discretion and in accordance with your employer&apos;s policies.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>9. Changes to Terms</h2>
          <p style={s.p}>We reserve the right to update these Terms at any time. Continued use of the App after changes are posted constitutes your acceptance of the revised terms. We will make reasonable efforts to notify users of significant changes.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>10. Contact</h2>
          <p style={s.p}>For questions about these Terms, you can reach us at wemovenewyork.net@gmail.com or through the app.</p>
        </div>
      </main>
    </div>
  );
}
