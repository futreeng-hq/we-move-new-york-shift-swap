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
  li: { fontSize: 14, color: "rgba(255,255,255,.75)", lineHeight: 1.8, marginBottom: 6 },
  divider: { borderColor: C.bd, margin: "28px 0" },
  table: { width: "100%", borderCollapse: "collapse" as const, marginBottom: 16, fontSize: 13 },
  th: { textAlign: "left" as const, padding: "10px 8px", color: C.gold, fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 1.5, borderBottom: `1px solid ${C.bd}`, verticalAlign: "top" as const },
  td: { padding: "12px 8px", color: "rgba(255,255,255,.75)", lineHeight: 1.6, borderBottom: `1px solid ${C.bd}`, verticalAlign: "top" as const },
};

export default function PrivacyPage() {
  const router = useRouter();
  return (
    <div style={s.page}>
      <div style={s.header}>
        <button onClick={() => router.back()} aria-label="Go back" style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.bd}`, background: C.s, color: C.gold, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon n="back" s={16} />
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.white }}>Privacy Policy</div>
      </div>

      <main id="main-content" tabIndex={-1} style={s.content}>
        <h1 style={s.h1}>Privacy Policy</h1>
        <p style={s.updated}>Last updated: October 1, 2026</p>

        <div style={s.section}>
          <h2 style={s.h2}>1. Overview</h2>
          <p style={s.p}>We Move New York (&ldquo;WMNY,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) operates the Shift Swap platform at wmnyshiftswap.com (the &ldquo;App&rdquo;). This Privacy Policy explains what information we collect, how we use it, who we share it with, and the rights you have over your data. WMNY is not affiliated with, endorsed by, or operated by TWU Local 100, the MTA, NYCT, or any labor union or transit employer. By using the App, you agree to the practices described here.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>2. Information We Collect</h2>
          <p style={s.p}><strong style={{ color: C.white }}>Account information:</strong> name, email address, depot assignment, transit title (bus operator and other roles as added), and a hashed password. Passwords are never stored in plain text.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Swap listings:</strong> shift details, run numbers, routes, dates, and any notes you add. Listings are visible to other verified users at your depot.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Messages:</strong> direct messages between users are stored to facilitate swap coordination. Messages are only visible to the sender and recipient.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Reputation and reviews:</strong> ratings and completed-swap history are stored and displayed to other users to build trust in the platform.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Push notification tokens:</strong> if you enable push notifications, your browser generates a push subscription endpoint. We store that endpoint and the public keys needed to deliver notifications. We never see your device identifier.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Technical data:</strong> IP address (used for rate limiting and abuse prevention), browser type, device type, and timestamps of your activity. IP addresses are hashed for rate-limit storage and not displayed to other users.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Audit data:</strong> records of sensitive actions (login attempts, account changes, abuse reports) are retained for security and abuse prevention.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>3. How We Use Your Information</h2>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>To operate and maintain the swap coordination platform.</li>
            <li style={s.li}>To display your profile, reputation, and listings to other verified users.</li>
            <li style={s.li}>To send transactional communications (welcome, password reset, abuse-report confirmations, swap notifications).</li>
            <li style={s.li}>To enforce our Terms of Use and investigate reported content.</li>
            <li style={s.li}>To measure usage, performance, and errors so we can improve the App.</li>
            <li style={s.li}>To comply with applicable law and respond to lawful requests.</li>
          </ul>
          <p style={s.p}>We do not sell, rent, or share your personal information with third parties for marketing purposes, and we do not share your personal information with your employer.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>4. Service Providers (Sub-Processors)</h2>
          <p style={s.p}>We use the following third-party service providers to operate the App. Each is bound by a Data Processing Agreement and may only use the data we share for the purposes described below.</p>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Provider</th>
                <th style={s.th}>Purpose</th>
                <th style={s.th}>Region</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={s.td}>Vercel Inc.</td>
                <td style={s.td}>Hosting, Vercel Analytics, Speed Insights, scheduled jobs</td>
                <td style={s.td}>USA</td>
              </tr>
              <tr>
                <td style={s.td}>Neon Inc.</td>
                <td style={s.td}>Managed PostgreSQL database</td>
                <td style={s.td}>USA</td>
              </tr>
              <tr>
                <td style={s.td}>Resend Inc.</td>
                <td style={s.td}>Transactional email delivery</td>
                <td style={s.td}>USA</td>
              </tr>
              <tr>
                <td style={s.td}>Functional Software Inc. (Sentry)</td>
                <td style={s.td}>Error and performance monitoring</td>
                <td style={s.td}>USA</td>
              </tr>
              <tr>
                <td style={s.td}>Upstash Inc.</td>
                <td style={s.td}>Rate-limit cache (Redis), stores hashed IP addresses</td>
                <td style={s.td}>USA</td>
              </tr>
              <tr>
                <td style={s.td}>Google LLC</td>
                <td style={s.td}>Google Analytics 4 — aggregate usage measurement</td>
                <td style={s.td}>USA</td>
              </tr>
            </tbody>
          </table>
          <p style={s.p}>In Google Analytics, page views are associated with a WMNY-generated account identifier along with your role, depot, and language so we can understand how each depot uses the App. We do not send your name, email address, or password to Google. Sensitive URLs (password reset, email verification, invite links) are redacted before any analytics or error report is sent.</p>
          <p style={s.p}>We will post updates to this list before adding or materially changing a sub-processor.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>5. Who Can See Your Information</h2>
          <p style={s.p}><strong style={{ color: C.white }}>Other verified users</strong> can see your name, depot, swap listings, and reputation score.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Your contact information</strong> (such as a phone number) is only visible if you choose to include it on a swap post.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Messages</strong> are private between sender and recipient only.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Your email address</strong> is never displayed publicly on the platform.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>6. Data Security</h2>
          <p style={s.p}>Consistent with the New York SHIELD Act, we maintain a written information security program that includes reasonable administrative, technical, and physical safeguards. Technical measures include password hashing (bcrypt), JWT-based authentication with short-lived access tokens and separate refresh/reset secrets, HTTPS-only transport, encrypted database connections (sslmode=require), server-side rate limiting, and session cookies that are not accessible to browser scripts. We review access to production systems on an ongoing basis. No method of transmission over the internet is 100% secure, but we work to protect your data at a level appropriate to its sensitivity.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>7. Data Breach Notification</h2>
          <p style={s.p}>If we discover a breach of security that compromises the private information of New York residents, we will notify affected users and the appropriate authorities as required by New York General Business Law &sect; 899-aa (the SHIELD Act) and any other applicable law. Notice will describe the categories of information involved, the steps we are taking in response, and recommended steps you can take to protect yourself.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>8. Data Retention</h2>
          <p style={s.p}>We retain different categories of data for different periods:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}><strong style={{ color: C.white }}>Swap listings</strong> are automatically expired after 90 days of inactivity.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Messages</strong> between users are retained for as long as both user accounts remain active, or until a user deletes them.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Reputation and rating history</strong> is retained for the life of the account so that trust signals remain available to other users.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Block records</strong> are retained for the life of both accounts to ensure block enforcement remains active.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Audit logs</strong> of sensitive actions are retained for up to 12 months.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Rate-limit records</strong> (hashed IPs) expire automatically within hours.</li>
          </ul>
          <p style={s.p}>When you request deletion of your account, your profile, swap listings, and personally identifying information are removed within 30 days. Some data (audit logs and records of reported or terminated accounts) may be retained longer to prevent abuse and as required by applicable law.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>9. Cookies and Similar Technologies</h2>
          <p style={s.p}>We use secure, HTTP-only session cookies to keep you signed in. These cookies are set by our servers and cannot be read by browser scripts, which protects your login from common web attacks. Google Analytics may set cookies for aggregate usage measurement. We do not use advertising cookies, cross-site tracking cookies, or sell data to advertisers.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>10. Your Rights</h2>
          <p style={s.p}>You have the right to:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>Access and update your personal information via your Profile page.</li>
            <li style={s.li}>Delete your swap posts at any time.</li>
            <li style={s.li}>Request deletion of your account and all associated data.</li>
            <li style={s.li}>Opt out of non-essential email and push communications.</li>
            <li style={s.li}>Receive a copy of the personal information we hold about you in a portable format.</li>
          </ul>
          <p style={s.p}><strong style={{ color: C.white }}>California residents:</strong> under the California Consumer Privacy Act (as amended by the CPRA), you also have the right to know what personal information we collect, to request deletion, to correct inaccurate information, and to not be discriminated against for exercising these rights. We do not sell or share personal information for cross-context behavioral advertising.</p>
          <p style={s.p}>To exercise any of these rights, email wemovenewyork.net@gmail.com or contact us through the app. We will respond within 30 days.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>11. Children</h2>
          <p style={s.p}>The App is intended for working adults aged 18 and older. We do not knowingly collect information from anyone under 18. If you believe a minor has registered, contact us and we will remove the account.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>12. International Users</h2>
          <p style={s.p}>The App is hosted in the United States and is intended for use by transit workers employed in New York. If you access the App from outside the United States, you consent to the transfer, processing, and storage of your information in the United States.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>13. Changes to This Policy</h2>
          <p style={s.p}>We may update this Privacy Policy from time to time. Material changes will be announced through the App and reflected in the &ldquo;Last updated&rdquo; date above. Continued use after changes are posted means you accept the updated policy.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>14. Contact</h2>
          <p style={s.p}>For privacy questions, data access requests, or account deletion requests, email wemovenewyork.net@gmail.com or contact us through the app. For security concerns, email abuse@wmnyshiftswap.com.</p>
        </div>
      </main>
    </div>
  );
}
