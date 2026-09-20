// /js/teacher-attendance.js — "Take Attendance": every class, with Start/Continue for each

import { supabase } from './supabaseClient.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function initTeacherAttendancePage(profile) {
  const list = document.getElementById('attendanceList');
  const { data: teacherRow } = await supabase.from('teachers').select('id').eq('profile_id', profile.id).single();
  if (!teacherRow) {
    list.innerHTML = `<div class="empty-state">No teacher record found for this account.</div>`;
    return;
  }

  const { data: assignments, error } = await supabase
    .from('class_assignments')
    .select(`
      id,
      subjects(subject_code, subject_name),
      sections(grade_level, section_name, strands(code)),
      class_schedules(day_of_week, start_time)
    `)
    .eq('teacher_id', teacherRow.id)
    .order('id');

  if (error || !assignments || assignments.length === 0) {
    list.innerHTML = `<div class="empty-state">You have no class assignments yet.</div>`;
    return;
  }

  const today = new Date().getDay();
  const todayDateStr = new Date().toLocaleDateString('en-CA');

  const { data: sessions } = await supabase
    .from('attendance_sessions')
    .select('id, class_assignment_id, status')
    .eq('attendance_date', todayDateStr)
    .in('class_assignment_id', assignments.map(a => a.id));

  const sessionByAssignment = new Map((sessions || []).map(s => [s.class_assignment_id, s]));

  list.innerHTML = assignments.map(a => {
    const scheduledToday = (a.class_schedules || []).some(s => s.day_of_week === today);
    const session = sessionByAssignment.get(a.id);

    let actionHtml;
    if (session && session.status === 'OPEN') {
      actionHtml = `<a class="btn btn-primary btn-sm" href="/teacher/scanner.html?session=${session.id}">Continue Attendance</a>`;
    } else if (session && session.status === 'CLOSED') {
      actionHtml = `<span class="badge badge-present">Completed Today</span>`;
    } else {
      actionHtml = `<button class="btn btn-primary btn-sm" data-start="${a.id}">Start Attendance</button>`;
    }

    return `
      <div class="class-row">
        <div class="class-row-info">
          <div class="class-row-subject">${escapeHtml(a.subjects.subject_code)} – ${escapeHtml(a.subjects.subject_name)}</div>
          <div class="class-row-section">Grade ${a.sections.grade_level} – ${escapeHtml(a.sections.strands.code)} / ${escapeHtml(a.sections.section_name)}${scheduledToday ? ' · Scheduled today' : ''}</div>
        </div>
        <div class="class-row-action">${actionHtml}</div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-start]').forEach(btn =>
    btn.addEventListener('click', () => startAttendance(btn.dataset.start)));
}

async function startAttendance(classAssignmentId) {
  const { data, error } = await supabase.rpc('start_attendance_session', { p_class_assignment_id: classAssignmentId });
  if (error || !data.success) {
    alert(data?.message || 'Could not start attendance.');
    return;
  }
  window.location.href = `/teacher/scanner.html?session=${data.session_id}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
