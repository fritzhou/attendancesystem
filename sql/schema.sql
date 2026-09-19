-- ============================================================
--  SHS QR ATTENDANCE MONITORING SYSTEM
--  /sql/schema.sql  —  Phase 1: database schema
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 0. RESET (drops the previous design — all of these are empty
--    except profiles; auth.users is NOT affected)
-- ------------------------------------------------------------
drop table if exists public.attendance_records    cascade;
drop table if exists public.attendance_sessions   cascade;
drop table if exists public.excuse_requests       cascade;
drop table if exists public.class_enrollments     cascade;
drop table if exists public.class_schedules       cascade;
drop table if exists public.classes               cascade;
drop table if exists public.class_assignments     cascade;
drop table if exists public.enrollments           cascade;
drop table if exists public.student_registrations cascade;
drop table if exists public.subjects              cascade;
drop table if exists public.sections              cascade;
drop table if exists public.strands               cascade;
drop table if exists public.students              cascade;
drop table if exists public.teachers              cascade;
drop table if exists public.academic_periods      cascade;
drop table if exists public.semesters             cascade;
drop table if exists public.school_years          cascade;
drop table if exists public.audit_logs            cascade;
drop table if exists public.profiles              cascade;

drop type if exists public.user_role           cascade;
drop type if exists public.registration_status cascade;
drop type if exists public.submission_status   cascade;
drop type if exists public.enrollment_status   cascade;
drop type if exists public.attendance_status   cascade;
drop type if exists public.entry_method        cascade;
drop type if exists public.session_status      cascade;

-- ------------------------------------------------------------
-- 1. ENUM TYPES
-- ------------------------------------------------------------
create type public.user_role as enum ('admin', 'teacher');

create type public.registration_status as enum (
  'UNREGISTERED', 'PENDING', 'VERIFIED', 'REJECTED', 'ACTIVE', 'ARCHIVED'
);

create type public.submission_status as enum ('PENDING', 'APPROVED', 'REJECTED');

create type public.enrollment_status as enum ('ACTIVE', 'TRANSFERRED', 'DROPPED', 'COMPLETED');

create type public.attendance_status as enum ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'FLAGGED');

create type public.entry_method as enum ('QR', 'MANUAL', 'SYSTEM');

create type public.session_status as enum ('OPEN', 'CLOSED');

-- ------------------------------------------------------------
-- 2. SHARED TRIGGER FUNCTION
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3. PROFILES  (admin + teacher accounts only)
-- ------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  email      text not null unique,
  role       public.user_role not null default 'teacher',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

create index idx_profiles_role on public.profiles (role) where is_active;

-- ------------------------------------------------------------
-- 4. TEACHERS
-- ------------------------------------------------------------
create table public.teachers (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null unique references public.profiles(id) on delete cascade,
  employee_number text unique,
  full_name       text not null,
  created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. ACADEMIC CALENDAR
-- ------------------------------------------------------------
create table public.school_years (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  start_date date not null,
  end_date   date not null,
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  constraint chk_sy_dates check (end_date > start_date)
);

create unique index idx_one_active_school_year
  on public.school_years ((is_active)) where is_active;

create table public.semesters (
  id             uuid primary key default gen_random_uuid(),
  school_year_id uuid not null references public.school_years(id) on delete cascade,
  name           text not null,
  start_date     date not null,
  end_date       date not null,
  is_active      boolean not null default false,
  created_at     timestamptz not null default now(),
  constraint uq_semester_per_year unique (school_year_id, name),
  constraint chk_sem_dates check (end_date > start_date)
);

create index idx_semesters_year on public.semesters (school_year_id);

create table public.academic_periods (
  id          uuid primary key default gen_random_uuid(),
  semester_id uuid not null references public.semesters(id) on delete cascade,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  sort_order  smallint not null default 1,
  created_at  timestamptz not null default now(),
  constraint uq_period_per_semester unique (semester_id, name),
  constraint chk_period_dates check (end_date >= start_date)
);

create index idx_periods_semester on public.academic_periods (semester_id);
create index idx_periods_dates    on public.academic_periods (start_date, end_date);

-- ------------------------------------------------------------
-- 6. STRANDS AND SECTIONS
-- ------------------------------------------------------------
create table public.strands (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  code       text not null unique,
  created_at timestamptz not null default now()
);

create table public.sections (
  id             uuid primary key default gen_random_uuid(),
  school_year_id uuid not null references public.school_years(id) on delete cascade,
  grade_level    smallint not null,
  strand_id      uuid not null references public.strands(id) on delete restrict,
  section_name   text not null,
  created_at     timestamptz not null default now(),
  constraint chk_grade_level check (grade_level between 7 and 12),
  constraint uq_section unique (school_year_id, grade_level, strand_id, section_name)
);

create index idx_sections_year on public.sections (school_year_id);

-- ------------------------------------------------------------
-- 7. STUDENTS  (permanent identity — NO grade/section here)
-- ------------------------------------------------------------
create table public.students (
  id                  uuid primary key default gen_random_uuid(),
  student_number      text not null unique,
  full_name           text not null,
  photo_url           text,
  qr_token            text unique,
  registration_status public.registration_status not null default 'UNREGISTERED',
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_students_updated
  before update on public.students
  for each row execute function public.set_updated_at();

create index idx_students_number on public.students (student_number);
create index idx_students_qr     on public.students (qr_token) where qr_token is not null;
create index idx_students_status on public.students (registration_status);

-- ------------------------------------------------------------
-- 8. ENROLLMENTS  (yearly academic placement)
-- ------------------------------------------------------------
create table public.enrollments (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.students(id) on delete cascade,
  section_id        uuid not null references public.sections(id) on delete restrict,
  school_year_id    uuid not null references public.school_years(id) on delete restrict,
  enrollment_status public.enrollment_status not null default 'ACTIVE',
  created_at        timestamptz not null default now(),
  constraint uq_enrollment_per_year unique (student_id, school_year_id)
);

create index idx_enrollments_section on public.enrollments (section_id);
create index idx_enrollments_student on public.enrollments (student_id);

-- ------------------------------------------------------------
-- 9. SUBJECTS, CLASS ASSIGNMENTS, SCHEDULES
-- ------------------------------------------------------------
create table public.subjects (
  id           uuid primary key default gen_random_uuid(),
  subject_code text not null unique,
  subject_name text not null,
  created_at   timestamptz not null default now()
);

create table public.class_assignments (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references public.teachers(id)     on delete restrict,
  subject_id     uuid not null references public.subjects(id)     on delete restrict,
  section_id     uuid not null references public.sections(id)     on delete restrict,
  school_year_id uuid not null references public.school_years(id) on delete restrict,
  semester_id    uuid not null references public.semesters(id)    on delete restrict,
  created_at     timestamptz not null default now(),
  constraint uq_class_assignment unique (subject_id, section_id, semester_id)
);

create index idx_ca_teacher on public.class_assignments (teacher_id);
create index idx_ca_section on public.class_assignments (section_id);

create table public.class_schedules (
  id                  uuid primary key default gen_random_uuid(),
  class_assignment_id uuid not null references public.class_assignments(id) on delete cascade,
  day_of_week         smallint not null,
  start_time          time not null,
  end_time            time not null,
  constraint chk_day check (day_of_week between 0 and 6),
  constraint chk_sched_time check (end_time > start_time),
  constraint uq_schedule_slot unique (class_assignment_id, day_of_week, start_time)
);

create index idx_schedules_day on public.class_schedules (day_of_week);

-- ------------------------------------------------------------
-- 10. STUDENT REGISTRATIONS  (photo submissions for review)
-- ------------------------------------------------------------
create table public.student_registrations (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references public.students(id) on delete cascade,
  submitted_photo_url text not null,
  status              public.submission_status not null default 'PENDING',
  submitted_at        timestamptz not null default now(),
  reviewed_by         uuid references public.profiles(id) on delete set null,
  reviewed_at         timestamptz,
  rejection_reason    text
);

create unique index idx_one_pending_registration
  on public.student_registrations (student_id) where status = 'PENDING';

create index idx_registrations_status on public.student_registrations (status, submitted_at);

-- ------------------------------------------------------------
-- 11. ATTENDANCE SESSIONS
-- ------------------------------------------------------------
create table public.attendance_sessions (
  id                  uuid primary key default gen_random_uuid(),
  class_assignment_id uuid not null references public.class_assignments(id) on delete cascade,
  academic_period_id  uuid not null references public.academic_periods(id)  on delete restrict,
  attendance_date     date not null default current_date,
  started_at          timestamptz not null default now(),
  late_after          timestamptz not null,
  closed_at           timestamptz,
  status              public.session_status not null default 'OPEN',
  created_by          uuid references public.profiles(id) on delete set null,
  constraint uq_session_per_class_day unique (class_assignment_id, attendance_date)
);

create unique index idx_one_open_session
  on public.attendance_sessions (class_assignment_id) where status = 'OPEN';

create index idx_sessions_date   on public.attendance_sessions (attendance_date);
create index idx_sessions_period on public.attendance_sessions (academic_period_id);

-- ------------------------------------------------------------
-- 12. ATTENDANCE RECORDS
-- ------------------------------------------------------------
create table public.attendance_records (
  id                    uuid primary key default gen_random_uuid(),
  attendance_session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id            uuid not null references public.students(id) on delete restrict,
  status                public.attendance_status not null,
  time_in               timestamptz,
  entry_method          public.entry_method not null default 'QR',
  recorded_by           uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uq_attendance_once unique (attendance_session_id, student_id)
);

create trigger trg_attendance_updated
  before update on public.attendance_records
  for each row execute function public.set_updated_at();

create index idx_attendance_session on public.attendance_records (attendance_session_id);
create index idx_attendance_student on public.attendance_records (student_id);
create index idx_attendance_status  on public.attendance_records (status);

-- ------------------------------------------------------------
-- 13. AUDIT LOGS
-- ------------------------------------------------------------
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index idx_audit_created on public.audit_logs (created_at desc);
create index idx_audit_target  on public.audit_logs (target_type, target_id);

-- ------------------------------------------------------------
-- 14. ENABLE RLS ON EVERYTHING
--     No policies yet — that is /sql/rls.sql in the next step.
-- ------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.teachers              enable row level security;
alter table public.school_years          enable row level security;
alter table public.semesters             enable row level security;
alter table public.academic_periods      enable row level security;
alter table public.strands               enable row level security;
alter table public.sections              enable row level security;
alter table public.students              enable row level security;
alter table public.enrollments           enable row level security;
alter table public.subjects              enable row level security;
alter table public.class_assignments     enable row level security;
alter table public.class_schedules       enable row level security;
alter table public.student_registrations enable row level security;
alter table public.attendance_sessions   enable row level security;
alter table public.attendance_records    enable row level security;
alter table public.audit_logs            enable row level security;
