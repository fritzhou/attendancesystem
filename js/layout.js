// /js/layout.js
// Renders the sidebar + topbar shared by every admin/teacher page.
// Each protected page has empty <aside id="sidebar"> and
// <header id="topbar"> elements — this fills them in based on role.

import { signOut, appUrl } from './auth.js';

const NAV = {
  admin: [
    { label: 'Dashboard',         href: '/admin/dashboard.html',      icon: '📊' },
    { label: 'Students',          href: '/admin/students.html',       icon: '🎓' },
    { label: 'Import Students',   href: '/admin/student-import.html', icon: '📥' },
    { label: 'Registrations',     href: '/admin/registrations.html',  icon: '📝' },
    { label: 'Teachers',          href: '/admin/teachers.html',       icon: '👩‍🏫' },
    { label: 'Strands',           href: '/admin/strands.html',        icon: '🧩' },
    { label: 'Sections',          href: '/admin/sections.html',       icon: '🏫' },
    { label: 'Subjects',          href: '/admin/subjects.html',       icon: '📚' },
    { label: 'Class Assignments', href: '/admin/class-assignments.html', icon: '🔗' },
    { label: 'School Years',      href: '/admin/school-years.html',   icon: '🗓️' },
    { label: 'Semesters',         href: '/admin/semesters.html',      icon: '📑' },
    { label: 'Academic Periods',  href: '/admin/academic-periods.html', icon: '📆' },
    { label: 'Reports',           href: '/admin/reports.html',        icon: '📄' },
    { label: 'Analytics',         href: '/admin/analytics.html',      icon: '📈' },
    { label: 'Audit Logs',        href: '/admin/audit-logs.html',     icon: '🛡️' }
  ],
  teacher: [
    { label: 'Dashboard',        href: '/teacher/dashboard.html',     icon: '📊' },
    { label: 'My Classes',       href: '/teacher/classes.html',       icon: '🏫' },
    { label: 'Take Attendance',  href: '/teacher/attendance.html',    icon: '✅' },
    { label: 'Scanner',          href: '/teacher/scanner.html',       icon: '📷' },
    { label: 'My Students',      href: '/teacher/students.html',      icon: '🎓' },
    { label: 'Registrations',    href: '/teacher/registrations.html', icon: '📝' },
    { label: 'Reports',          href: '/teacher/reports.html',       icon: '📄' }
  ]
};

for (const item of Object.values(NAV).flat()) {
  item.href = appUrl(item.href.replace(/^\//, ''));
}

export function renderShell(profile) {
  const items = NAV[profile.role] || [];
  const path = window.location.href;

  const sidebar = document.getElementById('sidebar');
  const topbar = document.getElementById('topbar');

  sidebar.innerHTML = `
    <div class="sidebar-brand">
      <span class="sidebar-brand-name">Pilgrim Attend</span>
      <span class="sidebar-brand-sub">Pilgrim Christian College</span>
    </div>
    <nav class="sidebar-nav">
      ${items.map(item => `
        <a href="${item.href}" class="sidebar-link ${path === item.href ? 'active' : ''}">
          <span class="sidebar-icon">${item.icon}</span>
          <span>${item.label}</span>
        </a>
      `).join('')}
    </nav>
  `;

  topbar.innerHTML = `
    <button class="sidebar-toggle" id="sidebarToggle" aria-label="Toggle menu">☰</button>
    <div class="topbar-spacer"></div>
    <div class="topbar-user">
      <div class="topbar-user-info">
        <span class="topbar-user-name">${escapeHtml(profile.full_name)}</span>
        <span class="topbar-user-role">${profile.role}</span>
      </div>
      <button class="btn-logout" id="logoutBtn">Log Out</button>
    </div>
  `;

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut();
    window.location.href = appUrl('index.html');
  });

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });

  sidebar.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
      document.body.classList.remove('sidebar-open');
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="/admin/"], a[href^="/teacher/"], a[href="/login.html"]');
  if (!link) return;

  const href = link.getAttribute('href');
  event.preventDefault();

  window.location.href = href === '/login.html'
    ? appUrl('index.html')
    : appUrl(href.slice(1));
});
