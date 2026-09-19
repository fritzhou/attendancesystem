// /js/dashboard.js — admin dashboard: fetch stats, render cards + chart

import { supabase } from './supabaseClient.js';

export async function initAdminDashboard(profile) {
  document.getElementById('welcomeMsg').textContent =
    `Welcome back, ${profile.full_name.split(' ')[0]}.`;

  const { data: stats, error } = await supabase.rpc('get_admin_dashboard_stats');

  if (error) {
    document.getElementById('overviewStats').innerHTML =
      `<div class="empty-state">Could not load dashboard stats. Try refreshing.</div>`;
    console.error(error);
    return;
  }

  renderYearBanner(stats);
  renderOverviewStats(stats);
  renderTodayStats(stats);
  renderTodayChart(stats);
}

function renderYearBanner(stats) {
  const banner = document.getElementById('yearBanner');
  if (!stats.active_school_year) {
    banner.style.display = 'block';
    banner.textContent =
      'No active school year has been set yet. Section counts and new enrollments will stay at zero until one is created.';
  }
}

function statCard(label, value, accent) {
  return `
    <div class="stat-card accent-${accent}">
      <div class="stat-card-label">${label}</div>
      <div class="stat-card-value">${value}</div>
    </div>
  `;
}

function renderOverviewStats(stats) {
  document.getElementById('overviewStats').innerHTML = [
    statCard('Total Students', stats.total_students, 'blue'),
    statCard('Active Students', stats.active_students, 'green'),
    statCard('Teachers', stats.total_teachers, 'blue'),
    statCard('Sections', stats.total_sections, 'blue'),
    statCard('Subjects', stats.total_subjects, 'blue'),
    statCard('Pending Registrations', stats.pending_registrations, 'yellow')
  ].join('');
}

function renderTodayStats(stats) {
  document.getElementById('todayStats').innerHTML = [
    statCard('Present', stats.today_present, 'green'),
    statCard('Late', stats.today_late, 'amber'),
    statCard('Absent', stats.today_absent, 'red'),
    statCard('Excused', stats.today_excused, 'blue')
  ].join('');
}

function renderTodayChart(stats) {
  const total = stats.today_present + stats.today_late + stats.today_absent + stats.today_excused;

  if (total === 0) {
    document.getElementById('todayChart').style.display = 'none';
    document.getElementById('chartEmpty').style.display = 'block';
    return;
  }

  new Chart(document.getElementById('todayChart'), {
    type: 'doughnut',
    data: {
      labels: ['Present', 'Late', 'Absent', 'Excused'],
      datasets: [{
        data: [stats.today_present, stats.today_late, stats.today_absent, stats.today_excused],
        backgroundColor: ['#16a34a', '#d97706', '#dc2626', '#64748b'],
        borderWidth: 0
      }]
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } } },
      cutout: '65%'
    }
  });
}
