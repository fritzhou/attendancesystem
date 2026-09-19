// /js/subjects.js

import { supabase } from './supabaseClient.js';

export async function initSubjectsPage() {
  await loadSubjects();
  document.getElementById('addForm').addEventListener('submit', handleAdd);
}

async function loadSubjects() {
  const tbody = document.getElementById('subjectsBody');
  tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Loading...</td></tr>`;

  const { data, error } = await supabase.from('subjects').select('id, subject_code, subject_name').order('subject_code');

  if (error) { tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Could not load subjects.</td></tr>`; return; }
  if (data.length === 0) { tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No subjects yet. Add one above.</td></tr>`; return; }

  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${escapeHtml(row.subject_code)}</td>
      <td>${escapeHtml(row.subject_name)}</td>
      <td><button class="btn btn-danger btn-sm" data-delete="${row.id}">Delete</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteSubject(btn.dataset.delete)));
}

async function handleAdd(e) {
  e.preventDefault();
  const errorBox = document.getElementById('formError');
  errorBox.style.display = 'none';

  const subject_code = document.getElementById('fieldCode').value.trim().toUpperCase();
  const subject_name = document.getElementById('fieldName').value.trim();
  if (!subject_code || !subject_name) return;

  const { error } = await supabase.from('subjects').insert({ subject_code, subject_name });
  if (error) {
    showError(error.message.includes('duplicate') ? 'A subject with this code already exists.' : 'Could not save.');
    return;
  }

  document.getElementById('addForm').reset();
  await loadSubjects();
}

async function deleteSubject(id) {
  if (!confirm('Delete this subject? Only possible if no classes use it yet.')) return;
  const { error } = await supabase.from('subjects').delete().eq('id', id);
  if (error) { alert('Could not delete — it is likely still in use.'); return; }
  await loadSubjects();
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
