import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";
import MeshBackground from "@/components/ui/MeshBackground";
import OfflineBanner from "@/components/ui/OfflineBanner";
import AnalyticsProvider from "@/components/ui/AnalyticsProvider";
import VercelAnalytics from "@/components/ui/VercelAnalytics";
import { SpeedInsights } from "@vercel/speed-insights/next";

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
          // send_page_view:false is deliberate and load-bearing: gtag's
          // automatic page_view records page_location as the full URL, which on
          // /reset-password/<jwt> and /verify-email/<token> is a live
          // account-takeover credential. AnalyticsProvider sends every page_view
          // instead, through lib/analytics.ts, which redacts those paths.
          gtag('config', 'G-RJV2G8G06H', { send_page_view: false });
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
        <SpeedInsights />
      </body>
    </html>
  );
}
