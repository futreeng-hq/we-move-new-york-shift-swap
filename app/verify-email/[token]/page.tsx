"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { C } from "@/constants/colors";

export default function VerifyEmailPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const token = params.token;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- guard for a missing route param before the fetch below; one render, no cascade
    if (!token) { setStatus("error"); setErrorMsg("Missing token."); return; }

    fetch(`/api/auth/verify-email/${token}`)
      .then(async res => {
        if (res.ok) {
          setStatus("success");
        } else {
          const data = await res.json().catch(() => ({}));
          setStatus("error");
          setErrorMsg(data?.error ?? "Invalid or expired verification link.");
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMsg("Something went wrong. Please try again.");
      });
  }, [params.token]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 20px" }}>
      <div style={{ maxWidth: 440, width: "100%", background: "rgba(255,255,255,.04)", border: `1px solid ${C.bd}`, borderRadius: 20, padding: "40px 32px", textAlign: "center" }}>
        {status === "loading" && (
          <>
            <div style={{ width: 48, height: 48, borderRadius: "50%", border: `3px solid ${C.gold}`, borderTopColor: "transparent", animation: "spin 0.8s linear infinite", margin: "0 auto 24px" }} />
            <p style={{ color: C.m, fontSize: 15 }}>Verifying your email…</p>
          </>
        )}

        {status === "success" && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: C.white, marginBottom: 8 }}>Email verified!</h1>
            <p style={{ color: C.m, fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
              Your email has been verified. You can now sign in to WMNY Shift Swap.
            </p>
            <button
              onClick={() => router.push("/login")}
              style={{ display: "inline-block", padding: "14px 32px", borderRadius: 12, background: C.gold, color: C.bg, fontWeight: 700, fontSize: 15, border: "none", cursor: "pointer", width: "100%" }}
            >
              Sign In
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: C.white, marginBottom: 8 }}>Verification failed</h1>
            <p style={{ color: C.m, fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
              {errorMsg || "This link is invalid or has expired. Please register again or contact support."}
            </p>
            <button
              onClick={() => router.push("/login")}
              style={{ display: "inline-block", padding: "14px 32px", borderRadius: 12, background: C.gold, color: C.bg, fontWeight: 700, fontSize: 15, border: "none", cursor: "pointer", width: "100%" }}
            >
              Go to Login
            </button>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
