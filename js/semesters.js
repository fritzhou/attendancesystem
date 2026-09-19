// /js/semesters.js

import { supabase } from './supabaseClient.js';

export async function initSemestersPage() {
  await loadYearOptions();
  await loadSemesters();
  document.getElementById('addForm').addEventListener('submit', handleAdd);
}

async function loadYearOptions() {
  const { data } = await supabase.from('school_years').select('id, name').order('start_date', { ascending: false });
  const select = document.getElementById('fieldYear');
  select.innerHTML = (data && data.length)
    ? data.map(y => `<option value="${y.id}">${escapeHtml(y.name)}</option>`).join('')
    : `<option value="">Add a school year first</option>`;
}

async function loadSemesters() {
  const tbody = document.getElementById('semestersBody');
  tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from('semesters')
    .select('id, name, start_date, end_date, school_years(name)')
    .order('start_date', { ascending: false });

  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Could not load semesters.</td></tr>`; return; }
  if (data.length === 0) { tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No semesters yet. Add one above.</td></tr>`; return; }

  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${escapeHtml(row.school_years?.name ?? '—')}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${row.start_date} → ${row.end_date}</td>
      <td><button class="btn btn-danger btn-sm" data-delete="${row.id}">Delete</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteSemester(btn.dataset.delete)));
}

async function handleAdd(e) {
  e.preventDefault();
  const errorBox = document.getElementById('formError');
  errorBox.style.display = 'none';

  const school_year_id = document.getElementById('fieldYear').value;
  const name = document.getElementById('fieldName').value;
  const start_date = document.getElementById('fieldStart').value;
  const end_date = document.getElementById('fieldEnd').value;

  if (!school_year_id || !name || !start_date || !end_date) return;
  if (end_date <= start_date) { showError('End date must be after start date.'); return; }

  const { error } = await supabase.from('semesters').insert({ school_year_id, name, start_date, end_date });
  if (error) {
    showError(error.message.includes('duplicate') ? 'This semester already exists for that school year.' : 'Could not save.');
    return;
  }

  document.getElementById('addForm').reset();
  await loadSemesters();
}

async function deleteSemester(id) {
  if (!confirm('Delete this semester? Only possible if no academic periods or classes use it yet.')) return;
  const { error } = await supabase.from('semesters').delete().eq('id', id);
  if (error) { alert('Could not delete — it is likely still in use.'); return; }
  await loadSemesters();
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
