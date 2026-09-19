// /js/students.js — Students list: search, filter, links to QR card / bulk print / report

import { supabase } from './supabaseClient.js';

let allStudents = [];

export async function initStudentsPage() {
  await Promise.all([loadStudents(), loadSectionOptions()]);
  render();

  document.getElementById('searchInput').addEventListener('input', render);
  document.getElementById('filterStatus').addEventListener('change', render);
  document.getElementById('filterSection').addEventListener('change', render);
  document.getElementById('printSectionBtn').addEventListener('click', goToSectionPrint);
}

async function loadStudents() {
  const { data: students, error } = await supabase
    .from('students')
    .select('id, student_number, full_name, registration_status, qr_token')
    .order('full_name');

  if (error) { allStudents = []; return; }

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('student_id, sections(id, grade_level, section_name, strands(code))')
    .eq('enrollment_status', 'ACTIVE');

  const enrollmentByStudent = new Map((enrollments || []).map(e => [e.student_id, e.sections]));
  allStudents = students.map(s => ({ ...s, enrollment: enrollmentByStudent.get(s.id) || null }));
}

async function loadSectionOptions() {
  const { data } = await supabase
    .from('sections')
    .select('id, grade_level, section_name, strands(code)')
    .order('grade_level');

  const options = (data || []).map(s =>
    `<option value="${s.id}">Grade ${s.grade_level} – ${s.strands.code} / ${s.section_name}</option>`
  ).join('');

  document.getElementById('filterSection').innerHTML = `<option value="">All Sections</option>${options}`;
  document.getElementById('printSectionSelect').innerHTML = `<option value="">Choose a section...</option>${options}`;
}

function render() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const status = document.getElementById('filterStatus').value;
  const sectionId = document.getElementById('filterSection').value;

  const filtered = allStudents.filter(s => {
    if (search && !`${s.full_name} ${s.student_number}`.toLowerCase().includes(search)) return false;
    if (status && s.registration_status !== status) return false;
    if (sectionId && s.enrollment?.id !== sectionId) return false;
    return true;
  });

  const tbody = document.getElementById('studentsBody');

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No students match your filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => `
    <tr>
      <td>${escapeHtml(s.full_name)}</td>
      <td>${escapeHtml(s.student_number)}</td>
      <td>${s.enrollment
        ? `Grade ${s.enrollment.grade_level} – ${escapeHtml(s.enrollment.strands.code)} / ${escapeHtml(s.enrollment.section_name)}`
        : '<span class="text-muted">Not enrolled</span>'}</td>
      <td><span class="badge ${statusBadge(s.registration_status)}">${statusLabelFor(s.registration_status)}</span></td>
      <td>${s.qr_token ? '✅' : '—'}</td>
      <td>
        ${s.registration_status === 'ACTIVE' ? `<a class="btn btn-secondary btn-sm" href="/admin/qr-card.html?id=${s.id}">View QR</a>` : ''}
        <a class="btn btn-secondary btn-sm" href="/admin/student-report.html?id=${s.id}">Report</a>
      </td>
    </tr>
  `).join('');
}

function goToSectionPrint() {
  const sectionId = document.getElementById('printSectionSelect').value;
  if (!sectionId) { alert('Choose a section first.'); return; }
  window.location.href = `/admin/qr-print-section.html?section=${sectionId}`;
}

function statusBadge(status) {
  const map = { ACTIVE: 'badge-present', VERIFIED: 'badge-present', PENDING: 'badge-pending', REJECTED: 'badge-absent', UNREGISTERED: 'badge-excused', ARCHIVED: 'badge-excused' };
  return map[status] || 'badge-excused';
}
function statusLabelFor(status) {
  const map = { UNREGISTERED: 'Not Registered', PENDING: 'Pending', VERIFIED: 'Verified', REJECTED: 'Rejected', ACTIVE: 'Active', ARCHIVED: 'Archived' };
  return map[status] || status;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
