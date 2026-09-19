// /js/audit-logs.js

import { supabase } from './supabaseClient.js';

const ACTION_LABELS = {
  registration_approved: 'Registration Approved',
  registration_rejected: 'Registration Rejected',
  qr_regenerated: 'QR Regenerated',
  qr_revoked: 'QR Revoked',
  roster_imported: 'Roster Imported',
  attendance_manual_set: 'Manual Attendance Set',
  attendance_closed: 'Attendance Closed'
};

const PAGE_SIZE = 50;
let offset = 0;
let currentFilters = { action: '', start: '', end: '' };

export async function initAuditLogsPage() {
  populateActionFilter();
  document.getElementById('filterForm').addEventListener('submit', (e) => { e.preventDefault(); applyFilters(); });
  document.getElementById('loadMoreBtn').addEventListener('click', () => loadPage(false));
  await loadPage(true);
}

function populateActionFilter() {
  const select = document.getElementById('fieldAction');
  select.innerHTML = `<option value="">All Actions</option>` +
    Object.entries(ACTION_LABELS).map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
}

function applyFilters() {
  currentFilters = {
    action: document.getElementById('fieldAction').value,
    start: document.getElementById('fieldStart').value,
    end: document.getElementById('fieldEnd').value
  };
  loadPage(true);
}

async function loadPage(reset) {
  if (reset) {
    offset = 0;
    document.getElementById('logsBody').innerHTML = `<tr><td colspan="4" class="empty-state">Loading...</td></tr>`;
  }

  let query = supabase
    .from('audit_logs')
    .select('id, action, target_type, target_id, metadata, created_at, profiles(full_name)')
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (currentFilters.action) query = query.eq('action', currentFilters.action);
  if (currentFilters.start) query = query.gte('created_at', currentFilters.start);
  if (currentFilters.end) query = query.lte('created_at', currentFilters.end + 'T23:59:59');

  const { data, error } = await query;

  if (error) {
    document.getElementById('logsBody').innerHTML = `<tr><td colspan="4" class="empty-state">Could not load audit logs.</td></tr>`;
    return;
  }

  const rowsHtml = (data || []).map(row => `
    <tr>
      <td>${new Date(row.created_at).toLocaleString()}</td>
      <td class="audit-actor">${escapeHtml(row.profiles?.full_name || 'System')}</td>
      <td><span class="audit-action-tag">${escapeHtml(ACTION_LABELS[row.action] || row.action)}</span></td>
      <td>
        ${row.target_type ? `${escapeHtml(row.target_type)}${row.target_id ? ` · ${row.target_id.slice(0, 8)}…` : ''}` : '—'}
        <div class="audit-meta">${escapeHtml(formatMetadata(row.action, row.metadata))}</div>
      </td>
    </tr>
  `).join('');

  if (reset) {
    document.getElementById('logsBody').innerHTML = rowsHtml || `<tr><td colspan="4" class="empty-state">No audit log entries match these filters.</td></tr>`;
  } else {
    document.getElementById('logsBody').insertAdjacentHTML('beforeend', rowsHtml);
  }

  offset += PAGE_SIZE;
  document.getElementById('loadMoreBtn').style.display = (data && data.length === PAGE_SIZE) ? 'inline-flex' : 'none';
}

function formatMetadata(action, m) {
  if (!m) return '';
  switch (action) {
    case 'roster_imported':
      return `Imported ${m.imported ?? 0} students${m.failed ? `, ${m.failed} failed` : ''}${m.file_name ? ` from "${m.file_name}"` : ''}`;
    case 'registration_rejected':
      return m.reason ? `Reason: ${m.reason}` : 'No reason given';
    case 'attendance_closed':
      return `Present ${m.present ?? 0} · Late ${m.late ?? 0} · Absent ${m.absent ?? 0} · Excused ${m.excused ?? 0}`;
    case 'attendance_manual_set':
      return `${m.old_status ?? 'Not Recorded'} → ${m.new_status}`;
    case 'registration_approved':
      return 'QR code generated, student activated';
    case 'qr_regenerated':
      return 'New QR token issued';
    case 'qr_revoked':
      return 'QR token cleared';
    default:
      return Object.keys(m).length ? JSON.stringify(m) : '';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
