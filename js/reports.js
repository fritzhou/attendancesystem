// /js/reports.js

import { supabase } from './supabaseClient.js';

let currentProfile = null;
let currentTeacherId = null;
let classOptions = [];
let periodOptions = [];
let lastReportData = null;

export async function initReportsPage(profile) {
  currentProfile = profile;

  if (profile.role === 'teacher') {
    const { data: t } = await supabase.from('teachers').select('id').eq('profile_id', profile.id).single();
    currentTeacherId = t?.id || null;
  }

  await loadClassOptions();
  document.getElementById('fieldClass').addEventListener('change', loadPeriodOptionsForSelectedClass);
  document.getElementById('fieldPeriod').addEventListener('change', applyPeriodDates);
  document.getElementById('fieldViewMode').addEventListener('change', updateModeUI);
  document.getElementById('generateBtn').addEventListener('click', generateReport);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('csvBtn').addEventListener('click', exportCsv);
  document.getElementById('xlsxBtn').addEventListener('click', exportXlsx);
  updateModeUI();
}

function updateModeUI() {
  const mode = document.getElementById('fieldViewMode').value;
  const isSemester = mode === 'semester';
  document.getElementById('dateRangeFields').style.display = isSemester ? 'none' : '';
  document.getElementById('absenceOnlyField').style.display = isSemester ? 'none' : '';
}

async function loadClassOptions() {
  let query = supabase
    .from('class_assignments')
    .select(`
      id, section_id, school_year_id, semester_id,
      subjects(subject_code, subject_name),
      sections(grade_level, section_name, strands(code)),
      teachers(profiles(full_name)),
      semesters(name, school_years(name))
    `);

  if (currentProfile.role === 'teacher') {
    if (!currentTeacherId) { classOptions = []; renderClassSelect(); return; }
    query = query.eq('teacher_id', currentTeacherId);
  }

  const { data } = await query;
  classOptions = (data || []).map(row => ({
    id: row.id,
    semesterId: row.semester_id,
    sectionId: row.section_id,
    schoolYearId: row.school_year_id,
    label: `${row.subjects.subject_code} – Grade ${row.sections.grade_level} ${row.sections.strands.code}/${row.sections.section_name}` +
           (currentProfile.role === 'admin' ? ` (${row.teachers.profiles.full_name})` : ''),
    subjectCode: row.subjects.subject_code,
    subjectName: row.subjects.subject_name,
    sectionLabel: `Grade ${row.sections.grade_level} – ${row.sections.strands.code}/${row.sections.section_name}`,
    teacherName: row.teachers.profiles.full_name,
    semesterName: row.semesters.name,
    schoolYearName: row.semesters.school_years.name
  }));

  renderClassSelect();
}

function renderClassSelect() {
  const select = document.getElementById('fieldClass');
  select.innerHTML = classOptions.length
    ? classOptions.map(c => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('')
    : `<option value="">No classes available</option>`;
  loadPeriodOptionsForSelectedClass();
}

async function loadPeriodOptionsForSelectedClass() {
  const classId = document.getElementById('fieldClass').value;
  const cls = classOptions.find(c => c.id === classId);
  const select = document.getElementById('fieldPeriod');

  if (!cls) { select.innerHTML = `<option value="">Custom Date Range</option>`; periodOptions = []; return; }

  const { data } = await supabase
    .from('academic_periods')
    .select('id, name, start_date, end_date, sort_order')
    .eq('semester_id', cls.semesterId)
    .order('sort_order');

  periodOptions = data || [];
  select.innerHTML = `<option value="">Custom Date Range</option>` +
    periodOptions.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('') +
    (periodOptions.length ? `<option value="__semester__">Entire Semester</option>` : '');
}

function applyPeriodDates() {
  const value = document.getElementById('fieldPeriod').value;
  if (!value) return;

  if (value === '__semester__') {
    if (periodOptions.length === 0) return;
    document.getElementById('fieldStart').value = periodOptions.reduce((m, p) => (p.start_date < m ? p.start_date : m), periodOptions[0].start_date);
    document.getElementById('fieldEnd').value = periodOptions.reduce((m, p) => (p.end_date > m ? p.end_date : m), periodOptions[0].end_date);
    return;
  }

  const period = periodOptions.find(p => p.id === value);
  if (period) {
    document.getElementById('fieldStart').value = period.start_date;
    document.getElementById('fieldEnd').value = period.end_date;
  }
}

async function generateReport() {
  const classId = document.getElementById('fieldClass').value;
  const mode = document.getElementById('fieldViewMode').value;
  hideError();

  if (!classId) { showError('Choose a class.'); return; }
  const cls = classOptions.find(c => c.id === classId);

  if (mode === 'semester') {
    await generateSemesterSummary(cls);
    return;
  }

  const startDate = document.getElementById('fieldStart').value;
  const endDate = document.getElementById('fieldEnd').value;
  if (!startDate || !endDate) { showError('Choose a date range.'); return; }
  if (endDate < startDate) { showError('End date must be on or after the start date.'); return; }

  const periodLabel = document.getElementById('fieldPeriod').selectedOptions[0]?.textContent || 'Custom Date Range';

  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  const [{ data: sessions }, { data: enrollments }] = await Promise.all([
    supabase.from('attendance_sessions').select('id, attendance_date')
      .eq('class_assignment_id', classId)
      .gte('attendance_date', startDate).lte('attendance_date', endDate)
      .order('attendance_date'),
    supabase.from('enrollments').select('students(id, full_name, student_number)')
      .eq('section_id', cls.sectionId).eq('school_year_id', cls.schoolYearId).eq('enrollment_status', 'ACTIVE')
  ]);

  btn.disabled = false;
  btn.textContent = 'Generate Report';

  if (!sessions || sessions.length === 0) {
    document.getElementById('reportArea').style.display = 'none';
    showError('No attendance sessions found in this date range.');
    return;
  }

  const roster = (enrollments || []).map(e => e.students).filter(Boolean).sort((a, b) => a.full_name.localeCompare(b.full_name));

  const sessionIds = sessions.map(s => s.id);
  const { data: records } = await supabase
    .from('attendance_records')
    .select('student_id, attendance_session_id, status')
    .in('attendance_session_id', sessionIds);

  const statusMap = new Map();
  (records || []).forEach(r => statusMap.set(`${r.student_id}|${r.attendance_session_id}`, r.status));

  const rows = roster.map(student => {
    const cells = sessions.map(s => statusMap.get(`${student.id}|${s.id}`) || null);
    const totals = { P: 0, L: 0, A: 0, E: 0 };
    cells.forEach(c => { if (c) totals[c[0]] = (totals[c[0]] || 0) + 1; });
    const pct = sessions.length ? Math.round(((totals.P + totals.L + totals.E) / sessions.length) * 100) : 0;
    return { student, cells, totals, pct };
  });

  lastReportData = { mode, cls, sessions, rows, startDate, endDate, periodLabel };
  renderDailyOrSummary();
}

function processRows(rows) {
  const onlyFlagged = document.getElementById('fieldAbsenceOnly').checked;
  if (!onlyFlagged) return rows;
  return rows
    .filter(r => (r.totals.A || 0) > 0 || (r.totals.L || 0) > 0)
    .sort((a, b) => ((b.totals.A || 0) + (b.totals.L || 0)) - ((a.totals.A || 0) + (a.totals.L || 0)));
}

function renderDailyOrSummary() {
  const { mode, cls, sessions, rows, startDate, endDate, periodLabel } = lastReportData;
  const displayRows = processRows(rows);
  const reportName = mode === 'daily' ? 'Class Attendance Log' : 'Period Summary';

  document.getElementById('reportArea').style.display = 'block';
  document.getElementById('printHeaderMeta').innerHTML = `
    <span>School Year: <strong>${escapeHtml(cls.schoolYearName)}</strong></span>
    <span>Semester: <strong>${escapeHtml(cls.semesterName)}</strong></span>
    <span>Subject: <strong>${escapeHtml(cls.subjectCode)} – ${escapeHtml(cls.subjectName)}</strong></span>
    <span>Teacher: <strong>${escapeHtml(cls.teacherName)}</strong></span>
    <span>Grade & Section: <strong>${escapeHtml(cls.sectionLabel)}</strong></span>
    <span>Report: <strong>${reportName}</strong> — ${escapeHtml(periodLabel)} (${startDate} to ${endDate})</span>
  `;

  const dateHeaders = mode === 'daily' ? sessions.map(s => `<th class="num-col">${formatShortDate(s.attendance_date)}</th>`).join('') : '';

  const bodyRows = displayRows.map((r, i) => {
    const cellsHtml = mode === 'daily'
      ? r.cells.map(c => c ? `<td class="num-col status-${c[0]}">${c[0]}</td>` : `<td class="num-col status-dash">–</td>`).join('')
      : '';
    return `
      <tr>
        <td class="num-col">${i + 1}</td>
        <td class="student-col">${escapeHtml(r.student.student_number)}</td>
        <td class="student-col">${escapeHtml(r.student.full_name)}</td>
        ${cellsHtml}
        <td class="num-col status-P">${r.totals.P || 0}</td>
        <td class="num-col status-L">${r.totals.L || 0}</td>
        <td class="num-col status-A">${r.totals.A || 0}</td>
        <td class="num-col status-E">${r.totals.E || 0}</td>
        <td class="num-col"><strong>${r.pct}%</strong></td>
      </tr>
    `;
  }).join('');

  document.getElementById('reportTable').innerHTML = `
    <thead>
      <tr>
        <th class="num-col">No.</th><th class="student-col">Student No.</th><th class="student-col">Student Name</th>
        ${dateHeaders}
        <th class="num-col">P</th><th class="num-col">L</th><th class="num-col">A</th><th class="num-col">E</th>
        <th class="num-col">Attend. %</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  `;

  document.getElementById('footerTeacherName').textContent = cls.teacherName;
  document.getElementById('printFooterMeta').textContent =
    `Generated on ${new Date().toLocaleString()} by ${currentProfile.full_name} · Attendance % = (Present + Late + Excused) ÷ Total Sessions`;
}

async function generateSemesterSummary(cls) {
  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  const { data: periods } = await supabase
    .from('academic_periods').select('id, name, start_date, end_date, sort_order')
    .eq('semester_id', cls.semesterId).order('sort_order');

  if (!periods || periods.length === 0) {
    btn.disabled = false; btn.textContent = 'Generate Report';
    document.getElementById('reportArea').style.display = 'none';
    showError('No academic periods defined for this semester yet.');
    return;
  }

  const { data: enrollments } = await supabase
    .from('enrollments').select('students(id, full_name, student_number)')
    .eq('section_id', cls.sectionId).eq('school_year_id', cls.schoolYearId).eq('enrollment_status', 'ACTIVE');
  const roster = (enrollments || []).map(e => e.students).filter(Boolean).sort((a, b) => a.full_name.localeCompare(b.full_name));

  const semStart = periods.reduce((m, p) => (p.start_date < m ? p.start_date : m), periods[0].start_date);
  const semEnd = periods.reduce((m, p) => (p.end_date > m ? p.end_date : m), periods[0].end_date);

  const { data: sessions } = await supabase
    .from('attendance_sessions').select('id, attendance_date, academic_period_id')
    .eq('class_assignment_id', cls.id)
    .gte('attendance_date', semStart).lte('attendance_date', semEnd);

  btn.disabled = false;
  btn.textContent = 'Generate Report';

  if (!sessions || sessions.length === 0) {
    document.getElementById('reportArea').style.display = 'none';
    showError('No attendance sessions found for this semester yet.');
    return;
  }

  const sessionIds = sessions.map(s => s.id);
  const { data: records } = await supabase
    .from('attendance_records').select('student_id, attendance_session_id, status')
    .in('attendance_session_id', sessionIds);

  const statusMap = new Map();
  (records || []).forEach(r => statusMap.set(`${r.student_id}|${r.attendance_session_id}`, r.status));

  const sessionsByPeriod = new Map(periods.map(p => [p.id, []]));
  sessions.forEach(s => { if (sessionsByPeriod.has(s.academic_period_id)) sessionsByPeriod.get(s.academic_period_id).push(s.id); });

  function pctFor(studentId, ids) {
    if (ids.length === 0) return null;
    let ok = 0;
    ids.forEach(sid => {
      const st = statusMap.get(`${studentId}|${sid}`);
      if (st === 'PRESENT' || st === 'LATE' || st === 'EXCUSED') ok++;
    });
    return Math.round((ok / ids.length) * 100);
  }

  const rows = roster.map(student => ({
    student,
    periodPcts: periods.map(p => pctFor(student.id, sessionsByPeriod.get(p.id) || [])),
    semesterPct: pctFor(student.id, sessions.map(s => s.id))
  }));

  lastReportData = { mode: 'semester', cls, periods, rows };
  renderSemesterSummary();
}

function renderSemesterSummary() {
  const { cls, periods, rows } = lastReportData;
  document.getElementById('reportArea').style.display = 'block';

  document.getElementById('printHeaderMeta').innerHTML = `
    <span>School Year: <strong>${escapeHtml(cls.schoolYearName)}</strong></span>
    <span>Semester: <strong>${escapeHtml(cls.semesterName)}</strong></span>
    <span>Subject: <strong>${escapeHtml(cls.subjectCode)} – ${escapeHtml(cls.subjectName)}</strong></span>
    <span>Teacher: <strong>${escapeHtml(cls.teacherName)}</strong></span>
    <span>Grade & Section: <strong>${escapeHtml(cls.sectionLabel)}</strong></span>
    <span>Report: <strong>Semester Summary</strong></span>
  `;

  const periodHeaders = periods.map(p => `<th class="num-col">${escapeHtml(p.name)} %</th>`).join('');
  const bodyRows = rows.map((r, i) => `
    <tr>
      <td class="num-col">${i + 1}</td>
      <td class="student-col">${escapeHtml(r.student.student_number)}</td>
      <td class="student-col">${escapeHtml(r.student.full_name)}</td>
      ${r.periodPcts.map(p => `<td class="num-col">${p === null ? '–' : p + '%'}</td>`).join('')}
      <td class="num-col"><strong>${r.semesterPct === null ? '–' : r.semesterPct + '%'}</strong></td>
    </tr>
  `).join('');

  document.getElementById('reportTable').innerHTML = `
    <thead><tr><th class="num-col">No.</th><th class="student-col">Student No.</th><th class="student-col">Student Name</th>${periodHeaders}<th class="num-col">Semester %</th></tr></thead>
    <tbody>${bodyRows}</tbody>
  `;

  document.getElementById('footerTeacherName').textContent = cls.teacherName;
  document.getElementById('printFooterMeta').textContent =
    `Generated on ${new Date().toLocaleString()} by ${currentProfile.full_name} · % = (Present + Late + Excused) ÷ Sessions in that period`;
}

function exportCsv() {
  if (!lastReportData) return;
  if (lastReportData.mode === 'semester') { exportSemesterCsv(); return; }

  const { cls, sessions, rows, mode, startDate, endDate } = lastReportData;
  const displayRows = processRows(rows);
  const header = ['No.', 'Student No.', 'Student Name',
    ...(mode === 'daily' ? sessions.map(s => s.attendance_date) : []),
    'P', 'L', 'A', 'E', 'Attendance %'];
  const lines = [header.join(',')];

  displayRows.forEach((r, i) => {
    const cells = mode === 'daily' ? r.cells.map(c => c ? c[0] : '') : [];
    lines.push([i + 1, r.student.student_number, `"${r.student.full_name}"`, ...cells, r.totals.P || 0, r.totals.L || 0, r.totals.A || 0, r.totals.E || 0, `${r.pct}%`].join(','));
  });

  downloadFile(lines.join('\n'), `${cls.subjectCode}-${mode}-${startDate}-to-${endDate}.csv`, 'text/csv');
}

function exportSemesterCsv() {
  const { cls, periods, rows } = lastReportData;
  const header = ['No.', 'Student No.', 'Student Name', ...periods.map(p => `${p.name} %`), 'Semester %'];
  const lines = [header.join(',')];
  rows.forEach((r, i) => {
    lines.push([i + 1, r.student.student_number, `"${r.student.full_name}"`,
      ...r.periodPcts.map(p => p === null ? '' : `${p}%`), r.semesterPct === null ? '' : `${r.semesterPct}%`].join(','));
  });
  downloadFile(lines.join('\n'), `${cls.subjectCode}-semester-summary.csv`, 'text/csv');
}

function exportXlsx() {
  if (!lastReportData) return;
  if (lastReportData.mode === 'semester') { exportSemesterXlsx(); return; }

  const { cls, sessions, rows, mode, startDate, endDate } = lastReportData;
  const displayRows = processRows(rows);
  const header = ['No.', 'Student No.', 'Student Name',
    ...(mode === 'daily' ? sessions.map(s => s.attendance_date) : []),
    'P', 'L', 'A', 'E', 'Attendance %'];
  const data = [header];

  displayRows.forEach((r, i) => {
    const cells = mode === 'daily' ? r.cells.map(c => c ? c[0] : '') : [];
    data.push([i + 1, r.student.student_number, r.student.full_name, ...cells, r.totals.P || 0, r.totals.L || 0, r.totals.A || 0, r.totals.E || 0, `${r.pct}%`]);
  });

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, mode === 'daily' ? 'Attendance' : 'Summary');
  XLSX.writeFile(wb, `${cls.subjectCode}-${mode}-${startDate}-to-${endDate}.xlsx`);
}

function exportSemesterXlsx() {
  const { cls, periods, rows } = lastReportData;
  const header = ['No.', 'Student No.', 'Student Name', ...periods.map(p => `${p.name} %`), 'Semester %'];
  const data = [header];
  rows.forEach((r, i) => {
    data.push([i + 1, r.student.student_number, r.student.full_name,
      ...r.periodPcts.map(p => p === null ? '' : `${p}%`), r.semesterPct === null ? '' : `${r.semesterPct}%`]);
  });
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Semester Summary');
  XLSX.writeFile(wb, `${cls.subjectCode}-semester-summary.xlsx`);
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function showError(msg) {
  const errorBox = document.getElementById('reportError');
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}
function hideError() { document.getElementById('reportError').style.display = 'none'; }

function formatShortDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
