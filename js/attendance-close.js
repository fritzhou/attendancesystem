// /js/attendance-close.js

import { supabase } from './supabaseClient.js';

let sessionId = null;

export async function initCloseAttendancePage() {
  sessionId = new URLSearchParams(window.location.search).get('session');
  if (!sessionId) { document.getElementById('pageSub').textContent = 'No attendance session specified.'; return; }

  await loadPreview();
  document.getElementById('confirmBtn').addEventListener('click', handleClose);
  document.getElementById('backBtn').addEventListener('click', () => {
    window.location.href = `/teacher/scanner.html?session=${sessionId}`;
  });
}

async function loadPreview() {
  const { data: session, error } = await supabase
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

  if (error || !session) {
    document.getElementById('pageSub').textContent = 'Session not found.';
    document.getElementById('previewCard').style.display = 'none';
    return;
  }
  if (session.status !== 'OPEN') {
    document.getElementById('pageSub').textContent = 'This session is already closed.';
    document.getElementById('confirmBtn').style.display = 'none';
    return;
  }

  const ca = session.class_assignments;
  document.getElementById('pageTitle').textContent =
    `Close Attendance — ${ca.subjects.subject_code} Grade ${ca.sections.grade_level} ${ca.sections.strands.code}/${ca.sections.section_name}`;

  const [{ count: totalEnrolled }, { data: records }] = await Promise.all([
    supabase.from('enrollments').select('id', { count: 'exact', head: true })
      .eq('section_id', ca.section_id).eq('school_year_id', ca.school_year_id).eq('enrollment_status', 'ACTIVE'),
    supabase.from('attendance_records').select('status').eq('attendance_session_id', sessionId)
  ]);

  const counts = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 };
  (records || []).forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const unrecorded = Math.max((totalEnrolled || 0) - (records || []).length, 0);

  document.getElementById('previewStats').innerHTML = `
    <div class="stat-card"><div class="stat-card-label">Total Enrolled</div><div class="stat-card-value">${totalEnrolled || 0}</div></div>
    <div class="stat-card accent-green"><div class="stat-card-label">Present</div><div class="stat-card-value">${counts.PRESENT}</div></div>
    <div class="stat-card accent-amber"><div class="stat-card-label">Late</div><div class="stat-card-value">${counts.LATE}</div></div>
    <div class="stat-card"><div class="stat-card-label">Excused</div><div class="stat-card-value">${counts.EXCUSED}</div></div>
    <div class="stat-card accent-red"><div class="stat-card-label">Will Be Marked Absent</div><div class="stat-card-value">${unrecorded}</div></div>
  `;
}

async function handleClose() {
  if (!confirm('Close this attendance session? Unrecorded students will be automatically marked Absent.')) return;

  const btn = document.getElementById('confirmBtn');
  btn.disabled = true;
  btn.textContent = 'Closing...';

  const { data, error } = await supabase.rpc('close_attendance_session', { p_session_id: sessionId });

  if (error || !data.success) {
    alert(data?.message || 'Could not close attendance.');
    btn.disabled = false;
    btn.textContent = 'Confirm Close Attendance';
    return;
  }

  document.getElementById('previewCard').innerHTML = `
    <h2>Attendance Closed</h2>
    <div class="stat-grid" style="margin-top:14px;">
      <div class="stat-card accent-green"><div class="stat-card-label">Present</div><div class="stat-card-value">${data.present}</div></div>
      <div class="stat-card accent-amber"><div class="stat-card-label">Late</div><div class="stat-card-value">${data.late}</div></div>
      <div class="stat-card accent-red"><div class="stat-card-label">Absent</div><div class="stat-card-value">${data.absent}</div></div>
      <div class="stat-card"><div class="stat-card-label">Excused</div><div class="stat-card-value">${data.excused}</div></div>
    </div>
    <div class="form-actions">
      <a class="btn btn-primary" href="/teacher/dashboard.html">Back to Dashboard</a>
    </div>
  `;
  document.getElementById('confirmBtn').style.display = 'none';
  document.getElementById('backBtn').style.display = 'none';
}
