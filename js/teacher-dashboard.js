// /js/teacher-dashboard.js

import { supabase } from './supabaseClient.js';

export async function initTeacherDashboard(profile) {
  document.getElementById('welcomeMsg').textContent = `${greeting()}, ${profile.full_name.split(' ')[0]}.`;
  await Promise.all([
    loadTodaysClasses(profile),
    loadPendingCount(),
    loadRecentSessions(profile)
  ]);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 18) return 'Good Afternoon';
  return 'Good Evening';
}

async function loadTodaysClasses(profile) {
  const container = document.getElementById('todaysClasses');
  container.innerHTML = `<div class="empty-state">Loading...</div>`;

  const { data: teacherRow } = await supabase.from('teachers').select('id').eq('profile_id', profile.id).single();
  if (!teacherRow) {
    container.innerHTML = `<div class="empty-state">No teacher record found for this account.</div>`;
    return;
  }

  const today = new Date().getDay();

  const { data: assignments, error } = await supabase
    .from('class_assignments')
    .select(`
      id, subjects(subject_code, subject_name), sections(grade_level, section_name, strands(code)),
      class_schedules!inner(day_of_week, start_time)
    `)
    .eq('teacher_id', teacherRow.id)
    .eq('class_schedules.day_of_week', today)
    .order('start_time', { referencedTable: 'class_schedules' });

  if (error || !assignments || assignments.length === 0) {
    container.innerHTML = `<div class="empty-state">No classes scheduled today.</div>`;
    return;
  }

  const todayDateStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
  const { data: sessions } = await supabase
    .from('attendance_sessions')
    .select('id, class_assignment_id, status')
    .eq('attendance_date', todayDateStr)
    .in('class_assignment_id', assignments.map(a => a.id));

  const sessionByAssignment = new Map((sessions || []).map(s => [s.class_assignment_id, s]));

  container.innerHTML = assignments.map(a => {
    const slot = a.class_schedules[0];
    const session = sessionByAssignment.get(a.id);

    let actionHtml;
    if (session && session.status === 'OPEN') {
      actionHtml = `<a class="btn btn-primary btn-sm" href="/teacher/scanner.html?session=${session.id}">Continue Attendance</a>`;
    } else if (session && session.status === 'CLOSED') {
      actionHtml = `<span class="badge badge-present">Completed</span>`;
    } else {
      actionHtml = `<button class="btn btn-primary btn-sm" data-start="${a.id}">Start Attendance</button>`;
    }

    return `
      <div class="class-row">
        <div class="class-row-time">${formatTime(slot.start_time)}</div>
        <div class="class-row-info">
          <div class="class-row-subject">${escapeHtml(a.subjects.subject_code)} – ${escapeHtml(a.subjects.subject_name)}</div>
          <div class="class-row-section">Grade ${a.sections.grade_level} – ${escapeHtml(a.sections.strands.code)} / ${escapeHtml(a.sections.section_name)}</div>
        </div>
        <div class="class-row-action">${actionHtml}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-start]').forEach(btn =>
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

async function loadPendingCount() {
  const { count } = await supabase
    .from('student_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'PENDING');
  document.getElementById('pendingCount').textContent = count ?? 0;
}

async function loadRecentSessions(profile) {
  const { data: teacherRow } = await supabase.from('teachers').select('id').eq('profile_id', profile.id).single();
  if (!teacherRow) return;

  const { data } = await supabase
    .from('attendance_sessions')
    .select('id, attendance_date, class_assignments!inner(teacher_id, subjects(subject_code), sections(grade_level, section_name))')
    .eq('class_assignments.teacher_id', teacherRow.id)
    .eq('status', 'CLOSED')
    .order('attendance_date', { ascending: false })
    .limit(5);

  const container = document.getElementById('recentSessions');
  if (!data || data.length === 0) {
    container.innerHTML = `<div class="empty-state">No completed sessions yet.</div>`;
    return;
  }

  container.innerHTML = data.map(s => `
    <div class="slot-row">
      <span>${escapeHtml(s.class_assignments.subjects.subject_code)} – Grade ${s.class_assignments.sections.grade_level} ${escapeHtml(s.class_assignments.sections.section_name)}</span>
      <span class="text-muted">${s.attendance_date}</span>
    </div>
  `).join('');
}

function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
