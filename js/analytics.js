// /js/analytics.js

import { supabase } from './supabaseClient.js';

let charts = {};

export async function initAnalyticsPage() {
  await loadYearOptions();
  document.getElementById('fieldYear').addEventListener('change', loadAnalytics);
  await loadAnalytics();
}

async function loadYearOptions() {
  const { data } = await supabase.from('school_years').select('id, name, is_active').order('start_date', { ascending: false });
  const select = document.getElementById('fieldYear');

  if (!data || data.length === 0) {
    select.innerHTML = `<option value="">No school years yet</option>`;
    return;
  }

  select.innerHTML = data.map(y => `<option value="${y.id}" ${y.is_active ? 'selected' : ''}>${escapeHtml(y.name)}</option>`).join('');
}

async function loadAnalytics() {
  const yearId = document.getElementById('fieldYear').value;
  if (!yearId) return;

  document.getElementById('analyticsArea').style.display = 'none';
  document.getElementById('loadingState').style.display = 'block';

  const { data, error } = await supabase.rpc('get_school_analytics', { p_school_year_id: yearId });

  document.getElementById('loadingState').style.display = 'none';

  if (error || !data) {
    document.getElementById('loadingState').textContent = 'Could not load analytics.';
    document.getElementById('loadingState').style.display = 'block';
    return;
  }

  document.getElementById('analyticsArea').style.display = 'block';

  renderOverview(data.overall);
  renderMonthlyChart(data.monthly);
  renderBarChart('sectionChart', data.by_section, 'section_label');
  renderBarChart('subjectChart', data.by_subject, 'subject_label');
  renderTopList('topAbsentList', data.top_absent, 'absent_count');
  renderTopList('topLateList', data.top_late, 'late_count');
}

function renderOverview(overall) {
  const rate = overall.total ? Math.round(((overall.present + overall.late + overall.excused) / overall.total) * 100) : 0;
  document.getElementById('overviewStats').innerHTML = `
    <div class="stat-card accent-blue"><div class="stat-card-label">Overall Attendance Rate</div><div class="stat-card-value">${rate}%</div></div>
    <div class="stat-card accent-green"><div class="stat-card-label">Present</div><div class="stat-card-value">${overall.present}</div></div>
    <div class="stat-card accent-amber"><div class="stat-card-label">Late</div><div class="stat-card-value">${overall.late}</div></div>
    <div class="stat-card accent-red"><div class="stat-card-label">Absent</div><div class="stat-card-value">${overall.absent}</div></div>
    <div class="stat-card"><div class="stat-card-label">Excused</div><div class="stat-card-value">${overall.excused}</div></div>
  `;
}

function renderMonthlyChart(monthly) {
  const canvas = document.getElementById('monthlyChart');
  if (charts.monthly) charts.monthly.destroy();

  if (!monthly || monthly.length === 0) {
    document.getElementById('monthlyEmpty').style.display = 'block';
    canvas.style.display = 'none';
    return;
  }
  document.getElementById('monthlyEmpty').style.display = 'none';
  canvas.style.display = 'block';

  const labels = monthly.map(m => formatMonth(m.month));
  const rates = monthly.map(m => {
    const total = m.present + m.late + m.absent + m.excused;
    return total ? Math.round(((m.present + m.late + m.excused) / total) * 100) : 0;
  });

  charts.monthly = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Attendance Rate %',
        data: rates,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,0.1)',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } },
      plugins: { legend: { display: false } }
    }
  });
}

function renderBarChart(canvasId, rows, labelKey) {
  const canvas = document.getElementById(canvasId);
  const emptyId = canvasId + 'Empty';
  if (charts[canvasId]) charts[canvasId].destroy();

  if (!rows || rows.length === 0) {
    document.getElementById(emptyId).style.display = 'block';
    canvas.style.display = 'none';
    return;
  }
  document.getElementById(emptyId).style.display = 'none';
  canvas.style.display = 'block';

  const labels = rows.map(r => r[labelKey]);
  const rates = rows.map(r => r.total ? Math.round((r.attended / r.total) * 100) : 0);

  charts[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Attendance Rate %', data: rates, backgroundColor: '#3b82f6', borderRadius: 6 }] },
    options: {
      scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } },
      plugins: { legend: { display: false } }
    }
  });
}

function renderTopList(elementId, rows, countKey) {
  const container = document.getElementById(elementId);
  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="empty-state">No records in this category yet.</div>`;
    return;
  }

  container.innerHTML = rows.map(r => `
    <div class="top-list-row">
      <div>
        <div class="top-list-name">${escapeHtml(r.full_name)}</div>
        <div class="top-list-number">${escapeHtml(r.student_number)}</div>
      </div>
      <div class="top-list-count">${r[countKey]}</div>
    </div>
  `).join('');
}

function formatMonth(ym) {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
