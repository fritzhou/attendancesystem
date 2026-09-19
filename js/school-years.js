// /js/school-years.js

import { supabase } from './supabaseClient.js';

export async function initSchoolYearsPage() {
  await loadSchoolYears();
  document.getElementById('addForm').addEventListener('submit', handleAdd);
}

async function loadSchoolYears() {
  const tbody = document.getElementById('yearsBody');
  tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from('school_years')
    .select('id, name, start_date, end_date, is_active')
    .order('start_date', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Could not load school years.</td></tr>`;
    return;
  }
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No school years yet. Add one above.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td>${row.start_date} → ${row.end_date}</td>
      <td>${row.is_active
        ? '<span class="badge badge-present">Active</span>'
        : '<span class="text-muted">Inactive</span>'}</td>
      <td>
        ${row.is_active ? '' : `<button class="btn btn-secondary btn-sm" data-set-active="${row.id}">Set Active</button>`}
        <button class="btn btn-danger btn-sm" data-delete="${row.id}">Delete</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-set-active]').forEach(btn =>
    btn.addEventListener('click', () => setActive(btn.dataset.setActive)));
  tbody.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteYear(btn.dataset.delete)));
}

async function handleAdd(e) {
  e.preventDefault();
  const errorBox = document.getElementById('formError');
  errorBox.style.display = 'none';

  const name = document.getElementById('fieldName').value.trim();
  const start_date = document.getElementById('fieldStart').value;
  const end_date = document.getElementById('fieldEnd').value;

  if (!name || !start_date || !end_date) return;
  if (end_date <= start_date) {
    showError('End date must be after start date.');
    return;
  }

  const { error } = await supabase.from('school_years').insert({ name, start_date, end_date });

  if (error) {
    showError(error.message.includes('duplicate')
      ? 'A school year with this name already exists.'
      : 'Could not save. Please try again.');
    return;
  }

  document.getElementById('addForm').reset();
  await loadSchoolYears();
}

async function setActive(id) {
  const { error } = await supabase.rpc('set_active_school_year', { p_year_id: id });
  if (error) alert('Could not set this school year as active.');
  await loadSchoolYears();
}

async function deleteYear(id) {
  if (!confirm('Delete this school year? Only possible if no sections or enrollments use it yet.')) return;
  const { error } = await supabase.from('school_years').delete().eq('id', id);
  if (error) { alert('Could not delete — it is likely still in use.'); return; }
  await loadSchoolYears();
}

function showError(msg) {
  const errorBox = document.getElementById('formError');
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
