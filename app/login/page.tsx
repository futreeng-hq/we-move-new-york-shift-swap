"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import { CURRENT_TERMS_VERSION } from "@/lib/termsVersion";
import { C } from "@/constants/colors";
import Intro from "@/components/screens/Intro";
import MagneticButton from "@/components/ui/MagneticButton";
import { useIsomorphicLayoutEffect } from "@/lib/useIsomorphicLayoutEffect";

const lb: React.CSSProperties = { display: "block", marginBottom: 8, fontSize: 12, fontWeight: 600, color: C.m, letterSpacing: 2, textTransform: "uppercase" };

function pwStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const levels = [
    { label: "", color: "transparent" },
    { label: "Weak", color: "#FF4757" },
    { label: "Fair", color: "#FB923C" },
    { label: "Good", color: "#D1AD38" },
    { label: "Strong", color: "#2ED573" },
  ];
  return { score, ...levels[score] };
}

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();

  // These two initializers read browser-only state, so the server and the
  // client's first render disagreed and React threw hydration error #418 on
  // every returning visit (sessionStorage already has "intro-seen") and on
  // every invite link (?invite= flips the tab to register). React then discards
  // the server HTML and re-renders, which is both an error in the console and a
  // visible flash of the wrong screen.
  //
  // The fix is to make the first client render match the server exactly, then
  // correct it in a layout effect — which runs before the browser paints, so
  // there is no flash. `useState(() => ...)` cannot do that; it runs during
  // render, which is the whole problem.
  const [showIntro, setShowIntro] = useState(true);
  const [mode, setMode] = useState<"signin" | "register">("signin");

  const [em, setEm] = useState(""); const [pw, setPw] = useState("");
  const [fn, setFn] = useState(""); const [ln, setLn] = useState(""); const [pw2, setPw2] = useState("");
  // Same reason: prefilling from the query string during render is a third
  // hydration mismatch, on the invite path specifically.
  const [invCode, setInvCode] = useState("");

  useIsomorphicLayoutEffect(() => {
    try {
      if (sessionStorage.getItem("intro-seen")) setShowIntro(false);
    } catch { /* private mode / blocked storage: keep the intro */ }
    try {
      const invite = new URLSearchParams(window.location.search).get("invite");
      if (invite) { setMode("register"); setInvCode(invite); }
    } catch { /* malformed query string */ }
  }, []);
  const [showPw, setShowPw] = useState(false); const [showPw2, setShowPw2] = useState(false);
  const [err, setErr] = useState(""); const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [shaking, setShaking] = useState(false); const [submitting, setSubmitting] = useState(false);
  const [showConsentFlow, setShowConsentFlow] = useState(false);
  const [regAck, setRegAck] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [acceptingTerms, setAcceptingTerms] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem("wmny-pending-verify-email");
  });
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendStatus, setResendStatus] = useState<"" | "sending" | "sent">("");

  const strength = pwStrength(pw);

  const setErrWithShake = (msg: string) => {
    setErr(msg);
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  };

  useEffect(() => {
    if (!loading && user && !showConsentFlow && !showTerms) {
      if (user.termsVersion !== CURRENT_TERMS_VERSION) {
        setShowTerms(true);
      } else if (!user.depotId) {
        router.replace("/setup-profile");
      } else {
        router.replace(user.depot?.code ? `/depot/${user.depot.code}` : "/depots");
      }
    }
  }, [user, loading, router, showConsentFlow, showTerms]);

  const validateRegister = () => {
    const errs: Record<string, string> = {};
    if (!fn.trim()) errs.fn = "Required";
    if (!ln.trim()) errs.ln = "Required";
    if (!em.trim()) errs.em = "Required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) errs.em = "Enter a valid email";
    if (!pw) errs.pw = "Required";
    else if (pw.length < 12) errs.pw = "Must be at least 12 characters";
    if (!pw2) errs.pw2 = "Required";
    else if (pw !== pw2) errs.pw2 = "Passwords don't match";
    if (!invCode.trim()) errs.inv = "Required — ask a fellow operator";
    if (!regAck) errs.ack = "Please confirm you understand this before creating an account";
    setFieldErrs(errs);
    return Object.keys(errs).length === 0;
  };

  const doSignIn = async () => {
    const errs: Record<string, string> = {};
    if (!em.trim()) errs.em = "Required";
    if (!pw) errs.pw = "Required";
    if (Object.keys(errs).length) { setFieldErrs(errs); setShaking(true); setTimeout(() => setShaking(false), 500); return; }
    setSubmitting(true); setErr(""); setFieldErrs({}); setNeedsVerification(false); setResendStatus("");
    try {
      const data = await api.post<{ user: { id: string; firstName: string; lastName: string; email: string; depotId?: string | null; language: string } }>("/auth/login", { email: em, password: pw });
      // Clear any stale "pending verification" state on successful login
      sessionStorage.removeItem("wmny-pending-verify-email");
      login(data.user as Parameters<typeof login>[0]);
      setShowConsentFlow(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Login failed";
      // Detect the "please verify your email" 403 so we can offer a resend button
      if (/verify your email/i.test(msg)) {
        setNeedsVerification(true);
      }
      setErrWithShake(msg);
    } finally { setSubmitting(false); }
  };

  const doResendVerification = async () => {
    if (!em.trim()) return;
    setResendStatus("sending");
    try {
      await api.post("/auth/resend-verification", { email: em.trim() });
      setResendStatus("sent");
    } catch {
      // Server returns 200 even on miss, so a real error means network/server outage.
      // Still show "sent" to avoid revealing account state.
      setResendStatus("sent");
    }
  };

  const doRegister = async () => {
    if (!validateRegister()) { setShaking(true); setTimeout(() => setShaking(false), 500); return; }
    setSubmitting(true); setErr(""); setFieldErrs({});
    try {
      await api.post<{ user: { id: string; email: string }; emailVerificationRequired?: boolean }>(
        "/auth/register",
        { firstName: fn, lastName: ln, email: em, password: pw, inviteCode: invCode }
      );
      // No auto-login: user must verify email first. Show the "check your inbox" screen.
      const normalized = em.trim().toLowerCase();
      sessionStorage.setItem("wmny-pending-verify-email", normalized);
      setRegisteredEmail(normalized);
    } catch (e: unknown) {
      setErrWithShake(e instanceof Error ? e.message : "Registration failed");
    } finally { setSubmitting(false); }
  };

  if (showIntro) return <Intro onDone={() => { sessionStorage.setItem("intro-seen", "1"); setShowIntro(false); }} />;

  if (registeredEmail) {
    return (
      <main id="main-content" tabIndex={-1} className="page-enter" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ maxWidth: 440, width: "100%", background: "rgba(255,255,255,.02)", backdropFilter: "blur(16px)", borderRadius: 28, border: "1px solid rgba(255,255,255,.06)", padding: 36, boxShadow: "0 24px 80px rgba(0,0,0,.3)", textAlign: "center" }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>📬</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: C.white, marginBottom: 12 }}>Check your email</h1>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,.7)", lineHeight: 1.6, marginBottom: 8 }}>
            We sent a verification link to
          </p>
          <p style={{ fontSize: 15, color: C.white, fontWeight: 600, marginBottom: 20, wordBreak: "break-all" }}>
            {registeredEmail}
          </p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,.55)", lineHeight: 1.6, marginBottom: 16 }}>
            Click the link in that email to verify your account, then come back here to sign in. The link expires in 24 hours.
          </p>
          <div style={{
            background: "rgba(209,173,56,.10)",
            border: "1px solid rgba(209,173,56,.35)",
            borderRadius: 12,
            padding: "12px 14px",
            marginBottom: 20,
            textAlign: "left",
          }}>
            <p style={{ fontSize: 13, color: C.gold, fontWeight: 700, marginBottom: 4 }}>
              📂 Don&apos;t see it? Check your spam folder.
            </p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,.7)", lineHeight: 1.5 }}>
              New email sender — your provider may filter the first message. Mark it &quot;Not Spam&quot; so future messages reach your inbox.
            </p>
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,.4)", lineHeight: 1.6, marginBottom: 20 }}>
            Still nothing after a few minutes? Email{" "}
            <a href="mailto:wemovenewyork.net@gmail.com" style={{ color: C.m }}>wemovenewyork.net@gmail.com</a>.
          </p>
          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem("wmny-pending-verify-email");
              setRegisteredEmail(null);
              setMode("signin");
              setEm(registeredEmail);
              setPw("");
            }}
            style={{ width: "100%", padding: "14px 20px", borderRadius: 14, background: C.m, color: "#010028", fontWeight: 700, fontSize: 15, border: "none", cursor: "pointer" }}
          >
            Go to Sign In
          </button>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="page-enter" style={{ minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", overflowY: "auto" }}>
      <div className={shaking ? "shake" : ""} style={{ maxWidth: 400, width: "100%", background: "rgba(255,255,255,.02)", backdropFilter: "blur(16px)", borderRadius: 28, border: "1px solid rgba(255,255,255,.06)", padding: 32, boxShadow: "0 24px 80px rgba(0,0,0,.3)" }}>
        <style>{`
          @keyframes loginBusFloat { 0%,100% { transform: translateY(0) rotate(-1deg); } 50% { transform: translateY(-8px) rotate(1deg); } }
          @keyframes loginBusDriveIn { from { opacity:0; transform: translateX(-40px) scale(0.9); } to { opacity:1; transform: translateX(0) scale(1); } }
          @keyframes loginBusGlow { 0%,100% { filter: drop-shadow(0 8px 20px rgba(0,102,204,0.4)); } 50% { filter: drop-shadow(0 14px 36px rgba(0,102,204,0.65)) drop-shadow(0 0 18px rgba(209,173,56,0.18)); } }
        `}</style>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ animation: "loginBusDriveIn .7s cubic-bezier(.34,1.2,.64,1) both, loginBusFloat 5s ease-in-out 0.8s infinite, loginBusGlow 4s ease-in-out 0.8s infinite", display: "inline-block", marginBottom: 10 }}>
            <Image src="/bus-logo.png" alt="We Move New York" width={320} height={152} style={{ width: 220, height: "auto", display: "block" }} priority />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: C.white }}>{mode === "signin" ? "Sign In" : "Create Account"}</h1>
        </div>

        {/* Non-affiliation notice. Must stay readable (not fine print) and must
            appear on the Register tab, not only behind the consent modal —
            it is a launch requirement, and at 11px/35% opacity on #010028 it
            was below WCAG contrast. */}
        <p style={{ fontSize: 13, color: "rgba(255,255,255,.72)", textAlign: "center", marginBottom: 16, lineHeight: 1.6 }}>
          We Move NY is not affiliated with, endorsed by, or operated by TWU Local 100 or the MTA.{" "}
          Unofficial peer-to-peer tool, not affiliated with NYCT or any labor union.{" "}
          <a href="/disclaimer" style={{ color: "rgba(255,255,255,.8)", textDecoration: "underline" }}>Disclaimer</a>
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, background: C.s, borderRadius: 12, padding: 4, marginBottom: 18 }}>
          {(["signin", "register"] as const).map(t => (
            <button key={t} onClick={() => { setMode(t); setErr(""); setFieldErrs({}); }} style={{ padding: 10, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: mode === t ? C.gold : "transparent", color: mode === t ? C.bg : C.m }}>
              {t === "signin" ? "Sign In" : "Register"}
            </button>
          ))}
        </div>

        {err && <div role="alert" aria-live="assertive" style={{ padding: "10px 14px", borderRadius: 12, background: C.red + "15", border: `1px solid ${C.red}33`, marginBottom: 14, fontSize: 13, color: C.red }}>{err}</div>}

        {needsVerification && mode === "signin" && (
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(209,173,56,.08)", border: "1px solid rgba(209,173,56,.25)", marginBottom: 14, fontSize: 13, color: "rgba(255,255,255,.85)" }}>
            <p style={{ marginBottom: 10, lineHeight: 1.5 }}>Didn&apos;t get the verification email, or did the link expire?</p>
            {resendStatus === "sent" ? (
              <div>
                <p style={{ color: C.m, fontSize: 12, marginBottom: 6 }}>✓ If that account is unverified, we&apos;ve sent a fresh link.</p>
                <p style={{ color: C.gold, fontSize: 12, fontWeight: 600 }}>📂 Check your spam folder if you don&apos;t see it.</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={doResendVerification}
                disabled={resendStatus === "sending" || !em.trim()}
                style={{ padding: "8px 14px", borderRadius: 10, background: C.m, color: "#010028", fontWeight: 700, fontSize: 13, border: "none", cursor: resendStatus === "sending" ? "wait" : "pointer", opacity: !em.trim() ? 0.5 : 1 }}
              >
                {resendStatus === "sending" ? "Sending…" : "Resend verification email"}
              </button>
            )}
          </div>
        )}

        {mode === "signin" ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label htmlFor="signin-email" style={lb}>Email</label>
              <input id="signin-email" type="email" autoFocus value={em} onChange={e => { setEm(e.target.value); setErr(""); setFieldErrs(p => ({ ...p, em: "" })); }} placeholder="you@example.com" style={fieldErrs.em ? { borderColor: C.red + "88" } : {}} />
              {fieldErrs.em && <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>{fieldErrs.em}</div>}
            </div>
            <div>
              <label htmlFor="signin-pw" style={lb}>Password</label>
              <div style={{ position: "relative" }}>
                <input id="signin-pw" type={showPw ? "text" : "password"} value={pw} onChange={e => { setPw(e.target.value); setErr(""); }} placeholder="Your password" onKeyDown={e => e.key === "Enter" && doSignIn()} style={{ paddingRight: 44 }} />
                <button type="button" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 6, cursor: "pointer", color: C.white, fontSize: 11, fontWeight: 700, padding: "3px 8px", lineHeight: "16px" }}>{showPw ? "Hide" : "Show"}</button>
              </div>
            </div>
            <MagneticButton onClick={doSignIn} disabled={submitting} style={{ padding: 16, borderRadius: 14, border: "none", cursor: "pointer", background: `linear-gradient(135deg,${C.gold},${C.gold}dd)`, fontSize: 16, fontWeight: 700, color: C.bg, opacity: submitting ? 0.7 : 1, width: "100%" }}>
              {submitting ? "Signing in..." : "Sign In"}
            </MagneticButton>
            <button type="button" onClick={() => router.push("/forgot-password")} style={{ background: "none", border: "none", cursor: "pointer", color: C.m, fontSize: 13, textAlign: "center", padding: "4px 0" }}>
              Forgot password?
            </button>
          </div>
        ) : mode === "register" ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ fontSize: 12, color: C.m, textAlign: "center", marginBottom: 4 }}>Takes about 60 seconds · 3 quick steps</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 14 }}>
              {["Account", "Profile", "Done"].map((s, i) => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: i === 0 ? C.gold : "rgba(255,255,255,.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: i === 0 ? C.bg : C.m }}>{i + 1}</div>
                  <span style={{ fontSize: 11, color: i === 0 ? C.white : C.m, fontWeight: i === 0 ? 600 : 400 }}>{s}</span>
                  {i < 2 && <div style={{ width: 16, height: 1, background: "rgba(255,255,255,.1)" }} />}
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label htmlFor="reg-fn" style={lb}>First Name</label>
                <input id="reg-fn" autoFocus value={fn} onChange={e => { setFn(e.target.value); setFieldErrs(p => ({ ...p, fn: "" })); }} placeholder="John" style={fieldErrs.fn ? { borderColor: C.red + "88" } : {}} />
                {fieldErrs.fn && <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>{fieldErrs.fn}</div>}
              </div>
              <div>
                <label htmlFor="reg-ln" style={lb}>Last Name</label>
                <input id="reg-ln" value={ln} onChange={e => { setLn(e.target.value); setFieldErrs(p => ({ ...p, ln: "" })); }} placeholder="Williams" style={fieldErrs.ln ? { borderColor: C.red + "88" } : {}} />
                {fieldErrs.ln && <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>{fieldErrs.ln}</div>}
              </div>
            </div>
            <div>
              <label htmlFor="reg-email" style={lb}>Email</label>
              <input id="reg-email" type="email" value={em} onChange={e => { setEm(e.target.value); setFieldErrs(p => ({ ...p, em: "" })); }} placeholder="you@example.com" style={fieldErrs.em ? { borderColor: C.red + "88" } : {}} />
              {fieldErrs.em && <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>{fieldErrs.em}</div>}
            </div>
            <div>
              <label htmlFor="reg-pw" style={lb}>Create Password</label>
              <div style={{ position: "relative" }}>
                <input id="reg-pw" type={showPw ? "text" : "password"} value={pw} onChange={e => { setPw(e.target.value); setFieldErrs(p => ({ ...p, pw: "" })); }} placeholder="Min 12 characters" style={{ paddingRight: 44, ...(fieldErrs.pw ? { borderColor: C.red + "88" } : {}) }} />
                <button type="button" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 6, cursor: "pointer", color: C.white, fontSize: 11, fontWeight: 700, padding: "3px 8px", lineHeight: "16px" }}>{showPw ? "Hide" : "Show"}</button>
              </div>
              {pw && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ display: "flex", gap: 3, marginBottom: 3 }}>
                    {[1,2,3,4].map(i => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= strength.score ? strength.color : "rgba(255,255,255,.08)", transition: "background .2s" }} />)}
                  </div>
                  {strength.label && <div style={{ fontSize: 11, color: strength.color }}>{strength.label}</div>}
                </div>
              )}
              {fieldErrs.pw && <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>{fieldErrs.pw}</div>}
            </div>
            <div>
              <label htmlFor="reg-pw2" style={lb}>Confirm Password</label>
              <div style={{ position: "relative" }}>
                <input id="reg-pw2" type={showPw2 ? "text" : "password"} value={pw2} onChange={e => { setPw2(e.target.value); setFieldErrs(p => ({ ...p, pw2: "" })); }} placeholder="Re-enter password" style={{ paddingRight: 44, ...(fieldErrs.pw2 ? { borderColor: C.red + "88" } : {}) }} />
                <button type="button" aria-label={showPw2 ? "Hide password" : "Show password"} onClick={() => setShowPw2(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 6, cursor: "pointer", color: C.white, fontSize: 11, fontWeight: 700, padding: "3px 8px", lineHeight: "16px" }}>{showPw2 ? "Hide" : "Show"}</button>
                {pw2 && pw && <div style={{ position: "absolute", right: 60, top: "50%", transform: "translateY(-50%)", fontSize: 14 }}>{pw === pw2 ? "✓" : "✗"}</div>}
              </div>
              {fieldErrs.pw2 && <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>{fieldErrs.pw2}</div>}
            </div>
            <div>
              <label htmlFor="reg-invite" style={lb}>Invite Code</label>
              <input id="reg-invite" value={invCode} onChange={e => { setInvCode(e.target.value.toUpperCase()); setFieldErrs(p => ({ ...p, inv: "" })); }} placeholder="e.g. WMNY-DEMO1" style={{ letterSpacing: 2, textTransform: "uppercase", ...(fieldErrs.inv ? { borderColor: C.red + "88" } : {}) }} />
              {fieldErrs.inv
                ? <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>{fieldErrs.inv}</div>
                : <div style={{ fontSize: 11, color: C.m, marginTop: 4 }}>Ask a fellow operator for their invite code</div>
              }
            </div>
            {/* Non-affiliation acknowledgement, gating account creation.
                The full consent modal and Terms screen fire on first SIGN-IN,
                i.e. after the account already exists, so this is what makes the
                disclosure land *before* it — a launch requirement. Wording is
                the canonical sentence, verbatim. */}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,.03)", border: `1px solid ${regAck ? "rgba(209,173,56,.4)" : fieldErrs.ack ? C.red + "88" : "rgba(255,255,255,.08)"}` }}>
              <input
                id="reg-ack"
                type="checkbox"
                checked={regAck}
                onChange={e => { setRegAck(e.target.checked); setFieldErrs(p => ({ ...p, ack: "" })); }}
                style={{ width: 18, height: 18, marginTop: 1, accentColor: C.gold, flexShrink: 0, cursor: "pointer" }}
              />
              <label htmlFor="reg-ack" style={{ fontSize: 12.5, color: "rgba(255,255,255,.75)", lineHeight: 1.55, cursor: "pointer" }}>
                I understand that <strong style={{ color: C.white }}>We Move NY is not affiliated with, endorsed by, or operated by TWU Local 100 or the MTA</strong>, and that swap agreements are between operators only. I am responsible for making sure any swap complies with my collective bargaining agreement and depot rules.{" "}
                <a href="/terms" style={{ color: C.gold, textDecoration: "underline" }}>Terms</a>{" · "}
                <a href="/privacy" style={{ color: C.gold, textDecoration: "underline" }}>Privacy</a>
              </label>
            </div>
            {fieldErrs.ack && <div style={{ fontSize: 11, color: C.red, marginTop: -6 }}>{fieldErrs.ack}</div>}
            <MagneticButton onClick={doRegister} disabled={submitting} style={{ padding: 16, borderRadius: 14, border: "none", cursor: "pointer", background: `linear-gradient(135deg,${C.gold},${C.gold}dd)`, fontSize: 16, fontWeight: 700, color: C.bg, opacity: submitting ? 0.7 : 1, width: "100%" }}>
              {submitting ? "Creating account..." : "Create Account →"}
            </MagneticButton>
          </div>
        ) : null}

      </div>

      {showConsentFlow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="disclaimer-title"
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(1,0,40,.97)", backdropFilter: "blur(24px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 28px calc(40px + env(safe-area-inset-bottom, 0px)) 28px", overflowY: "auto" }}
        >
          <div style={{ maxWidth: 400, width: "100%", maxHeight: "calc(100dvh - 80px - env(safe-area-inset-bottom, 0px))", overflowY: "auto" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.gold + "18", border: `1.5px solid ${C.gold}44`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7L12 2z" stroke={C.gold} strokeWidth="1.8" strokeLinejoin="round"/>
                <path d="M12 8v4M12 16h.01" stroke={C.gold} strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>

            <h2 id="disclaimer-title" style={{ fontSize: 22, fontWeight: 800, color: C.white, textAlign: "center", marginBottom: 16 }}>
              Before You Continue
            </h2>

            <div style={{ background: "rgba(255,255,255,.04)", border: `1px solid rgba(255,255,255,.08)`, borderRadius: 16, padding: "20px 18px", marginBottom: 24, fontSize: 13, color: C.m, lineHeight: 1.75 }}>
              <p style={{ margin: "0 0 12px" }}>
                <strong style={{ color: C.white }}>WMNY Shift Swap</strong> is an unofficial peer-to-peer tool for MTA bus operators to coordinate shift swaps among themselves.
              </p>
              <p style={{ margin: "0 0 12px" }}>
                <strong style={{ color: C.white }}>We Move NY is not affiliated with, endorsed by, or operated by TWU Local 100 or the MTA.</strong> Nor by any other transit agency or labor union.
              </p>
              <p style={{ margin: "0 0 12px" }}>
                All swap agreements are <strong style={{ color: C.white }}>between operators only</strong>. It is your responsibility to ensure any swap complies with your collective bargaining agreement, depot rules, and all applicable MTA policies before submitting to your dispatcher.
              </p>
              <p style={{ margin: 0 }}>
                By continuing, you confirm you are an authorized bus operator and agree to use this app in accordance with your employment obligations.
              </p>
            </div>

            <button
              onClick={() => { setShowConsentFlow(false); setShowTerms(true); }}
              autoFocus
              style={{ width: "100%", padding: 16, borderRadius: 14, border: "none", cursor: "pointer", background: `linear-gradient(135deg,${C.gold},${C.gold}cc)`, fontSize: 16, fontWeight: 800, color: C.bg }}
            >
              I Understand — View Terms →
            </button>
          </div>
        </div>
      )}

      {showTerms && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="terms-title"
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(1,0,40,.97)", backdropFilter: "blur(24px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "28px 20px calc(28px + env(safe-area-inset-bottom)) 20px" }}
        >
          <div style={{ maxWidth: 440, width: "100%", display: "flex", flexDirection: "column", maxHeight: "calc(100dvh - 56px - env(safe-area-inset-bottom, 0px))" }}>
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: C.gold + "18", border: `1.5px solid ${C.gold}44`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M9 12h6M9 16h6M9 8h4M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" stroke={C.gold} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h2 id="terms-title" style={{ fontSize: 20, fontWeight: 800, color: C.white, margin: 0 }}>Terms of Use</h2>
              <p style={{ fontSize: 12, color: C.m, margin: "6px 0 0" }}>Please read and agree to continue</p>
            </div>

            {/* Scrollable terms body */}
            <div style={{ flex: 1, overflowY: "auto", background: "rgba(255,255,255,.03)", border: `1px solid rgba(255,255,255,.08)`, borderRadius: 16, padding: "18px 16px", marginBottom: 18, fontSize: 12, color: "rgba(255,255,255,.7)", lineHeight: 1.75 }}>
              {[
                { title: "1. Acceptance of Terms", body: 'By accessing or using We Move New York ("WMNY"), you agree to be bound by these Terms of Use. If you do not agree, do not use the App.' },
                { title: "2. Who Can Use This App", body: "WMNY is intended exclusively for active NYC bus operators. By registering you confirm you are a current bus operator, the information you provide is accurate, you will not share your credentials, and you are at least 18 years of age." },
                { title: "3. Shift Swap Coordination", body: "WMNY is a coordination tool only. It does not replace any MTA, TWU, or union collective bargaining agreements. All shift swaps must comply with your depot's official procedures and receive supervisor approval. WMNY makes no guarantee a swap will be approved by management." },
                { title: "4. User Conduct", body: "You agree not to post false or fraudulent swap listings, harass or threaten other users, share others' personal information without consent, use the App for commercial gain, attempt unauthorized access, or post discriminatory content. Violations may result in immediate account suspension." },
                { title: "5. Reputation System", body: "Reviews must be honest and based on actual swap experiences. Manipulating ratings — including self-reviewing or fake reviews — is prohibited and may result in account termination." },
                { title: "6. Invite Codes", body: "You are responsible for who you invite. Do not share invite codes publicly or with non-MTA personnel. Misuse may result in suspension of your account and the invited account." },
                { title: "7. Disclaimer of Liability", body: "WMNY is provided as-is without warranties. We are not responsible for disputes, missed shifts, denied swaps, or disciplinary actions arising from use of this platform." },
                { title: "8. Changes to Terms", body: "We reserve the right to update these Terms at any time. Continued use after changes are posted constitutes acceptance of the revised terms." },
              ].map(({ title, body }) => (
                <div key={title} style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, color: C.gold, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>{title}</div>
                  <p style={{ margin: 0 }}>{body}</p>
                </div>
              ))}
            </div>

            {/* Checkbox */}
            <label style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={termsChecked}
                onChange={e => setTermsChecked(e.target.checked)}
                style={{ marginTop: 2, width: 18, height: 18, accentColor: C.gold, cursor: "pointer", flexShrink: 0 }}
              />
              <span style={{ fontSize: 13, color: "rgba(255,255,255,.75)", lineHeight: 1.5 }}>
                I have read and agree to the <strong style={{ color: C.white }}>Terms of Use</strong>
              </span>
            </label>

            <button
              onClick={async () => {
                if (!termsChecked || acceptingTerms) return;
                setAcceptingTerms(true);
                try {
                  await api.post("/auth/accept-terms", { version: CURRENT_TERMS_VERSION });
                } catch { /* non-fatal — proceed anyway */ }
                const dest = user?.depot?.code ? `/depot/${user.depot.code}` : user?.depotId ? "/depots" : "/setup-profile";
                window.location.href = dest;
              }}
              disabled={!termsChecked || acceptingTerms}
              style={{ width: "100%", padding: 16, borderRadius: 14, border: "none", cursor: termsChecked ? "pointer" : "not-allowed", background: termsChecked ? `linear-gradient(135deg,${C.gold},${C.gold}cc)` : "rgba(255,255,255,.08)", fontSize: 16, fontWeight: 800, color: termsChecked ? C.bg : C.m, transition: "all .2s" }}
            >
              {acceptingTerms ? "Saving..." : "I Agree"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
