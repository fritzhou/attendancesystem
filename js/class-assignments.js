// /js/class-assignments.js

import { supabase } from './supabaseClient.js';

let semesterOptions = [];
let sectionOptions = [];

export async function initClassAssignmentsPage() {
  await loadDropdownData();
  await loadAssignments();
  document.getElementById('addForm').addEventListener('submit', handleAdd);
  document.getElementById('fieldSemester').addEventListener('change', renderSectionOptions);
}

async function loadDropdownData() {
  const [{ data: semesters }, { data: sections }, { data: subjects }, { data: teachers }] = await Promise.all([
    supabase.from('semesters').select('id, name, school_year_id, school_years(name)').order('start_date', { ascending: false }),
    supabase.from('sections').select('id, grade_level, section_name, school_year_id, strands(code)').order('grade_level'),
    supabase.from('subjects').select('id, subject_code, subject_name').order('subject_code'),
    supabase.from('profiles').select('id, full_name, teachers(id)').eq('role', 'teacher').eq('is_active', true).order('full_name')
  ]);

  semesterOptions = (semesters || []).map(s => ({
    id: s.id, school_year_id: s.school_year_id,
    label: `${s.school_years?.name ?? ''} – ${s.name}`
  }));
  sectionOptions = (sections || []).map(s => ({
    id: s.id, school_year_id: s.school_year_id,
    label: `Grade ${s.grade_level} – ${s.strands.code} / ${s.section_name}`
  }));

  document.getElementById('fieldSemester').innerHTML = semesterOptions.length
    ? semesterOptions.map(s => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')
    : `<option value="">Add a semester first</option>`;

  document.getElementById('fieldSubject').innerHTML = (subjects && subjects.length)
    ? subjects.map(s => `<option value="${s.id}">${escapeHtml(s.subject_code)} – ${escapeHtml(s.subject_name)}</option>`).join('')
    : `<option value="">Add a subject first</option>`;

  document.getElementById('fieldTeacher').innerHTML = (teachers && teachers.length)
    ? teachers.filter(t => t.teachers).map(t => `<option value="${t.teachers.id}">${escapeHtml(t.full_name)}</option>`).join('')
    : `<option value="">Add a teacher first</option>`;

  renderSectionOptions();
}

function renderSectionOptions() {
  const semesterId = document.getElementById('fieldSemester').value;
  const semester = semesterOptions.find(s => s.id === semesterId);
  const select = document.getElementById('fieldSection');

  const matching = semester ? sectionOptions.filter(s => s.school_year_id === semester.school_year_id) : [];

  select.innerHTML = matching.length
    ? matching.map(s => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')
    : `<option value="">No sections in this semester's school year</option>`;
}

async function loadAssignments() {
  const tbody = document.getElementById('assignmentsBody');
  tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from('class_assignments')
    .select(`
      id,
      subjects(subject_code, subject_name),
      sections(grade_level, section_name, strands(code)),
      semesters(name, school_years(name)),
      teachers(profiles(full_name))
    `)
    .order('id');

  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Could not load class assignments.</td></tr>`; return; }
  if (data.length === 0) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No class assignments yet. Add one above.</td></tr>`; return; }

  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${escapeHtml(row.subjects.subject_code)} – ${escapeHtml(row.subjects.subject_name)}</td>
      <td>Grade ${row.sections.grade_level} – ${escapeHtml(row.sections.strands.code)} / ${escapeHtml(row.sections.section_name)}</td>
      <td>${escapeHtml(row.teachers.profiles.full_name)}</td>
      <td>${escapeHtml(row.semesters.school_years.name)} – ${escapeHtml(row.semesters.name)}</td>
      <td>
        <a class="btn btn-secondary btn-sm" href="/admin/class-schedules.html?id=${row.id}">Schedule</a>
        <button class="btn btn-danger btn-sm" data-delete="${row.id}">Delete</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteAssignment(btn.dataset.delete)));
}

async function handleAdd(e) {
  e.preventDefault();
  const errorBox = document.getElementById('formError');
  errorBox.style.display = 'none';

  const semester_id = document.getElementById('fieldSemester').value;
  const section_id = document.getElementById('fieldSection').value;
  const subject_id = document.getElementById('fieldSubject').value;
  const teacher_id = document.getElementById('fieldTeacher').value;

  if (!semester_id || !section_id || !subject_id || !teacher_id) {
    showError('Please fill in every field.');
    return;
  }

  const semester = semesterOptions.find(s => s.id === semester_id);

  const { error } = await supabase.from('class_assignments').insert({
    teacher_id, subject_id, section_id,
    semester_id, school_year_id: semester.school_year_id
  });

  if (error) {
    showError(error.message.includes('duplicate')
      ? 'This subject is already assigned to this section for this semester.'
      : 'Could not save. Please try again.');
    return;
  }

  await loadAssignments();
}

async function deleteAssignment(id) {
  if (!confirm('Delete this class assignment? Only possible if no attendance sessions use it yet.')) return;
  const { error } = await supabase.from('class_assignments').delete().eq('id', id);
  if (error) { alert('Could not delete — it is likely still in use by attendance sessions.'); return; }
  await loadAssignments();
}

function showError(msg) {
  const errorBox = document.getElementById('formError');
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
