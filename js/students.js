// /js/students.js — Students list: search, filter, add manually, links to QR card / bulk print / report

import { supabase } from './supabaseClient.js';

let allStudents = [];
let sectionOptions = []; // { id, schoolYearId, label }

export async function initStudentsPage() {
  await Promise.all([loadStudents(), loadSectionOptions()]);
  render();

  document.getElementById('searchInput').addEventListener('input', render);
  document.getElementById('filterStatus').addEventListener('change', render);
  document.getElementById('filterSection').addEventListener('change', render);
  document.getElementById('printSectionBtn').addEventListener('click', goToSectionPrint);
  document.getElementById('addStudentForm').addEventListener('submit', handleAddStudent);
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
    .select('id, grade_level, section_name, school_year_id, strands(code), school_years(name)')
    .order('grade_level');

  sectionOptions = (data || []).map(s => ({
    id: s.id,
    schoolYearId: s.school_year_id,
    label: `Grade ${s.grade_level} – ${s.strands.code}/${s.section_name} (${s.school_years.name})`
  }));

  const filterOptions = sectionOptions.map(s => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('');
  document.getElementById('filterSection').innerHTML = `<option value="">All Sections</option>${filterOptions}`;
  document.getElementById('printSectionSelect').innerHTML = `<option value="">Choose a section...</option>${filterOptions}`;

  document.getElementById('addStudentSection').innerHTML = sectionOptions.length
    ? sectionOptions.map(s => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')
    : `<option value="">Add a section first (under Sections)</option>`;
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

async function handleAddStudent(e) {
  e.preventDefault();
  const errorBox = document.getElementById('addStudentError');
  errorBox.style.display = 'none';

  const student_number = document.getElementById('addStudentNumber').value.trim();
  const full_name = document.getElementById('addStudentName').value.trim();
  const section_id = document.getElementById('addStudentSection').value;

  if (!student_number || !full_name || !section_id) {
    showAddError('Please fill in every field.');
    return;
  }

  const section = sectionOptions.find(s => s.id === section_id);
  if (!section) { showAddError('Please choose a valid section.'); return; }

  const btn = document.getElementById('addStudentBtn');
  btn.disabled = true;
  btn.textContent = 'Adding...';

  const { data: student, error: studentError } = await supabase
    .from('students')
    .insert({ student_number, full_name, registration_status: 'UNREGISTERED' })
    .select('id')
    .single();

  if (studentError) {
    btn.disabled = false;
    btn.textContent = 'Add Student';
    showAddError(studentError.message.includes('duplicate')
      ? 'A student with this student number already exists.'
      : 'Could not save. Please try again.');
    return;
  }

  const { error: enrollError } = await supabase.from('enrollments').insert({
    student_id: student.id, section_id: section.id, school_year_id: section.schoolYearId
  });

  btn.disabled = false;
  btn.textContent = 'Add Student';

  if (enrollError) {
    showAddError('Student was created, but could not be enrolled in that section. Check Sections and try enrolling manually.');
  } else {
    document.getElementById('addStudentForm').reset();
  }

  await loadStudents();
  render();
}

function goToSectionPrint() {
  const sectionId = document.getElementById('printSectionSelect').value;
  if (!sectionId) { alert('Choose a section first.'); return; }
  window.location.href = `/admin/qr-print-section.html?section=${sectionId}`;
}

function showAddError(msg) {
  const errorBox = document.getElementById('addStudentError');
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
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
