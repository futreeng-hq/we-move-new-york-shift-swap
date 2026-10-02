# Breach Response Procedure

**Owner:** wemovenewyork.net@gmail.com
**Scope:** WMNY Shift Swap (wmnyshiftswap.com) and its sub-processors
**Legal basis:** New York General Business Law § 899-aa (SHIELD Act)

This is the written procedure WMNY follows when a security incident may have exposed user data. It satisfies the "reasonable safeguards" requirement of the SHIELD Act and defines who does what, in what order, on what clock.

Keep this file in `docs/` so it is in version control. Review it quarterly and after every incident, even near-misses.

---

## Definitions

**Private information** (SHIELD): a user's name OR email OR account identifier combined with any of — password (hashed is still in scope under SHIELD), biometric data, financial account, government ID, or any data element that could enable identity theft or account takeover.

**Breach**: unauthorized access to, acquisition of, or disclosure of private information. Includes vendor compromises that touch our data.

**Security event**: anything that looks like a breach until proven otherwise. Treat as a breach until Step 3 clears it.

---

## Detection sources

| Source | What it catches |
|---|---|
| Sentry alerts | Unexpected server errors, auth anomalies, rate-limit bursts |
| Vercel runtime logs | Request-level anomalies, 5xx spikes |
| Neon dashboard | Query spikes, unknown IP connections |
| Upstash dashboard | Rate-limit cache spikes |
| User report | Email to abuse@wmnyshiftswap.com or in-app report |
| Vendor notice | Email from Vercel, Neon, Resend, Sentry, Upstash, or Google |
| News / public disclosure | Reported CVE in a dependency we use |

Any of these triggers the procedure below.

---

## Response steps

### Step 1 — Acknowledge (within 1 hour of detection)

- Open an incident log: `docs/incidents/YYYY-MM-DD-short-name.md`
- Record: timestamp detected, detection source, who is responding, what is known
- Nothing is "nothing" until Step 3 confirms it

### Step 2 — Contain (within 4 hours)

Pick whichever apply, in order:

1. If credentials are compromised: rotate `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_RESET_SECRET`, and database password. Rotations invalidate all sessions — users will have to sign in again. That is the correct outcome.
2. If a specific account is compromised: suspend it in the admin panel.
3. If the attack is in-flight (brute force, scraper): raise rate limits in `lib/rateLimit.ts` and redeploy, or add a Vercel firewall rule.
4. If a vendor is compromised: follow their incident instructions and rotate every secret they held.
5. If the attack is a code-level vulnerability: enable `MAINTENANCE_MODE=true` to route all traffic to `/maintenance` while you patch. Deploy, verify, then flip back.

Do not delete logs or evidence during containment. You will need them in Step 4.

### Step 3 — Classify (within 24 hours)

Answer three questions in the incident log:

1. **Was private information actually exposed, or just at risk?**
   Risk alone is not a breach; actual exposure or unauthorized access is.
2. **Which users are affected and how many?**
   Query the database for the affected rows. Count NY residents separately — SHIELD obligations trigger on NY residents, not total users.
3. **What categories of information were involved?**
   Name, email, hashed password, depot assignment, swap listings, messages, reputation data, IP (hashed), push subscription endpoint. List specifically.

If the answer to Question 1 is "no" with documented evidence, close the incident and skip to Step 7. If "yes" or "unclear," continue to Step 4.

### Step 4 — Notify users (SHIELD requires "most expedient time possible and without unreasonable delay")

Notification method, in order of preference:

1. Email via Resend to each affected user's registered address
2. In-app banner for signed-in users
3. If email is the attack vector itself, use the in-app banner only

Notification content must include:

- What happened (plain language, no PR voice)
- The date or date range of the incident
- The categories of information involved
- What WMNY has done in response
- What the user should do (change password, watch for phishing, etc.)
- A contact method: wemovenewyork.net@gmail.com
- Phone numbers for the three major Consumer Reporting Agencies and the FTC

Template language is in `docs/incidents/_breach-notice-template.md`. Create it from the first incident you handle; do not pre-write it (regulators distrust canned notices).

### Step 5 — Notify authorities (if ≥500 NY residents affected)

Within the same window as user notification:

- **NY Attorney General**: ag.ny.gov → Bureau of Internet and Technology → data-breach notification form
- **NY Department of State**: dos.ny.gov → Division of Consumer Protection
- **NY State Police**: NY State Police cyber-crime unit

If ≥5,000 NY residents are affected, additionally notify the three major Consumer Reporting Agencies (Equifax, Experian, TransUnion) with the timing and distribution of the notice.

If law enforcement asks WMNY to delay user notification because it would impede an active investigation, document their request in writing and delay only as long as they say to. The SHIELD Act permits this.

### Step 6 — Document (within 7 days of containment)

The incident log must now include:

- Full timeline from detection to containment
- Root cause (not just the symptom — the underlying flaw)
- Evidence preserved (log excerpts, screenshots, hashes)
- Who was notified, when, by what method
- Copies of notices sent to users and authorities

Retain the log for at least 3 years. SHIELD does not set a specific retention period, but the AG can request these records up to 3 years after the fact.

### Step 7 — Learn (within 14 days)

A written post-incident review covering:

- What we did well
- What we did poorly
- Concrete changes to the code, dependencies, procedures, or this runbook
- Which changes are shipped vs. in-flight

Add the shipped changes to the incident log. Open PRs for the in-flight ones with a tracking issue.

---

## Vendor incident contacts

Keep these ready — do not look them up at 2am during an incident:

| Vendor | Status page | Security contact |
|---|---|---|
| Vercel | vercel-status.com | security@vercel.com |
| Neon | status.neon.tech | security@neon.tech |
| Resend | resend-status.com | security@resend.com |
| Sentry | status.sentry.io | security@sentry.io |
| Upstash | status.upstash.com | support@upstash.com |
| Google (GA4) | status.cloud.google.com | via Google Cloud support |

---

## What this procedure does NOT cover

- Routine downtime (see RUNBOOK.md § Rollback)
- Non-security bugs (file an issue)
- Abuse reports between users (handled in-app by the moderation flow)
- Marketing-list breaches (we do not run marketing lists)

If an event is in the gray area, treat it as a security event and run the procedure. Over-responding to a false alarm costs an afternoon. Under-responding to a real breach costs the business.
