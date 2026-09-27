import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";
import MeshBackground from "@/components/ui/MeshBackground";
import OfflineBanner from "@/components/ui/OfflineBanner";
import AnalyticsProvider from "@/components/ui/AnalyticsProvider";
import VercelAnalytics from "@/components/ui/VercelAnalytics";
import VercelSpeedInsights from "@/components/ui/VercelSpeedInsights";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WMNY Shift Swap",
  description: "Peer-to-peer shift swap platform for NYC MTA bus operators",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "WMNY Shift Swap",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" type="image/png" href="/icons/icon-192.png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="theme-color" content="#010028" />
      </head>
      <body className={poppins.className}>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-RJV2G8G06H"
          strategy="afterInteractive"
        />
        <Script id="ga-init" strategy="afterInteractive">{`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          // send_page_view:false stops gtag's automatic page_view, and
          // lib/analytics.ts redacts page_path on the one we send instead.
          //
          // That is NOT sufficient on its own, and assuming it was let a live
          // token reach GA in production. page_location (GA4's 'dl') is
          // attached automatically to EVERY hit from window.location.href —
          // not just page_view, but enhanced-measurement events like scroll
          // that we never fire. Overriding page_path only changes 'dp'.
          // Observed on the live site: dp=/reset-password/[redacted] alongside
          // dl=https://.../reset-password/<the real jwt>.
          //
          // So page_location is pinned to a redacted value here, before any
          // hit can fire, and kept current on navigation by lib/analytics.ts.
          // Prefix list duplicated from lib/sensitiveUrl.ts (an inline script
          // cannot import it) — keep the two in sync.
          var SENSITIVE = ['/reset-password', '/verify-email'];
          function redactedHref() {
            try {
              var u = new URL(window.location.href);
              for (var i = 0; i < SENSITIVE.length; i++) {
                var p = SENSITIVE[i];
                if (u.pathname === p || u.pathname.indexOf(p + '/') === 0) {
                  return u.origin + p + '/[redacted]';
                }
              }
              return u.origin + u.pathname;
            } catch (e) { return undefined; }
          }
          gtag('config', 'G-RJV2G8G06H', {
            send_page_view: false,
            page_location: redactedHref()
          });
        `}</Script>
        <MeshBackground />
        <header>
          <a href="#main-content" className="skip-link">Skip to main content</a>
          <OfflineBanner />
        </header>
        <AuthProvider>
          <AnalyticsProvider>
            <div style={{ position: "relative", zIndex: 1 }}>
              {children}
            </div>
          </AnalyticsProvider>
        </AuthProvider>
        {/* Same reason as send_page_view above: Vercel Analytics records the
            pathname, so the reset/verify credential segment is stripped before
            the beacon is sent. */}
        <VercelAnalytics />
        {/* Wrapped for the same reason as VercelAnalytics: the beacon carries
            the page URL, so the reset/verify credential segment is stripped. */}
        <VercelSpeedInsights />
      </body>
    </html>
  );
}
