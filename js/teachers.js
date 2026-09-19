// /js/teachers.js

import { supabase } from './supabaseClient.js';

export async function initTeachersPage() {
  await loadTeachers();
  document.getElementById('addForm').addEventListener('submit', handleAdd);
}

async function loadTeachers() {
  const tbody = document.getElementById('teachersBody');
  tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, is_active, teachers(employee_number)')
    .eq('role', 'teacher')
    .order('full_name');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Could not load teachers.</td></tr>`;
    return;
  }
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No teacher accounts yet. Add one above.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(t => `
    <tr>
      <td>${escapeHtml(t.full_name)}</td>
      <td>${escapeHtml(t.email)}</td>
      <td>${escapeHtml(t.teachers?.employee_number || '—')}</td>
      <td>${t.is_active
        ? '<span class="badge badge-present">Active</span>'
        : '<span class="badge badge-absent">Deactivated</span>'}</td>
    </tr>
  `).join('');
}

async function handleAdd(e) {
  e.preventDefault();
  const errorBox = document.getElementById('formError');
  errorBox.style.display = 'none';

  const full_name = document.getElementById('fieldName').value.trim();
  const email = document.getElementById('fieldEmail').value.trim();
  const password = document.getElementById('fieldPassword').value;
  const employee_number = document.getElementById('fieldEmployeeNumber').value.trim();

  if (!full_name || !email || !password) return;
  if (password.length < 8) {
    showError('Password must be at least 8 characters.');
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  const { data, error } = await supabase.functions.invoke('create-teacher', {
    body: { full_name, email, password, employee_number: employee_number || null }
  });

  btn.disabled = false;
  btn.textContent = 'Add Teacher';

  if (error || !data?.success) {
    showError(data?.error || error?.message || 'Could not create teacher account.');
    return;
  }

  document.getElementById('addForm').reset();
  await loadTeachers();
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
