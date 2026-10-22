# Screenshot capture guide

The assessment produced its machine evidence as **scan reports** in `evidence/`.
This guide covers the **screenshots** — the part that needs a human at a screen.

Captions are written out ready to paste under each figure in the submitted
document. Save files with the exact names given so figure numbering stays stable.

Before you start: **sign out of any real staff account.** Use a test account or
the login screen itself wherever a screenshot shows application UI. No figure in
the submitted report should contain a real survivor's name, case, or message.

---

## Priority 1 — the four that carry the most weight

### Figure 1 — Deployed RLS status (evidences F-01)

Supabase Dashboard → **SQL Editor** → run and screenshot query *and* results together:

```sql
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p') AND n.nspname = 'public' ORDER BY c.relname;
```

Save as `evidence/fig-01-rls-status.png`

> **Figure 1.** Read-only `pg_class` query executed against the deployed Supabase
> database, returning `rls_enabled = true` for all 35 tables in the `public`
> schema. This confirms that Row Level Security is active in production and not
> only declared in the repository migration files.

---

### Figure 2 — Deployed RLS policies (evidences F-01, F-17)

Supabase Dashboard → **Authentication → Policies** → expand `case_reports`.
Screenshot the policy list showing all four policies and their commands.

Save as `evidence/fig-02-rls-policies.png`

> **Figure 2.** Row Level Security policies deployed on the `case_reports` table.
> Separate policies govern survivor self-access, jurisdiction-scoped administrative
> access, and assignment-gated law-enforcement access. No `DELETE` policy exists,
> meaning no client role can delete a case record.

---

### Figure 3 — Clickjacking proof of concept (evidences F-09)

Open `poc/clickjacking-test.html` in a browser. Wait for the frame to load.
Screenshot the **whole browser window** so the local `file://` URL bar and the
framed SafeSpace dashboard appear in the same image.

Save as `evidence/fig-03-clickjacking-poc.png`

> **Figure 3.** The SafeSpace administrative dashboard rendered inside an iframe
> hosted by an unrelated local origin. Because neither `X-Frame-Options` nor a
> Content-Security-Policy `frame-ancestors` directive is returned, no framing
> restriction applies. An attacker-controlled page can embed the authenticated
> dashboard and overlay decoy controls (UI redress / clickjacking).

**This figure doubles as the retest.** After deploying the `vercel.json` headers,
reload and capture the now-blank frame as `evidence/fig-03b-clickjacking-fixed.png`:

> **Figure 3b.** The same proof of concept after deploying `X-Frame-Options: DENY`
> and `frame-ancestors 'none'`. The browser refuses to render the dashboard in the
> frame, confirming F-09 is resolved.

---

### Figure 4 — Missing security headers (evidences F-09)

Browser → live dashboard → **DevTools → Network** → reload → click the document
request → **Headers → Response Headers**. Screenshot so `Strict-Transport-Security`
is visible and the absence of the others is apparent.

Save as `evidence/fig-04-response-headers.png`

> **Figure 4.** HTTP response headers returned by the production administrative
> dashboard. `Strict-Transport-Security` is present with a two-year max-age.
> `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`,
> `Referrer-Policy`, and `Permissions-Policy` are all absent.

---

## Priority 2 — supporting figures

### Figure 5 — TLS certificate (evidences F-12)

Click the browser padlock → Connection is secure → Certificate is valid.
Screenshot the certificate viewer showing issuer, validity dates, and TLS version.

Save as `evidence/fig-05-tls-certificate.png`

> **Figure 5.** TLS certificate for the production deployment, issued by Google
> Trust Services and valid through 27 November 2026. The connection negotiates
> TLS 1.3. The certificate is Vercel's shared `*.vercel.app` wildcard, so renewal
> is provider-managed.

---

### Figure 6 — Evidence capture run (evidences methodology, §2.2)

Terminal → run `bash capture-evidence.sh` → screenshot the full run.

Save as `evidence/fig-06-evidence-capture.png`

> **Figure 6.** Execution of the evidence capture script, which re-runs every
> non-destructive live test and writes timestamped output to `evidence/`. All
> captures are read-only; no records are created, modified, or deleted.

---

### Figure 7 — Dependency audit (evidences F-07, F-08)

Terminal → `cd admin && npm audit` → screenshot the summary line and a few
advisories. Repeat in `mobile/` if you want both.

Save as `evidence/fig-07-npm-audit.png`

> **Figure 7.** `npm audit` output for the administrative dashboard. Eight raw
> alerts deduplicate to five distinct advisories; running with `--omit=dev`
> returns zero High-severity findings in the production dependency tree, since
> both High advisories exist only in the build toolchain.

---

## Priority 3 — resolves currently-undetermined findings

### Figure 8 — Google Maps API key restrictions (**resolves F-14**)

Google Cloud Console → **APIs & Services → Credentials** → open the Maps key →
screenshot **Application restrictions** and **API restrictions**.

> **Redact the key string itself before saving.**

Save as `evidence/fig-08-maps-key-restrictions.png`

> **Figure 8.** Application and API restriction configuration for the Google Maps
> key embedded in the Android manifest. [State what the screenshot actually shows:
> either an Android restriction bound to the package name and signing certificate,
> or no restriction configured.]

This figure moves F-14 from *Potential — undetermined* to a confirmed pass or a
confirmed finding. It is the single highest-value screenshot remaining.

---

### Figure 9 — MobSF report (**closes three APK limitations**)

Upload the APK to a MobSF instance. Screenshot the summary, the permissions
table, and the manifest analysis section.

Save as `evidence/fig-09-mobsf-summary.png`, `fig-09b-mobsf-permissions.png`

> **Figure 9.** MobSF static analysis of the SafeSpace Android build. The
> permissions table confirms twenty declared permissions against the four
> configured in `app.config.ts`, including `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`,
> and `DUMP`.

This closes the three limitations in §5.3 that string extraction could not reach:
the `allowBackup` boolean, `targetSdkVersion`, and the exported-component list.

---

### Figure 10 — Maps functional check (supports F-14)

Open the mobile app → Shelter Locator. Screenshot whether the map renders or
fails. Billing is disabled on the Cloud project, so it may be broken.

Save as `evidence/fig-10-maps-functional.png`

---

## Checklist

| # | Figure | Evidences | Done |
|---|---|---|---|
| 1 | RLS status query | F-01 | ☐ |
| 2 | RLS policies | F-01, F-17 | ☐ |
| 3 | Clickjacking PoC | F-09 | ☐ |
| 3b | Clickjacking after fix | F-09 retest | ☐ |
| 4 | Response headers | F-09 | ☐ |
| 5 | TLS certificate | F-12 | ☐ |
| 6 | Evidence capture run | Methodology | ☐ |
| 7 | npm audit | F-07, F-08 | ☐ |
| 8 | Maps key restrictions | F-14 | ☐ |
| 9 | MobSF report | F-13, F-15, F-16 | ☐ |
| 10 | Maps functional check | F-14 | ☐ |

Send me Figures 8 and 9 when you have them — both change findings in the report,
and I will update it and republish to the same URL.
