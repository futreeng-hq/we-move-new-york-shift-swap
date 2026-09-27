"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { C } from "@/constants/colors";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!email) { setError("Please enter your email address"); return; }
    setSubmitting(true); setError("");
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main id="main-content" tabIndex={-1} style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <div style={{ maxWidth: 400, width: "100%", background: "rgba(255,255,255,.02)", backdropFilter: "blur(16px)", borderRadius: 28, border: "1px solid rgba(255,255,255,.06)", padding: 32, boxShadow: "0 24px 80px rgba(0,0,0,.3)" }}>
        <button onClick={() => router.push("/login")} aria-label="Back to sign in" style={{ background: "none", border: "none", cursor: "pointer", color: C.m, fontSize: 13, marginBottom: 20, padding: 0, display: "flex", alignItems: "center", gap: 6 }}>
          ← Back to Sign In
        </button>

        <h1 style={{ fontSize: 24, fontWeight: 800, color: C.white, marginBottom: 8 }}>Forgot Password</h1>

        {sent ? (
          <div role="status" aria-live="polite">
            <div style={{ padding: "16px 18px", borderRadius: 14, background: "rgba(0,201,167,.08)", border: "1px solid rgba(0,201,167,.25)", marginBottom: 14, fontSize: 14, color: "#00C9A7", lineHeight: 1.6 }}>
              Check your inbox — if that email is registered, a reset link has been sent. It expires in 1 hour.
            </div>
            <button onClick={() => router.push("/login")} style={{ width: "100%", padding: 14, borderRadius: 14, border: "none", cursor: "pointer", background: `linear-gradient(135deg,${C.gold},${C.gold}dd)`, fontSize: 15, fontWeight: 700, color: C.bg }}>
              Back to Sign In
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <p style={{ fontSize: 14, color: C.m, margin: 0, lineHeight: 1.6 }}>
              Enter your account email and we&rsquo;ll send you a link to reset your password.
            </p>

            {error && (
              <div role="alert" aria-live="assertive" style={{ padding: "10px 14px", borderRadius: 12, background: C.red + "15", border: `1px solid ${C.red}33`, fontSize: 13, color: C.red }}>
                {error}
              </div>
            )}

            <div>
              <label htmlFor="forgot-email" style={{ display: "block", marginBottom: 8, fontSize: 12, fontWeight: 600, color: C.m, letterSpacing: 2, textTransform: "uppercase" }}>
                Email Address
              </label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                placeholder="you@example.com"
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{ padding: 16, borderRadius: 14, border: "none", cursor: "pointer", background: `linear-gradient(135deg,${C.gold},${C.gold}dd)`, fontSize: 15, fontWeight: 700, color: C.bg, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? "Sending..." : "Send Reset Link"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
