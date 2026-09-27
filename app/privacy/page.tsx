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
        <p style={s.updated}>Last updated: April 17, 2026</p>

        <div style={s.section}>
          <h2 style={s.h2}>1. Overview</h2>
          <p style={s.p}>We Move New York (&ldquo;WMNY,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is committed to protecting your privacy. This Privacy Policy explains what information we collect, how we use it, and your rights regarding your data. WMNY is not affiliated with, endorsed by, or operated by TWU Local 100, the MTA, NYCT, or any labor union. By using the App, you agree to the practices described in this policy.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>2. Information We Collect</h2>
          <p style={s.p}><strong style={{ color: C.white }}>Account Information:</strong> When you register, we collect your name, email address, depot assignment, and a hashed (encrypted) password. We never store your password in plain text.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Swap Listings:</strong> Content you post — including shift details, run numbers, routes, and dates — is visible to other verified users at your depot.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Messages:</strong> Messages sent through the platform are stored to facilitate swap coordination. Messages are only visible to the sender and recipient.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Reputation & Reviews:</strong> Ratings and completion history are stored and displayed to other users to build trust in the platform.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Usage Data:</strong> We use Google Analytics and Google Tag Manager, and Vercel Analytics and Vercel Speed Insights, to collect basic usage data such as pages visited, features used, and page performance, to improve the App. In Google Analytics, page views are associated with your account identifier along with your role, depot, and language so we can understand how each depot uses the App; we do not attach your name or email. We use Sentry to monitor errors and performance; client replay data is configured to mask inputs and text, and password-reset and email-verification links are redacted before any analytics or error report is sent. We use Resend to deliver transactional email. These providers process data under their own privacy policies. We do not sell this data, and we do not share it with your employer.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>3. How We Use Your Information</h2>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>To operate and maintain the swap coordination platform.</li>
            <li style={s.li}>To display your profile, reputation, and listings to other verified users.</li>
            <li style={s.li}>To send you messages from other operators about your swap posts.</li>
            <li style={s.li}>To enforce our Terms of Use and investigate reported content.</li>
            <li style={s.li}>To improve the App&apos;s features and user experience.</li>
          </ul>
          <p style={s.p}>We do not sell, rent, or share your personal information with third parties for marketing purposes.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>4. Who Can See Your Information</h2>
          <p style={s.p}><strong style={{ color: C.white }}>Other verified users</strong> can see your name, depot, swap listings, and reputation score.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Your contact information</strong> (phone number) is only visible if you choose to include it on a swap post.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Messages</strong> are private between sender and recipient only.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Your email address</strong> is never displayed publicly on the platform.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>5. Data Security</h2>
          <p style={s.p}>We use industry-standard security measures including password hashing (bcrypt), JWT-based authentication with short-lived tokens, and encrypted database connections. While we work hard to protect your data, no method of transmission over the internet is 100% secure.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>6. Data Retention</h2>
          <p style={s.p}>We retain different categories of data for different periods:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}><strong style={{ color: C.white }}>Swap listings</strong> are automatically expired after 90 days of inactivity.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Messages</strong> between users are retained for as long as both user accounts remain active, or until a user deletes them.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Reputation and rating history</strong> is retained for the life of the account so that trust signals remain available to other users.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Block records</strong> are retained for the life of both accounts to ensure block enforcement remains active.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Audit logs</strong> of sensitive actions (login attempts, account changes, reports) are retained for up to 12 months for security and abuse prevention.</li>
          </ul>
          <p style={s.p}>When you request deletion of your account, your profile, swap listings, and personally identifying information are removed within 30 days. Some data (such as audit logs and certain records of reported or terminated accounts) may be retained longer to prevent abuse and as required by applicable law.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>7. Cookies</h2>
          <p style={s.p}>We use secure login cookies to maintain your session — these are set by our servers and are not accessible to browser scripts, which protects your login from common web attacks. Google Analytics and Google Tag Manager may use cookies or similar technologies for usage measurement. We do not use advertising cookies or sell data to advertisers.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>8. Your Rights</h2>
          <p style={s.p}>You have the right to:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>Access and update your personal information via your Profile page.</li>
            <li style={s.li}>Delete your swap posts at any time.</li>
            <li style={s.li}>Request deletion of your account and all associated data.</li>
            <li style={s.li}>Opt out of non-essential communications.</li>
          </ul>
          <p style={s.p}>To exercise any of these rights, email us at wemovenewyork.net@gmail.com or contact us through the app.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>9. Changes to This Policy</h2>
          <p style={s.p}>We may update this Privacy Policy from time to time. We will notify users of material changes through the App. Continued use after changes are posted means you accept the updated policy.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>10. Contact</h2>
          <p style={s.p}>For privacy-related questions, data access requests, or account deletion requests, you can reach us at wemovenewyork.net@gmail.com or through the app.</p>
        </div>
      </main>
    </div>
  );
}
