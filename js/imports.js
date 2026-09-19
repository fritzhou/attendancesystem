// /js/imports.js
// Handles: file parsing (CSV via PapaParse, XLSX via SheetJS),
// validation against sections/duplicates, preview rendering,
// batch import, and error-row export.
// Expects the global `Papa` and `XLSX` libraries to be loaded
// via <script> tags on the page before this module runs.

import { supabase } from './supabaseClient.js';

let parsedRows = [];
let sectionLookup = new Map();
let existingNumbers = new Set();
let currentFileName = '';
let currentProfile = null;

export async function initImportPage(profile) {
  currentProfile = profile;
  await Promise.all([loadSectionLookup(), loadExistingNumbers()]);

  document.getElementById('fileInput').addEventListener('change', handleFileSelect);
  document.getElementById('importBtn').addEventListener('click', handleImport);
  document.getElementById('cancelBtn').addEventListener('click', resetImport);
  document.getElementById('downloadErrorsBtn').addEventListener('click', downloadErrorRows);
  document.getElementById('downloadTemplateBtn').addEventListener('click', downloadTemplate);
}

// ------------------------------------------------------------
// Lookups (loaded once, used for every row's validation)
// ------------------------------------------------------------

async function loadSectionLookup() {
  const { data, error } = await supabase
    .from('sections')
    .select('id, grade_level, section_name, school_year_id, school_years(name), strands(code)');

  sectionLookup = new Map();
  if (error || !data) return;

  for (const row of data) {
    const key = [
      (row.school_years?.name || '').toLowerCase().trim(),
      row.grade_level,
      (row.strands?.code || '').toLowerCase().trim(),
      (row.section_name || '').toLowerCase().trim()
    ].join('|');
    sectionLookup.set(key, { id: row.id, school_year_id: row.school_year_id });
  }
}

async function loadExistingNumbers() {
  const { data, error } = await supabase.from('students').select('student_number');
  existingNumbers = new Set(error || !data ? [] : data.map(r => r.student_number));
}

// ------------------------------------------------------------
// File handling
// ------------------------------------------------------------

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  currentFileName = file.name;
  setStatus('Reading file...');

  try {
    const rawRows = await parseFile(file);
    parsedRows = validateRows(rawRows);
    renderPreview();
  } catch (err) {
    setStatus('');
    alert(err.message || 'Could not read that file.');
  }
}

async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, '_'),
        complete: (results) => resolve(results.data),
        error: reject
      });
    });
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return rows.map(row => {
      const normalized = {};
      for (const key in row) {
        const normKey = key.trim().toLowerCase().replace(/\s+/g, '_');
        normalized[normKey] = String(row[key]).trim();
      }
      return normalized;
    });
  }

  throw new Error('Unsupported file type. Please upload a .csv or .xlsx file.');
}

// ------------------------------------------------------------
// Validation
// ------------------------------------------------------------

function validateRows(rawRows) {
  const seenInFile = new Set();

  return rawRows.map((raw, index) => {
    const errors = [];

    const student_number = String(raw.student_number || '').trim();
    const full_name       = String(raw.full_name || '').trim();
    const gradeRaw         = String(raw.grade_level || '').trim();
    const grade_level      = parseInt(gradeRaw, 10);
    const strand            = String(raw.strand || '').trim();
    const section            = String(raw.section || '').trim();
    const school_year         = String(raw.school_year || '').trim();

    if (!student_number) errors.push('Missing student number');
    if (!full_name) errors.push('Missing full name');
    if (!gradeRaw || isNaN(grade_level) || grade_level < 7 || grade_level > 12) {
      errors.push('Invalid grade level');
    }
    if (!strand) errors.push('Missing strand');
    if (!section) errors.push('Missing section');
    if (!school_year) errors.push('Missing school year');

    let sectionMatch = null;
    if (strand && section && school_year && !isNaN(grade_level)) {
      const key = [school_year.toLowerCase(), grade_level, strand.toLowerCase(), section.toLowerCase()].join('|');
      sectionMatch = sectionLookup.get(key) || null;
      if (!sectionMatch) errors.push('No matching section — create it in Sections first');
    }

    if (student_number) {
      if (seenInFile.has(student_number)) {
        errors.push('Duplicate student number in this file');
      } else {
        seenInFile.add(student_number);
      }
      if (existingNumbers.has(student_number)) {
        errors.push('Student number already exists in the system');
      }
    }

    return {
      rowNumber: index + 2,
      student_number, full_name, grade_level: gradeRaw, strand, section, school_year,
      sectionId: sectionMatch?.id || null,
      schoolYearId: sectionMatch?.school_year_id || null,
      status: errors.length ? 'error' : 'valid',
      errors
    };
  });
}

// ------------------------------------------------------------
// Preview rendering
// ------------------------------------------------------------

function renderPreview() {
  const valid = parsedRows.filter(r => r.status === 'valid');
  const errorRows = parsedRows.filter(r => r.status === 'error');

  document.getElementById('previewSection').style.display = 'block';
  document.getElementById('summaryStats').innerHTML = `
    <div class="stat-card"><div class="stat-card-label">Detected</div><div class="stat-card-value">${parsedRows.length}</div></div>
    <div class="stat-card accent-green"><div class="stat-card-label">Valid</div><div class="stat-card-value">${valid.length}</div></div>
    <div class="stat-card accent-red"><div class="stat-card-label">Errors</div><div class="stat-card-value">${errorRows.length}</div></div>
  `;

  const tbody = document.getElementById('previewBody');
  tbody.innerHTML = parsedRows.map(r => `
    <tr class="${r.status === 'error' ? 'row-error' : ''}">
      <td>${r.rowNumber}</td>
      <td>${escapeHtml(r.student_number)}</td>
      <td>${escapeHtml(r.full_name)}</td>
      <td>${escapeHtml(r.grade_level)}</td>
      <td>${escapeHtml(r.strand)}</td>
      <td>${escapeHtml(r.section)}</td>
      <td>${escapeHtml(r.school_year)}</td>
      <td>${r.status === 'valid'
        ? '<span class="badge badge-present">Valid</span>'
        : `<span class="badge badge-absent">Error</span><div class="error-reasons">${r.errors.map(escapeHtml).join('; ')}</div>`}</td>
    </tr>
  `).join('');

  document.getElementById('importBtn').disabled = valid.length === 0;
  document.getElementById('importBtn').textContent = `Import Valid Rows (${valid.length})`;
  document.getElementById('downloadErrorsBtn').disabled = errorRows.length === 0;
  setStatus('');
}

// ------------------------------------------------------------
// Import
// ------------------------------------------------------------

async function handleImport() {
  const validRows = parsedRows.filter(r => r.status === 'valid');
  if (validRows.length === 0) return;

  const importBtn = document.getElementById('importBtn');
  importBtn.disabled = true;
  importBtn.textContent = 'Importing...';

  const BATCH_SIZE = 200;
  let importedCount = 0;
  const failedRows = [];

  for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
    const batch = validRows.slice(i, i + BATCH_SIZE);

    const { data: insertedStudents, error: studentError } = await supabase
      .from('students')
      .insert(batch.map(r => ({
        student_number: r.student_number,
        full_name: r.full_name,
        registration_status: 'UNREGISTERED'
      })))
      .select('id, student_number');

    if (studentError) {
      batch.forEach(r => failedRows.push({ ...r, errors: [studentError.message] }));
      continue;
    }

    const idByNumber = new Map(insertedStudents.map(s => [s.student_number, s.id]));

    const { error: enrollError } = await supabase.from('enrollments').insert(
      batch
        .filter(r => idByNumber.has(r.student_number))
        .map(r => ({
          student_id: idByNumber.get(r.student_number),
          section_id: r.sectionId,
          school_year_id: r.schoolYearId
        }))
    );

    if (enrollError) {
      batch.forEach(r => failedRows.push({ ...r, errors: [enrollError.message] }));
      continue;
    }

    importedCount += batch.length;
  }

  await supabase.from('audit_logs').insert({
    user_id: currentProfile.id,
    action: 'roster_imported',
    target_type: 'students',
    metadata: { imported: importedCount, failed: failedRows.length, file_name: currentFileName }
  });

  if (failedRows.length > 0) {
    alert(`Imported ${importedCount} students. ${failedRows.length} rows failed during import — check the console for details.`);
    console.error('Import failures:', failedRows);
  } else {
    alert(`Imported ${importedCount} students successfully.`);
  }

  resetImport();
  await loadExistingNumbers();
}

// ------------------------------------------------------------
// Reset / downloads
// ------------------------------------------------------------

function resetImport() {
  parsedRows = [];
  currentFileName = '';
  document.getElementById('fileInput').value = '';
  document.getElementById('previewSection').style.display = 'none';
}

function downloadErrorRows() {
  const errorRows = parsedRows.filter(r => r.status === 'error');
  if (errorRows.length === 0) return;

  const header = 'student_number,full_name,grade_level,strand,section,school_year,errors\n';
  const csvBody = errorRows.map(r => [
    r.student_number, r.full_name, r.grade_level, r.strand, r.section, r.school_year,
    `"${r.errors.join('; ')}"`
  ].join(',')).join('\n');

  downloadCsv(header + csvBody, 'import-errors.csv');
}

function downloadTemplate() {
  const header = 'student_number,full_name,grade_level,strand,section,school_year\n';
  const example = '2026-001,Juan Dela Cruz,12,TVL-ICT,ICT-A,2026-2027\n';
  downloadCsv(header + example, 'student-roster-template.csv');
}

function downloadCsv(content, filename) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function setStatus(msg) {
  document.getElementById('uploadStatus').textContent = msg;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
