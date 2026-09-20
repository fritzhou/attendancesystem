// /js/teacher-students.js — "My Students": roster across every section this teacher teaches

import { supabase } from './supabaseClient.js';

let allStudents = [];

export async function initTeacherStudentsPage(profile) {
  const { data: teacherRow } = await supabase.from('teachers').select('id').eq('profile_id', profile.id).single();
  if (!teacherRow) {
    document.getElementById('studentsBody').innerHTML = `<tr><td colspan="4" class="empty-state">No teacher record found for this account.</td></tr>`;
    return;
  }

  const { data: assignments } = await supabase
    .from('class_assignments')
    .select('section_id, school_year_id')
    .eq('teacher_id', teacherRow.id);

  const sectionYearPairs = Array.from(new Map(
    (assignments || []).map(a => [`${a.section_id}|${a.school_year_id}`, a])
  ).values());

  if (sectionYearPairs.length === 0) {
    document.getElementById('studentsBody').innerHTML = `<tr><td colspan="4" class="empty-state">You have no assigned sections yet.</td></tr>`;
    return;
  }

  const results = await Promise.all(sectionYearPairs.map(p =>
    supabase.from('enrollments')
      .select('students(id, student_number, full_name, registration_status), sections(grade_level, section_name, strands(code))')
      .eq('section_id', p.section_id)
      .eq('school_year_id', p.school_year_id)
      .eq('enrollment_status', 'ACTIVE')
  ));

  const seen = new Set();
  allStudents = [];
  results.forEach(({ data }) => {
    (data || []).forEach(row => {
      if (!row.students || seen.has(row.students.id)) return;
      seen.add(row.students.id);
      allStudents.push({ ...row.students, section: row.sections });
    });
  });

  allStudents.sort((a, b) => a.full_name.localeCompare(b.full_name));
  render();
  document.getElementById('searchInput').addEventListener('input', render);
}

function render() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const filtered = allStudents.filter(s => !search || `${s.full_name} ${s.student_number}`.toLowerCase().includes(search));

  const tbody = document.getElementById('studentsBody');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No students match your search.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => `
    <tr>
      <td>${escapeHtml(s.full_name)}</td>
      <td>${escapeHtml(s.student_number)}</td>
      <td>Grade ${s.section.grade_level} – ${escapeHtml(s.section.strands.code)} / ${escapeHtml(s.section.section_name)}</td>
      <td><a class="btn btn-secondary btn-sm" href="/admin/student-report.html?id=${s.id}">Report</a></td>
    </tr>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
