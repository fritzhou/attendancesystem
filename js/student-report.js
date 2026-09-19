// /js/student-report.js

import { supabase } from './supabaseClient.js';

export async function initStudentReportPage() {
  const studentId = new URLSearchParams(window.location.search).get('id');
  if (!studentId) { document.getElementById('pageSub').textContent = 'No student specified.'; return; }

  const { data: student, error } = await supabase
    .from('students')
    .select('id, full_name, student_number, photo_url, registration_status')
    .eq('id', studentId)
    .single();

  if (error || !student) { document.getElementById('pageSub').textContent = 'Student not found.'; return; }

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('sections(grade_level, section_name, strands(code)), school_years(name, start_date)')
    .eq('student_id', studentId)
    .eq('enrollment_status', 'ACTIVE')
    .order('school_years(start_date)', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: records } = await supabase
    .from('attendance_records')
    .select('status, time_in, entry_method, attendance_sessions(attendance_date, class_assignments(subjects(subject_code, subject_name)))')
    .eq('student_id', studentId)
    .order('attendance_date', { foreignTable: 'attendance_sessions', ascending: false });

  document.getElementById('pageTitle').textContent = student.full_name;
  document.getElementById('pageSub').textContent =
    `${student.student_number} · ${enrollment ? `Grade ${enrollment.sections.grade_level} – ${enrollment.sections.strands.code}/${enrollment.sections.section_name} (${enrollment.school_years.name})` : 'Not currently enrolled'}`;

  if (student.photo_url) {
    const { data: signed } = await supabase.storage.from('student-photos').createSignedUrl(student.photo_url, 300);
    if (signed?.signedUrl) document.getElementById('studentPhoto').src = signed.signedUrl;
  }

  const rows = records || [];
  const counts = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 };
  rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const total = rows.length;
  const pct = total ? Math.round(((counts.PRESENT + counts.LATE + counts.EXCUSED) / total) * 100) : 0;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statPresent').textContent = counts.PRESENT;
  document.getElementById('statLate').textContent = counts.LATE;
  document.getElementById('statAbsent').textContent = counts.ABSENT;
  document.getElementById('statExcused').textContent = counts.EXCUSED;
  document.getElementById('statPct').textContent = `${pct}%`;

  const tbody = document.getElementById('historyBody');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No attendance history yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.attendance_sessions?.attendance_date ?? '—'}</td>
      <td>${escapeHtml(r.attendance_sessions?.class_assignments?.subjects?.subject_code ?? '—')}</td>
      <td><span class="badge ${badgeClass(r.status)}">${r.status}</span></td>
      <td>${r.time_in ? new Date(r.time_in).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</td>
    </tr>
  `).join('');
}

function badgeClass(status) {
  const map = { PRESENT: 'badge-present', LATE: 'badge-late', ABSENT: 'badge-absent', EXCUSED: 'badge-excused' };
  return map[status] || 'badge-excused';
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
