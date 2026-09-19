-- ============================================================
--  SHS QR ATTENDANCE MONITORING SYSTEM
--  /sql/rls.sql  —  Phase 2: role helpers + RLS policies
-- ============================================================

-- ------------------------------------------------------------
-- 1. ROLE HELPER FUNCTIONS
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher' and is_active
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

create or replace function public.current_teacher_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.teachers where profile_id = auth.uid();
$$;

create or replace function public.owns_class_assignment(p_class_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.class_assignments
    where id = p_class_assignment_id
      and teacher_id = public.current_teacher_id()
  );
$$;

-- ------------------------------------------------------------
-- 2. GUARD: a profile can't promote/demote or deactivate itself
-- ------------------------------------------------------------
create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and not public.is_admin() then
    if new.role is distinct from old.role
       or new.is_active is distinct from old.is_active then
      raise exception 'You cannot change your own role or active status.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_profiles_no_self_promote
  before update on public.profiles
  for each row execute function public.prevent_self_role_change();

-- ------------------------------------------------------------
-- 3. PROFILES
-- ------------------------------------------------------------
create policy "profiles_select" on public.profiles
  for select using (public.is_staff() or id = auth.uid());
create policy "profiles_insert_admin" on public.profiles
  for insert with check (public.is_admin());
create policy "profiles_update" on public.profiles
  for update using (public.is_admin() or id = auth.uid());
create policy "profiles_delete_admin" on public.profiles
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 4. TEACHERS
-- ------------------------------------------------------------
create policy "teachers_select_staff" on public.teachers
  for select using (public.is_staff());
create policy "teachers_write_admin" on public.teachers
  for insert with check (public.is_admin());
create policy "teachers_update_admin" on public.teachers
  for update using (public.is_admin());
create policy "teachers_delete_admin" on public.teachers
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 5. ACADEMIC CALENDAR (school_years, semesters, academic_periods)
-- ------------------------------------------------------------
create policy "school_years_select_staff" on public.school_years
  for select using (public.is_staff());
create policy "school_years_write_admin" on public.school_years
  for insert with check (public.is_admin());
create policy "school_years_update_admin" on public.school_years
  for update using (public.is_admin());
create policy "school_years_delete_admin" on public.school_years
  for delete using (public.is_admin());

create policy "semesters_select_staff" on public.semesters
  for select using (public.is_staff());
create policy "semesters_write_admin" on public.semesters
  for insert with check (public.is_admin());
create policy "semesters_update_admin" on public.semesters
  for update using (public.is_admin());
create policy "semesters_delete_admin" on public.semesters
  for delete using (public.is_admin());

create policy "periods_select_staff" on public.academic_periods
  for select using (public.is_staff());
create policy "periods_write_admin" on public.academic_periods
  for insert with check (public.is_admin());
create policy "periods_update_admin" on public.academic_periods
  for update using (public.is_admin());
create policy "periods_delete_admin" on public.academic_periods
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 6. STRANDS AND SECTIONS
-- ------------------------------------------------------------
create policy "strands_select_staff" on public.strands
  for select using (public.is_staff());
create policy "strands_write_admin" on public.strands
  for insert with check (public.is_admin());
create policy "strands_update_admin" on public.strands
  for update using (public.is_admin());
create policy "strands_delete_admin" on public.strands
  for delete using (public.is_admin());

create policy "sections_select_staff" on public.sections
  for select using (public.is_staff());
create policy "sections_write_admin" on public.sections
  for insert with check (public.is_admin());
create policy "sections_update_admin" on public.sections
  for update using (public.is_admin());
create policy "sections_delete_admin" on public.sections
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 7. STUDENTS
-- ------------------------------------------------------------
create policy "students_select_staff" on public.students
  for select using (public.is_staff());
create policy "students_insert_admin" on public.students
  for insert with check (public.is_admin());
create policy "students_update_staff" on public.students
  for update using (public.is_staff());
create policy "students_delete_admin" on public.students
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 8. ENROLLMENTS
-- ------------------------------------------------------------
create policy "enrollments_select_staff" on public.enrollments
  for select using (public.is_staff());
create policy "enrollments_write_admin" on public.enrollments
  for insert with check (public.is_admin());
create policy "enrollments_update_admin" on public.enrollments
  for update using (public.is_admin());
create policy "enrollments_delete_admin" on public.enrollments
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 9. SUBJECTS, CLASS ASSIGNMENTS, SCHEDULES
-- ------------------------------------------------------------
create policy "subjects_select_staff" on public.subjects
  for select using (public.is_staff());
create policy "subjects_write_admin" on public.subjects
  for insert with check (public.is_admin());
create policy "subjects_update_admin" on public.subjects
  for update using (public.is_admin());
create policy "subjects_delete_admin" on public.subjects
  for delete using (public.is_admin());

create policy "class_assignments_select_staff" on public.class_assignments
  for select using (public.is_staff());
create policy "class_assignments_write_admin" on public.class_assignments
  for insert with check (public.is_admin());
create policy "class_assignments_update_admin" on public.class_assignments
  for update using (public.is_admin());
create policy "class_assignments_delete_admin" on public.class_assignments
  for delete using (public.is_admin());

create policy "class_schedules_select_staff" on public.class_schedules
  for select using (public.is_staff());
create policy "class_schedules_write_admin" on public.class_schedules
  for insert with check (public.is_admin());
create policy "class_schedules_update_admin" on public.class_schedules
  for update using (public.is_admin());
create policy "class_schedules_delete_admin" on public.class_schedules
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 10. STUDENT REGISTRATIONS
-- ------------------------------------------------------------
create policy "registrations_select_staff" on public.student_registrations
  for select using (public.is_staff());
create policy "registrations_update_staff" on public.student_registrations
  for update using (public.is_staff());
create policy "registrations_delete_admin" on public.student_registrations
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 11. ATTENDANCE SESSIONS
-- ------------------------------------------------------------
create policy "sessions_select_staff" on public.attendance_sessions
  for select using (public.is_staff());
create policy "sessions_insert_owner" on public.attendance_sessions
  for insert with check (public.owns_class_assignment(class_assignment_id));
create policy "sessions_update_owner" on public.attendance_sessions
  for update using (public.owns_class_assignment(class_assignment_id));
create policy "sessions_delete_admin" on public.attendance_sessions
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 12. ATTENDANCE RECORDS
-- ------------------------------------------------------------
create policy "records_select_staff" on public.attendance_records
  for select using (public.is_staff());
create policy "records_insert_owner" on public.attendance_records
  for insert with check (
    public.owns_class_assignment(
      (select class_assignment_id from public.attendance_sessions
       where id = attendance_session_id)
    )
  );
create policy "records_update_owner" on public.attendance_records
  for update using (
    public.owns_class_assignment(
      (select class_assignment_id from public.attendance_sessions
       where id = attendance_session_id)
    )
  );
create policy "records_delete_admin" on public.attendance_records
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 13. AUDIT LOGS (append-only — no update or delete policy)
-- ------------------------------------------------------------
create policy "audit_select_admin" on public.audit_logs
  for select using (public.is_admin());
create policy "audit_insert_staff" on public.audit_logs
  for insert with check (public.is_staff() and user_id = auth.uid());
