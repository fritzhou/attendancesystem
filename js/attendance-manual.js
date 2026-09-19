// /js/attendance-manual.js

import { supabase } from './supabaseClient.js';

let sessionId = null;
let sectionId = null;
let schoolYearId = null;
let roster = [];

export async function initManualAttendancePage() {
  sessionId = new URLSearchParams(window.location.search).get('session');
  if (!sessionId) {
    document.getElementById('pageSub').textContent = 'No attendance session specified.';
    return;
  }

  const ok = await loadSessionInfo();
  if (!ok) return;

  await loadRoster();
  document.getElementById('searchInput').addEventListener('input', renderRoster);
}

async function loadSessionInfo() {
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select(`
      status,
      class_assignments (
        section_id, school_year_id,
        subjects(subject_code, subject_name),
        sections(grade_level, section_name, strands(code))
      )
    `)
    .eq('id', sessionId)
    .single();

  if (error || !data) { document.getElementById('pageSub').textContent = 'Session not found.'; return false; }
  if (data.status !== 'OPEN') { document.getElementById('pageSub').textContent = 'This attendance session is closed.'; return false; }

  const ca = data.class_assignments;
  sectionId = ca.section_id;
  schoolYearId = ca.school_year_id;
  document.getElementById('pageTitle').textContent =
    `Manual Attendance — ${ca.subjects.subject_code} Grade ${ca.sections.grade_level} ${ca.sections.strands.code}/${ca.sections.section_name}`;
  document.getElementById('pageSub').textContent = 'Set attendance directly for students without a working QR.';
  return true;
}

async function loadRoster() {
  const list = document.getElementById('rosterList');
  list.innerHTML = `<div class="empty-state">Loading...</div>`;

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('students(id, full_name, student_number)')
    .eq('section_id', sectionId)
    .eq('school_year_id', schoolYearId)
    .eq('enrollment_status', 'ACTIVE');

  const { data: records } = await supabase
    .from('attendance_records')
    .select('student_id, status')
    .eq('attendance_session_id', sessionId);

  const statusByStudent = new Map((records || []).map(r => [r.student_id, r.status]));

  roster = (enrollments || [])
    .map(e => e.students)
    .filter(Boolean)
    .map(s => ({ ...s, status: statusByStudent.get(s.id) || null }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  renderRoster();
}

function renderRoster() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const filtered = roster.filter(s => !search || `${s.full_name} ${s.student_number}`.toLowerCase().includes(search));

  const list = document.getElementById('rosterList');
  if (filtered.length === 0) { list.innerHTML = `<div class="empty-state">No students match your search.</div>`; return; }

  list.innerHTML = filtered.map(s => `
    <div class="manual-row">
      <div class="manual-row-info">
        <div class="manual-row-name">${escapeHtml(s.full_name)}</div>
        <div class="manual-row-number">${escapeHtml(s.student_number)}${s.status ? ` · Currently ${s.status}` : ' · Not recorded'}</div>
      </div>
      <div class="manual-row-actions">
        <button class="manual-btn ${s.status === 'PRESENT' ? 'active-present' : ''}" data-set="${s.id}|PRESENT">Present</button>
        <button class="manual-btn ${s.status === 'LATE' ? 'active-late' : ''}" data-set="${s.id}|LATE">Late</button>
        <button class="manual-btn ${s.status === 'ABSENT' ? 'active-absent' : ''}" data-set="${s.id}|ABSENT">Absent</button>
        <button class="manual-btn ${s.status === 'EXCUSED' ? 'active-excused' : ''}" data-set="${s.id}|EXCUSED">Excused</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-set]').forEach(btn => {
    const [studentId, status] = btn.dataset.set.split('|');
    btn.addEventListener('click', () => setStatus(studentId, status));
  });
}

async function setStatus(studentId, status) {
  const { data, error } = await supabase.rpc('set_manual_attendance', {
    p_session_id: sessionId, p_student_id: studentId, p_status: status
  });

  if (error || !data.success) { alert(data?.message || 'Could not update attendance.'); return; }

  const student = roster.find(s => s.id === studentId);
  if (student) student.status = status;
  renderRoster();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
