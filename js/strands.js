// /js/strands.js

import { supabase } from './supabaseClient.js';

export async function initStrandsPage() {
  await loadStrands();
  document.getElementById('addForm').addEventListener('submit', handleAdd);
}

async function loadStrands() {
  const tbody = document.getElementById('strandsBody');
  tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from('strands')
    .select('id, name, code')
    .order('code');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Could not load strands.</td></tr>`;
    return;
  }
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No strands yet. Add one above.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${escapeHtml(row.code)}</td>
      <td>${escapeHtml(row.name)}</td>
      <td><button class="btn btn-danger btn-sm" data-delete="${row.id}">Delete</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteStrand(btn.dataset.delete)));
}

async function handleAdd(e) {
  e.preventDefault();
  const errorBox = document.getElementById('formError');
  errorBox.style.display = 'none';

  const code = document.getElementById('fieldCode').value.trim().toUpperCase();
  const name = document.getElementById('fieldName').value.trim();
  if (!code || !name) return;

  const { error } = await supabase.from('strands').insert({ code, name });
  if (error) {
    errorBox.textContent = error.message.includes('duplicate')
      ? 'A strand with this code or name already exists.'
      : 'Could not save. Please try again.';
    errorBox.style.display = 'block';
    return;
  }

  document.getElementById('addForm').reset();
  await loadStrands();
}

async function deleteStrand(id) {
  if (!confirm('Delete this strand? Only possible if no sections use it yet.')) return;
  const { error } = await supabase.from('strands').delete().eq('id', id);
  if (error) { alert('Could not delete — it is likely still in use by a section.'); return; }
  await loadStrands();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
