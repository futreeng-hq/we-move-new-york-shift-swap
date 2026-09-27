"use client";
// Analytics wrapper — Google Analytics 4
// All calls are no-ops if window/gtag is not available.

import { redactSensitivePath } from "@/lib/sensitiveUrl";

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
  // page_path is redacted because /reset-password/<jwt> and
  // /verify-email/<token> carry a live credential in the path. layout.tsx sets
  // send_page_view:false so this is the only page_view GA receives — if that is
  // ever re-enabled, gtag's automatic page_location will leak the raw token again.
  pageView: (path: string) =>
    gtag("event", "page_view", { page_path: redactSensitivePath(path), send_to: GA_ID }),

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
