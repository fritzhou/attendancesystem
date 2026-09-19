// /js/sections.js

import { supabase } from './supabaseClient.js';

export async function initSectionsPage() {
  await Promise.all([loadDropdowns(), loadSections()]);
  document.getElementById('addForm').addEventListener('submit', handleAdd);
}

async function loadDropdowns() {
  const [{ data: years }, { data: strands }] = await Promise.all([
    supabase.from('school_years').select('id, name').order('start_date', { ascending: false }),
    supabase.from('strands').select('id, code').order('code')
  ]);

  const yearSelect = document.getElementById('fieldYear');
  const strandSelect = document.getElementById('fieldStrand');

  if (!years || years.length === 0) {
    yearSelect.innerHTML = `<option value="">Add a school year first</option>`;
  } else {
    yearSelect.innerHTML = years.map(y => `<option value="${y.id}">${escapeHtml(y.name)}</option>`).join('');
  }

  if (!strands || strands.length === 0) {
    strandSelect.innerHTML = `<option value="">Add a strand first</option>`;
  } else {
    strandSelect.innerHTML = strands.map(s => `<option value="${s.id}">${escapeHtml(s.code)}</option>`).join('');
  }
}

async function loadSections() {
  const tbody = document.getElementById('sectionsBody');
  tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Loading...</td></tr>`;

  const { data, error } = await supabase
    .from('sections')
    .select('id, grade_level, section_name, school_years(name), strands(code)')
    .order('grade_level');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Could not load sections.</td></tr>`;
    return;
  }
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No sections yet. Add one above.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(row => `
    <tr>
      <td>${escapeHtml(row.school_years?.name ?? '—')}</td>
      <td>Grade ${row.grade_level}</td>
      <td>${escapeHtml(row.strands?.code ?? '—')}</td>
      <td>${escapeHtml(row.section_name)}</td>
      <td><button class="btn btn-danger btn-sm" data-delete="${row.id}">Delete</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteSection(btn.dataset.delete)));
}

async function handleAdd(e) {
  e.preventDefault();
  const errorBox = document.getElementById('formError');
  errorBox.style.display = 'none';

  const school_year_id = document.getElementById('fieldYear').value;
  const grade_level = parseInt(document.getElementById('fieldGrade').value, 10);
  const strand_id = document.getElementById('fieldStrand').value;
  const section_name = document.getElementById('fieldSectionName').value.trim();

  if (!school_year_id || !strand_id || !section_name) {
    errorBox.textContent = 'Please fill in every field.';
    errorBox.style.display = 'block';
    return;
  }

  const { error } = await supabase.from('sections').insert({
    school_year_id, grade_level, strand_id, section_name
  });

  if (error) {
    errorBox.textContent = error.message.includes('duplicate')
      ? 'This exact section already exists for that school year.'
      : 'Could not save. Please try again.';
    errorBox.style.display = 'block';
    return;
  }

  document.getElementById('fieldSectionName').value = '';
  await loadSections();
}

async function deleteSection(id) {
  if (!confirm('Delete this section? Only possible if no students are enrolled in it yet.')) return;
  const { error } = await supabase.from('sections').delete().eq('id', id);
  if (error) { alert('Could not delete — students are likely enrolled in it.'); return; }
  await loadSections();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
