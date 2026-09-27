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
  // metadataBase is what lets Next resolve the relative opengraph-image route
  // into the absolute URL that scrapers require. Without it the card silently
  // does not render, which is the same failure as having no card at all.
  metadataBase: new URL("https://www.wmnyshiftswap.com"),
  title: "WMNY Shift Swap",
  description: "Peer-to-peer shift swap platform for NYC MTA bus operators",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    // DO NOT add `viewport-fit=cover` (a `viewport` export with
    // `viewportFit: "cover"`) without also adding env(safe-area-inset-*)
    // padding throughout.
    //
    // "black-translucent" asks iOS to render the installed app behind the
    // status bar, but that only takes effect once the viewport opts into
    // full-bleed with viewport-fit=cover. Next's default viewport does not,
    // so today the web view stays inside the safe area and nothing is
    // clipped — verified on a real iPhone, installed to the home screen,
    // 2026-09-27.
    //
    // Adding viewport-fit=cover on its own would switch on the full-bleed
    // behaviour with no inset handling anywhere in globals.css, putting the
    // header under the notch and the six `position: fixed` elements under the
    // home indicator. If you want edge-to-edge, do both changes together and
    // check it on hardware.
    statusBarStyle: "black-translucent",
    title: "WMNY Shift Swap",
  },
  // The root page carried no Open Graph tags, so a link pasted into a text
  // message, a Facebook group or a WhatsApp thread unfurled as a bare URL.
  // app/s/[id] already had a card; the page people actually share did not.
  //
  // Deliberately says nothing specific about swaps or depots: this card gets
  // forwarded to people who do not have accounts, and "invite-only" is the
  // honest framing of what they will find.
  openGraph: {
    type: "website",
    siteName: "WMNY Shift Swap",
    title: "WMNY Shift Swap",
    description:
      "Swap work days, days off and vacation picks with operators at your depot. Invite-only, built by a 32-year transit veteran.",
    url: "https://www.wmnyshiftswap.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "WMNY Shift Swap",
    description:
      "Swap work days, days off and vacation picks with operators at your depot. Invite-only.",
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
