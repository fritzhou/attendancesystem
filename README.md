# Pilgrim Attend

QR Code Attendance Monitoring System for Pilgrim Christian College (Cagayan de Oro).
Vanilla HTML/CSS/JavaScript (ES modules) + Supabase (Postgres, Auth, Storage, Edge Functions).
No build step — every file can be served as-is from any static host or opened via a local dev server.

This project was built step-by-step across an extended chat session. This README is the map of
what exists, what it depends on, and what's intentionally not built yet.

---

## 1. Project layout

```
/login.html                    Staff login (admin + teacher)
/register.html                 Public student self-registration (3-step flow)
/registration-status.html      Public "check my registration status" page

/admin/                        Admin-only pages (15 pages)
/teacher/                      Teacher-only pages (6 pages)
/css/                          Stylesheets, shared across admin/teacher pages
/js/                           ES modules, one file per feature area
/sql/                          Run these in the Supabase SQL Editor, IN ORDER (see below)
/supabase/functions/           Source of the two deployed Edge Functions (reference copies —
                                these are already live on the Supabase project; redeploy only
                                if you need to change their logic)
```

## 2. First-time setup

Run the SQL files in the Supabase SQL Editor **in this exact order** — later files depend on
tables/functions created by earlier ones:

1. `sql/schema.sql` — all tables, enums, indexes, constraints. **Destructive**: drops any
   previous version of these tables first (see the comment block at the top of the file).
2. `sql/rls.sql` — role-check helper functions + every Row Level Security policy.
3. `sql/storage.sql` — creates the private `student-photos` bucket and its access policies.
4. `sql/functions.sql` — every application-logic function (dashboard stats, registration
   approval, QR generation, the attendance scanner, manual attendance, closing sessions,
   analytics). This is one big cumulative file — run the whole thing top to bottom.
5. `sql/rate-limiting.sql` — the `rate_limit_events` table used by the public-registration
   rate limiter.

### Bootstrap your first admin account
There's a chicken-and-egg problem: creating an admin normally requires an existing admin.
One-time manual fix:
1. Supabase Dashboard → **Authentication → Users → Add user** — create yourself a login, copy
   the User UID.
2. SQL Editor:
   ```sql
   insert into public.profiles (id, full_name, email, role, is_active)
   values ('<paste the User UID>', 'Your Name', 'your@email.com', 'admin', true);
   ```
Every teacher account after this is created through the app (**Admin → Teachers**), which uses
the `create-teacher` Edge Function — no more manual SQL needed.

### Edge Functions
Two functions are already deployed to the live Supabase project (project ref
`tldurxdnswzzrkvfyzlr`) and need no further setup:
- **`create-teacher`** — lets an admin create a new teacher login without ending their own
  session. Uses the service-role key server-side; never exposed to the browser.
- **`public-registration`** — proxies the public student-registration lookup/submit calls
  through an IP-based rate limiter (20 lookups/15 min, 5 submissions/hour) before hitting the
  database functions.

The `/supabase/functions/` folder in this zip is a **reference copy** of their source. If you
move this project to a different Supabase project, redeploy both via the Supabase CLI
(`supabase functions deploy create-teacher` / `public-registration`) or the dashboard — they
rely only on the auto-provided `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
env vars, so no manual secrets configuration is needed.

### Config
`js/config.js` holds the Supabase project URL, the public/anon key, and the school name. These
are safe to be public (the anon key has no power beyond what RLS grants). Update these three
values if you ever point this project at a different Supabase project.

## 3. How the pieces fit together

**Roles.** Two roles: `admin` and `teacher`, stored in `profiles.role`. Students never get a
login at all — they interact only through the public pages, authenticated implicitly by knowing
their own student number.

**The core flow:** Admin imports roster (CSV/XLSX) → student self-registers with a photo at
`/register.html` → admin/teacher approves at Pending Registrations (generates a QR token) →
teacher scans that QR in class → Present/Late is recorded automatically → teacher closes the
session (unscanned students become Absent automatically) → reports and analytics read from the
resulting `attendance_records`.

**Security model.** Nearly every sensitive write (approve/reject registration, generate/revoke
QR, record a scan, set manual attendance, close a session) goes through a `security definer` SQL
function in `functions.sql` that re-checks the caller's role/ownership itself, rather than
relying on RLS alone. RLS policies (`rls.sql`) are the second layer, locking every table down by
default. The two Edge Functions are a third layer for the two truly public-facing actions
(teacher creation, student registration).

**No React, no build tooling.** Every JS file is loaded as a native ES module
(`<script type="module">`), importing libraries (Supabase JS, Chart.js, PapaParse, SheetJS,
QRCode.js, html5-qrcode) straight from a CDN. This was a deliberate choice to work from a
phone-based IDE with no npm/bundler available.

## 4. Known, intentional gaps

These were flagged during the build as deliberate scope decisions, not bugs:

- **No "reopen a closed session" feature.** Once closed, a session stays closed.
- **Audit log targets show as `type + short id`**, not a resolved human name (e.g. a student's
  name). Would need a per-action-type join to fix properly.
- **No automatic PDF page numbers** — reports print via the browser's native print-to-PDF,
  which doesn't support page numbering from CSS/JS alone.
- **`/teacher/classes.html`, `/teacher/attendance.html`, `/teacher/students.html`** are linked
  in the sidebar but were never built — starting attendance is done from the teacher dashboard's
  "Today's Classes" list instead, which covers the same core workflow.
- **Attendance % formula** is `(Present + Late + Excused) ÷ Total Sessions` everywhere in the
  app (reports, analytics, student report) — a deliberate, explicit choice that Excused doesn't
  count against a student. Documented in-app in the report footer.

## 5. A note on file order vs. the original spec

The original build spec listed 16 phases in a specific order. A few extra small steps had to be
inserted between them because later phases turned out to depend on tables/pages the spec's order
hadn't built yet (school years/strands/sections before roster import; a teacher-creation
mechanism and semesters/subjects before class assignments; academic periods before the scanner,
since `attendance_sessions.academic_period_id` is `NOT NULL`). Each insertion was called out at
the time it came up. The system is functionally complete end-to-end regardless of this
reordering.
