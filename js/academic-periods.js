// /js/academic-periods.js

import { supabase } from './supabaseClient.js';

let semesterOptions = [];

export async function initAcademicPeriodsPage() {
  await loadSemesterOptions();
  await loadPeriods();
  document.getElementById('addForm').addEventListener('submit', handleAdd);
}

async function loadSemesterOptions() {
  const { data } = await supabase
    .from('semesters')
    .select('id, name, school_years(name)')
    .order('start_date', { ascending: false });

  semesterOptions = data || [];
  const select = document.getElementById('fieldSemester');
  select.innerHTML = semesterOptions.length
    ? semesterOptions.map(s => `<option value="${s.id}">${escapeHtml(s.school_years?.name ?? '')} – ${escapeHtml(s.name)}</option>`).join('')
    : `<option value="">Add a semester first</option>`;
}

async function loadPeriods() {
  const tbody = document.getElementById('periodsBody');
  tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from('academic_periods')
    .select('id, name, start_date, end_date, sort_order, semesters(name, school_years(name))')
    .order('start_date');

  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Could not load academic periods.</td></tr>`; return; }
  if (data.length === 0) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No academic periods yet. Add one above.</td></tr>`; return; }

  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${escapeHtml(row.semesters?.school_years?.name ?? '—')} – ${escapeHtml(row.semesters?.name ?? '—')}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${row.start_date} → ${row.end_date}</td>
      <td>${row.sort_order}</td>
      <td><button class="btn btn-danger btn-sm" data-delete="${row.id}">Delete</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deletePeriod(btn.dataset.delete)));
}

async function handleAdd(e) {
  e.preventDefault();
  const errorBox = document.getElementById('formError');
  errorBox.style.display = 'none';

  const semester_id = document.getElementById('fieldSemester').value;
  const name = document.getElementById('fieldName').value.trim().toUpperCase();
  const start_date = document.getElementById('fieldStart').value;
  const end_date = document.getElementById('fieldEnd').value;
  const sort_order = parseInt(document.getElementById('fieldOrder').value, 10) || 1;

  if (!semester_id || !name || !start_date || !end_date) {
    showError('Please fill in every field.');
    return;
  }
  if (end_date < start_date) { showError('End date must be on or after the start date.'); return; }

  const { error } = await supabase.from('academic_periods').insert({
    semester_id, name, start_date, end_date, sort_order
  });

  if (error) {
    showError(error.message.includes('duplicate')
      ? 'This period name already exists for that semester.'
      : 'Could not save. Please try again.');
    return;
  }

  document.getElementById('addForm').reset();
  await loadPeriods();
}

async function deletePeriod(id) {
  if (!confirm('Delete this academic period? Only possible if no attendance sessions use it yet.')) return;
  const { error } = await supabase.from('academic_periods').delete().eq('id', id);
  if (error) { alert('Could not delete — it is likely still in use.'); return; }
  await loadPeriods();
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
