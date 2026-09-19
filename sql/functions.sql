-- ============================================================
--  SHS QR ATTENDANCE MONITORING SYSTEM
--  /sql/functions.sql
--  All application logic lives here as security-definer
--  functions, added incrementally across the build steps.
--  Run this file top to bottom on a fresh database, in order.
-- ============================================================


-- ============================================================
--  Phase 4: admin dashboard stats
-- ============================================================
create or replace function public.get_admin_dashboard_stats()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_year uuid;
  v_result json;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select id into v_active_year from public.school_years where is_active limit 1;

  select json_build_object(
    'total_students',        (select count(*) from public.students),
    'active_students',       (select count(*) from public.students where is_active),
    'total_teachers',        (select count(*) from public.teachers),
    'total_sections',        (select count(*) from public.sections where school_year_id = v_active_year),
    'total_subjects',        (select count(*) from public.subjects),
    'pending_registrations', (select count(*) from public.student_registrations where status = 'PENDING'),
    'today_present', (select count(*) from public.attendance_records ar
                       join public.attendance_sessions s on s.id = ar.attendance_session_id
                       where s.attendance_date = current_date and ar.status = 'PRESENT'),
    'today_late',    (select count(*) from public.attendance_records ar
                       join public.attendance_sessions s on s.id = ar.attendance_session_id
                       where s.attendance_date = current_date and ar.status = 'LATE'),
    'today_absent',  (select count(*) from public.attendance_records ar
                       join public.attendance_sessions s on s.id = ar.attendance_session_id
                       where s.attendance_date = current_date and ar.status = 'ABSENT'),
    'today_excused', (select count(*) from public.attendance_records ar
                       join public.attendance_sessions s on s.id = ar.attendance_session_id
                       where s.attendance_date = current_date and ar.status = 'EXCUSED'),
    'active_school_year', (select name from public.school_years where id = v_active_year)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_admin_dashboard_stats() from public;
grant execute on function public.get_admin_dashboard_stats() to authenticated;


-- ============================================================
--  Phase 5: school setup — atomic "set active school year"
-- ============================================================
create or replace function public.set_active_school_year(p_year_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.school_years set is_active = false where is_active = true;
  update public.school_years set is_active = true where id = p_year_id;
end;
$$;

revoke all on function public.set_active_school_year(uuid) from public;
grant execute on function public.set_active_school_year(uuid) to authenticated;


-- ============================================================
--  Phase 7: public self-registration lookup and submission
--  The ONLY way an anonymous visitor can touch students /
--  student_registrations — no direct table access is granted.
-- ============================================================
create or replace function public.lookup_student_for_registration(p_student_number text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student record;
  v_enrollment record;
begin
  select id, full_name, registration_status
  into v_student
  from public.students
  where student_number = trim(p_student_number) and is_active;

  if not found then
    return json_build_object('found', false);
  end if;

  select s.grade_level, s.section_name, st.code as strand_code, sy.name as school_year_name
  into v_enrollment
  from public.enrollments e
  join public.sections s on s.id = e.section_id
  join public.strands st on st.id = s.strand_id
  join public.school_years sy on sy.id = e.school_year_id
  where e.student_id = v_student.id and e.enrollment_status = 'ACTIVE'
  order by sy.start_date desc
  limit 1;

  return json_build_object(
    'found', true,
    'full_name', v_student.full_name,
    'registration_status', v_student.registration_status,
    'grade_level', v_enrollment.grade_level,
    'strand', v_enrollment.strand_code,
    'section', v_enrollment.section_name,
    'school_year', v_enrollment.school_year_name
  );
end;
$$;

revoke all on function public.lookup_student_for_registration(text) from public;
grant execute on function public.lookup_student_for_registration(text) to anon, authenticated;


create or replace function public.submit_student_registration(
  p_student_number text,
  p_photo_path text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student record;
begin
  select id, registration_status
  into v_student
  from public.students
  where student_number = trim(p_student_number) and is_active;

  if not found then
    return json_build_object('success', false, 'message', 'Student number not found.');
  end if;

  if v_student.registration_status not in ('UNREGISTERED', 'REJECTED') then
    return json_build_object(
      'success', false,
      'message', 'This student number already has a registration in progress or is already active.'
    );
  end if;

  if p_photo_path is null or (storage.foldername(p_photo_path))[1] is distinct from 'pending' then
    return json_build_object('success', false, 'message', 'Invalid photo upload.');
  end if;

  insert into public.student_registrations (student_id, submitted_photo_url, status)
  values (v_student.id, p_photo_path, 'PENDING');

  update public.students set registration_status = 'PENDING' where id = v_student.id;

  return json_build_object('success', true, 'message', 'Registration submitted successfully.');
end;
$$;

revoke all on function public.submit_student_registration(text, text) from public;
grant execute on function public.submit_student_registration(text, text) to anon, authenticated;


-- ============================================================
--  Phase 8: registration approval (generates QR token)
-- ============================================================
create or replace function public.approve_registration(p_registration_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg record;
  v_token text;
  v_attempts int := 0;
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;

  select * into v_reg from public.student_registrations where id = p_registration_id for update;

  if not found then
    return json_build_object('success', false, 'message', 'Registration not found.');
  end if;
  if v_reg.status <> 'PENDING' then
    return json_build_object('success', false, 'message', 'This registration has already been reviewed.');
  end if;

  loop
    v_token := 'STU_' || encode(gen_random_bytes(24), 'hex');
    begin
      update public.students
      set qr_token = v_token,
          registration_status = 'ACTIVE',
          photo_url = v_reg.submitted_photo_url
      where id = v_reg.student_id;
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts > 5 then
        raise exception 'Could not generate a unique QR token.';
      end if;
    end;
  end loop;

  update public.student_registrations
  set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_registration_id;

  insert into public.audit_logs (user_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'registration_approved', 'student', v_reg.student_id::text,
          jsonb_build_object('registration_id', p_registration_id));

  return json_build_object('success', true, 'qr_token', v_token);
end;
$$;

revoke all on function public.approve_registration(uuid) from public;
grant execute on function public.approve_registration(uuid) to authenticated;


create or replace function public.reject_registration(p_registration_id uuid, p_reason text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg record;
begin
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;

  select * into v_reg from public.student_registrations where id = p_registration_id for update;

  if not found then
    return json_build_object('success', false, 'message', 'Registration not found.');
  end if;
  if v_reg.status <> 'PENDING' then
    return json_build_object('success', false, 'message', 'This registration has already been reviewed.');
  end if;

  update public.student_registrations
  set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = p_reason
  where id = p_registration_id;

  update public.students set registration_status = 'REJECTED' where id = v_reg.student_id;

  insert into public.audit_logs (user_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'registration_rejected', 'student', v_reg.student_id::text,
          jsonb_build_object('registration_id', p_registration_id, 'reason', p_reason));

  return json_build_object('success', true);
end;
$$;

revoke all on function public.reject_registration(uuid, text) from public;
grant execute on function public.reject_registration(uuid, text) to authenticated;


-- ============================================================
--  Phase 9: QR token regenerate / revoke (admin only)
-- ============================================================
create or replace function public.regenerate_qr_token(p_student_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_attempts int := 0;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select registration_status into v_status from public.students where id = p_student_id;
  if not found then
    return json_build_object('success', false, 'message', 'Student not found.');
  end if;
  if v_status <> 'ACTIVE' then
    return json_build_object('success', false, 'message', 'Only active students can have a QR code.');
  end if;

  loop
    v_token := 'STU_' || encode(gen_random_bytes(24), 'hex');
    begin
      update public.students set qr_token = v_token where id = p_student_id;
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts > 5 then
        raise exception 'Could not generate a unique QR token — try again.';
      end if;
    end;
  end loop;

  insert into public.audit_logs (user_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'qr_regenerated', 'student', p_student_id::text, '{}'::jsonb);

  return json_build_object('success', true, 'qr_token', v_token);
end;
$$;

revoke all on function public.regenerate_qr_token(uuid) from public;
grant execute on function public.regenerate_qr_token(uuid) to authenticated;


create or replace function public.revoke_qr_token(p_student_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.students set qr_token = null where id = p_student_id;

  insert into public.audit_logs (user_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'qr_revoked', 'student', p_student_id::text, '{}'::jsonb);

  return json_build_object('success', true);
end;
$$;

revoke all on function public.revoke_qr_token(uuid) from public;
grant execute on function public.revoke_qr_token(uuid) to authenticated;


-- ============================================================
--  Phase 12: resolve the academic period for a class + date
-- ============================================================
create or replace function public.current_academic_period_id(
  p_class_assignment_id uuid,
  p_date date default current_date
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ap.id
  from public.academic_periods ap
  join public.class_assignments ca on ca.semester_id = ap.semester_id
  where ca.id = p_class_assignment_id
    and p_date between ap.start_date and ap.end_date
  order by ap.sort_order
  limit 1;
$$;

revoke all on function public.current_academic_period_id(uuid, date) from public;
grant execute on function public.current_academic_period_id(uuid, date) to authenticated;


-- ============================================================
--  Phase 13: start (or resume) an attendance session
-- ============================================================
create or replace function public.start_attendance_session(
  p_class_assignment_id uuid,
  p_late_minutes int default 10
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_session_id uuid;
begin
  if not public.owns_class_assignment(p_class_assignment_id) then
    return json_build_object('success', false, 'message', 'You do not have access to this class.');
  end if;

  v_period_id := public.current_academic_period_id(p_class_assignment_id, current_date);
  if v_period_id is null then
    return json_build_object('success', false, 'message', 'No academic period covers today''s date. Ask an admin to add one.');
  end if;

  select id into v_session_id
  from public.attendance_sessions
  where class_assignment_id = p_class_assignment_id
    and attendance_date = current_date
    and status = 'OPEN';

  if v_session_id is not null then
    return json_build_object('success', true, 'session_id', v_session_id, 'reused', true);
  end if;

  insert into public.attendance_sessions (
    class_assignment_id, academic_period_id, attendance_date, started_at, late_after, status, created_by
  ) values (
    p_class_assignment_id, v_period_id, current_date, now(),
    now() + (p_late_minutes || ' minutes')::interval, 'OPEN', auth.uid()
  )
  returning id into v_session_id;

  return json_build_object('success', true, 'session_id', v_session_id, 'reused', false);

exception when unique_violation then
  return json_build_object('success', false, 'message', 'A session for this class already exists for today.');
end;
$$;

revoke all on function public.start_attendance_session(uuid, int) from public;
grant execute on function public.start_attendance_session(uuid, int) to authenticated;


-- ============================================================
--  Phase 13: the core QR scan handler. Every validation the
--  spec calls for happens here, server-side, not in the browser.
-- ============================================================
create or replace function public.record_attendance_scan(p_session_id uuid, p_qr_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_student record;
  v_enrolled boolean;
  v_existing record;
  v_status text;
begin
  select s.status, s.late_after, ca.section_id, ca.school_year_id, ca.teacher_id
  into v_session
  from public.attendance_sessions s
  join public.class_assignments ca on ca.id = s.class_assignment_id
  where s.id = p_session_id
  for update of s;

  if not found then
    return json_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'message', 'Attendance session not found.');
  end if;

  if not (public.is_admin() or v_session.teacher_id = public.current_teacher_id()) then
    return json_build_object('success', false, 'code', 'NOT_AUTHORIZED', 'message', 'You do not have access to this session.');
  end if;

  if v_session.status <> 'OPEN' then
    return json_build_object('success', false, 'code', 'SESSION_CLOSED', 'message', 'This attendance session is closed.');
  end if;

  select id, student_number, full_name, photo_url, registration_status, is_active
  into v_student
  from public.students
  where qr_token = p_qr_token;

  if not found then
    return json_build_object('success', false, 'code', 'INVALID_QR', 'message', 'Invalid or unrecognized QR code.');
  end if;

  if not v_student.is_active or v_student.registration_status <> 'ACTIVE' then
    return json_build_object('success', false, 'code', 'INACTIVE_STUDENT', 'message', 'This student is not active.');
  end if;

  select exists (
    select 1 from public.enrollments
    where student_id = v_student.id
      and section_id = v_session.section_id
      and school_year_id = v_session.school_year_id
      and enrollment_status = 'ACTIVE'
  ) into v_enrolled;

  if not v_enrolled then
    return json_build_object(
      'success', false, 'code', 'NOT_ENROLLED',
      'message', 'This student does not belong to this class.',
      'student_name', v_student.full_name
    );
  end if;

  select status, time_in into v_existing
  from public.attendance_records
  where attendance_session_id = p_session_id and student_id = v_student.id;

  if found then
    return json_build_object(
      'success', false, 'code', 'ALREADY_RECORDED', 'message', 'Already recorded.',
      'student_name', v_student.full_name, 'student_number', v_student.student_number,
      'photo_url', v_student.photo_url, 'status', v_existing.status, 'time_in', v_existing.time_in
    );
  end if;

  v_status := case when now() <= v_session.late_after then 'PRESENT' else 'LATE' end;

  insert into public.attendance_records (attendance_session_id, student_id, status, time_in, entry_method, recorded_by)
  values (p_session_id, v_student.id, v_status, now(), 'QR', auth.uid());

  return json_build_object(
    'success', true, 'status', v_status,
    'student_name', v_student.full_name, 'student_number', v_student.student_number,
    'photo_url', v_student.photo_url, 'time_in', now()
  );
end;
$$;

revoke all on function public.record_attendance_scan(uuid, text) from public;
grant execute on function public.record_attendance_scan(uuid, text) to authenticated;


-- ============================================================
--  Phase 14: manual attendance (also doubles as correction)
-- ============================================================
create or replace function public.set_manual_attendance(
  p_session_id uuid,
  p_student_id uuid,
  p_status text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_enrolled boolean;
  v_old_status text;
begin
  if p_status not in ('PRESENT','LATE','ABSENT','EXCUSED') then
    return json_build_object('success', false, 'message', 'Invalid status.');
  end if;

  select s.status, ca.section_id, ca.school_year_id, ca.teacher_id
  into v_session
  from public.attendance_sessions s
  join public.class_assignments ca on ca.id = s.class_assignment_id
  where s.id = p_session_id
  for update of s;

  if not found then
    return json_build_object('success', false, 'message', 'Attendance session not found.');
  end if;
  if not (public.is_admin() or v_session.teacher_id = public.current_teacher_id()) then
    return json_build_object('success', false, 'message', 'You do not have access to this session.');
  end if;
  if v_session.status <> 'OPEN' then
    return json_build_object('success', false, 'message', 'This attendance session is closed.');
  end if;

  select exists (
    select 1 from public.enrollments
    where student_id = p_student_id
      and section_id = v_session.section_id
      and school_year_id = v_session.school_year_id
      and enrollment_status = 'ACTIVE'
  ) into v_enrolled;

  if not v_enrolled then
    return json_build_object('success', false, 'message', 'This student does not belong to this class.');
  end if;

  select status into v_old_status
  from public.attendance_records
  where attendance_session_id = p_session_id and student_id = p_student_id;

  insert into public.attendance_records (attendance_session_id, student_id, status, time_in, entry_method, recorded_by)
  values (p_session_id, p_student_id, p_status, now(), 'MANUAL', auth.uid())
  on conflict (attendance_session_id, student_id)
  do update set status = excluded.status, entry_method = 'MANUAL', recorded_by = auth.uid();

  insert into public.audit_logs (user_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'attendance_manual_set', 'attendance_record', p_student_id::text,
          jsonb_build_object('session_id', p_session_id, 'old_status', v_old_status, 'new_status', p_status));

  return json_build_object('success', true, 'status', p_status);
end;
$$;

revoke all on function public.set_manual_attendance(uuid, uuid, text) from public;
grant execute on function public.set_manual_attendance(uuid, uuid, text) to authenticated;


-- ============================================================
--  Phase 14: close a session — auto-marks unrecorded as ABSENT
-- ============================================================
create or replace function public.close_attendance_session(p_session_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_absent_count int;
  v_summary record;
begin
  select s.status, ca.section_id, ca.school_year_id, ca.teacher_id
  into v_session
  from public.attendance_sessions s
  join public.class_assignments ca on ca.id = s.class_assignment_id
  where s.id = p_session_id
  for update of s;

  if not found then
    return json_build_object('success', false, 'message', 'Attendance session not found.');
  end if;
  if not (public.is_admin() or v_session.teacher_id = public.current_teacher_id()) then
    return json_build_object('success', false, 'message', 'You do not have access to this session.');
  end if;
  if v_session.status <> 'OPEN' then
    return json_build_object('success', false, 'message', 'This session is already closed.');
  end if;

  insert into public.attendance_records (attendance_session_id, student_id, status, time_in, entry_method, recorded_by)
  select p_session_id, e.student_id, 'ABSENT', null, 'SYSTEM', auth.uid()
  from public.enrollments e
  where e.section_id = v_session.section_id
    and e.school_year_id = v_session.school_year_id
    and e.enrollment_status = 'ACTIVE'
    and not exists (
      select 1 from public.attendance_records ar
      where ar.attendance_session_id = p_session_id and ar.student_id = e.student_id
    );

  get diagnostics v_absent_count = row_count;

  update public.attendance_sessions set status = 'CLOSED', closed_at = now() where id = p_session_id;

  select
    count(*) filter (where status='PRESENT') as present,
    count(*) filter (where status='LATE') as late,
    count(*) filter (where status='ABSENT') as absent,
    count(*) filter (where status='EXCUSED') as excused
  into v_summary
  from public.attendance_records
  where attendance_session_id = p_session_id;

  insert into public.audit_logs (user_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'attendance_closed', 'attendance_session', p_session_id::text,
          jsonb_build_object('present', v_summary.present, 'late', v_summary.late,
                              'absent', v_summary.absent, 'excused', v_summary.excused,
                              'newly_marked_absent', v_absent_count));

  return json_build_object('success', true, 'present', v_summary.present, 'late', v_summary.late,
                            'absent', v_summary.absent, 'excused', v_summary.excused);
end;
$$;

revoke all on function public.close_attendance_session(uuid) from public;
grant execute on function public.close_attendance_session(uuid) to authenticated;


-- ============================================================
--  Phase 17: school-wide analytics, computed in one round trip
-- ============================================================
create or replace function public.get_school_analytics(p_school_year_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_overall json;
  v_monthly json;
  v_by_section json;
  v_by_subject json;
  v_top_absent json;
  v_top_late json;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select json_build_object(
    'present', count(*) filter (where ar.status = 'PRESENT'),
    'late', count(*) filter (where ar.status = 'LATE'),
    'absent', count(*) filter (where ar.status = 'ABSENT'),
    'excused', count(*) filter (where ar.status = 'EXCUSED'),
    'total', count(*)
  )
  into v_overall
  from public.attendance_records ar
  join public.attendance_sessions s on s.id = ar.attendance_session_id
  join public.class_assignments ca on ca.id = s.class_assignment_id
  where ca.school_year_id = p_school_year_id;

  select coalesce(json_agg(row_to_json(t) order by t.month), '[]'::json) into v_monthly
  from (
    select to_char(date_trunc('month', s.attendance_date), 'YYYY-MM') as month,
      count(*) filter (where ar.status = 'PRESENT') as present,
      count(*) filter (where ar.status = 'LATE') as late,
      count(*) filter (where ar.status = 'ABSENT') as absent,
      count(*) filter (where ar.status = 'EXCUSED') as excused
    from public.attendance_records ar
    join public.attendance_sessions s on s.id = ar.attendance_session_id
    join public.class_assignments ca on ca.id = s.class_assignment_id
    where ca.school_year_id = p_school_year_id
    group by 1
  ) t;

  select coalesce(json_agg(row_to_json(t) order by t.section_label), '[]'::json) into v_by_section
  from (
    select (sec.grade_level || ' - ' || st.code || '/' || sec.section_name) as section_label,
      count(*) filter (where ar.status in ('PRESENT','LATE','EXCUSED')) as attended,
      count(*) as total
    from public.attendance_records ar
    join public.attendance_sessions s on s.id = ar.attendance_session_id
    join public.class_assignments ca on ca.id = s.class_assignment_id
    join public.sections sec on sec.id = ca.section_id
    join public.strands st on st.id = sec.strand_id
    where ca.school_year_id = p_school_year_id
    group by 1
  ) t;

  select coalesce(json_agg(row_to_json(t) order by t.subject_label), '[]'::json) into v_by_subject
  from (
    select sub.subject_code as subject_label,
      count(*) filter (where ar.status in ('PRESENT','LATE','EXCUSED')) as attended,
      count(*) as total
    from public.attendance_records ar
    join public.attendance_sessions s on s.id = ar.attendance_session_id
    join public.class_assignments ca on ca.id = s.class_assignment_id
    join public.subjects sub on sub.id = ca.subject_id
    where ca.school_year_id = p_school_year_id
    group by 1
  ) t;

  select coalesce(json_agg(row_to_json(t)), '[]'::json) into v_top_absent
  from (
    select stu.full_name, stu.student_number, count(*) as absent_count
    from public.attendance_records ar
    join public.attendance_sessions s on s.id = ar.attendance_session_id
    join public.class_assignments ca on ca.id = s.class_assignment_id
    join public.students stu on stu.id = ar.student_id
    where ca.school_year_id = p_school_year_id and ar.status = 'ABSENT'
    group by stu.id, stu.full_name, stu.student_number
    order by count(*) desc
    limit 10
  ) t;

  select coalesce(json_agg(row_to_json(t)), '[]'::json) into v_top_late
  from (
    select stu.full_name, stu.student_number, count(*) as late_count
    from public.attendance_records ar
    join public.attendance_sessions s on s.id = ar.attendance_session_id
    join public.class_assignments ca on ca.id = s.class_assignment_id
    join public.students stu on stu.id = ar.student_id
    where ca.school_year_id = p_school_year_id and ar.status = 'LATE'
    group by stu.id, stu.full_name, stu.student_number
    order by count(*) desc
    limit 10
  ) t;

  return json_build_object(
    'overall', v_overall, 'monthly', v_monthly,
    'by_section', v_by_section, 'by_subject', v_by_subject,
    'top_absent', v_top_absent, 'top_late', v_top_late
  );
end;
$$;

revoke all on function public.get_school_analytics(uuid) from public;
grant execute on function public.get_school_analytics(uuid) to authenticated;
