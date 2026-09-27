"use client";
// Analytics wrapper — Google Analytics 4
// All calls are no-ops if window/gtag is not available.

import { redactSensitivePath, redactSensitiveUrl } from "@/lib/sensitiveUrl";

const GA_ID = "G-RJV2G8G06H";

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
  }
}

function gtag(...args: unknown[]) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag(...args);
}

export function initAnalytics() {
  // gtag is initialized via the script tag in layout.tsx — nothing to do here.
}

export function identifyUser(userId: string, props: {
  role?: string;
  depot?: string;
  language?: string;
  jobTitle?: string;
}) {
  if (typeof window === "undefined") return;
  gtag("set", "user_properties", props);
  gtag("config", GA_ID, { user_id: userId });
}

export function resetAnalytics() {
  if (typeof window === "undefined") return;
  gtag("set", "user_properties", {});
}

export function track(event: string, props?: Record<string, unknown>) {
  gtag("event", event, props);
}

// Typed event helpers
export const analytics = {
  // /reset-password/<jwt> and /verify-email/<token> carry a live
  // account-takeover credential in the path, so BOTH of GA4's location
  // parameters have to be overridden:
  //
  //   page_path     -> 'dp'  (what we send on this event)
  //   page_location -> 'dl'  (attached automatically to EVERY hit, read from
  //                           window.location.href)
  //
  // Redacting page_path alone was not enough and leaked a real token to GA in
  // production: enhanced-measurement events such as scroll, which we never
  // fire ourselves, still carried the raw URL in 'dl'. gtag("set") pins the
  // redacted value as a global parameter so those automatic hits inherit it
  // too, not just the page_view below.
  pageView: (path: string) => {
    const redactedPath = redactSensitivePath(path);
    if (typeof window !== "undefined") {
      gtag("set", {
        page_path: redactedPath,
        page_location: redactSensitiveUrl(window.location.href),
      });
    }
    gtag("event", "page_view", { page_path: redactedPath, send_to: GA_ID });
  },

  // Auth
  signupStarted: () => track("signup_started"),
  signupCompleted: (method: "email") => track("signup_completed", { method }),
  loginCompleted: () => track("login_completed"),
  logoutCompleted: () => track("logout_completed"),

  // Onboarding
  profileSetupCompleted: (depotCode: string) => track("profile_setup_completed", { depot: depotCode }),
  onboardingCompleted: () => track("onboarding_completed"),
  checklistItemCompleted: (item: string) => track("checklist_item_completed", { item }),
  checklistDismissed: (completedCount: number) => track("checklist_dismissed", { completed_count: completedCount }),

  // Swaps
  swapPosted: (props: { type: string; depot: string; swapType?: string }) => track("swap_posted", props),
  swapViewed: (swapId: string, depot: string) => track("swap_viewed", { swap_id: swapId, depot }),
  swapSaved: (swapId: string) => track("swap_saved", { swap_id: swapId }),
  swapShared: (swapId: string, method: string) => track("swap_shared", { swap_id: swapId, method }),
  swapFiltered: (filters: Record<string, unknown>) => track("swap_filtered", filters),

  // Agreements
  agreementStarted: (swapId: string) => track("agreement_started", { swap_id: swapId }),
  agreementCompleted: (swapId: string) => track("agreement_completed", { swap_id: swapId }),

  // Messages
  messageSent: (threadId: string) => track("message_sent", { thread_id: threadId }),

  // Profile
  avatarUploaded: () => track("avatar_uploaded"),
  pushEnabled: () => track("push_enabled"),
  languageChanged: (lang: string) => track("language_changed", { language: lang }),
  feedbackSubmitted: () => track("feedback_submitted"),
  dataDownloaded: () => track("data_downloaded"),

  // Errors
  errorShown: (error: string, page: string) => track("error_shown", { error, page }),
};
