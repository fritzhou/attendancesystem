// /js/registrations.js
// Shared by /admin/registrations.html and /teacher/registrations.html

import { supabase } from './supabaseClient.js';

let selectedIds = new Set();

export async function initRegistrationsPage() {
  await loadPending();

  document.getElementById('selectAll').addEventListener('change', handleSelectAll);
  document.getElementById('bulkApproveBtn').addEventListener('click', () => bulkAction('approve'));
  document.getElementById('bulkRejectBtn').addEventListener('click', () => bulkAction('reject'));
  document.getElementById('modalOverlay').addEventListener('click', closeModal);
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
}

async function loadPending() {
  const tbody = document.getElementById('regBody');
  tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Loading...</td></tr>`;
  selectedIds.clear();
  updateBulkBar();

  const { data: regs, error } = await supabase
    .from('student_registrations')
    .select('id, submitted_photo_url, submitted_at, students(id, student_number, full_name)')
    .eq('status', 'PENDING')
    .order('submitted_at', { ascending: true });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Could not load registrations.</td></tr>`;
    return;
  }
  if (regs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No pending registrations right now.</td></tr>`;
    document.getElementById('selectAll').checked = false;
    return;
  }

  const studentIds = regs.map(r => r.students.id);
  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('student_id, sections(grade_level, section_name, strands(code))')
    .in('student_id', studentIds)
    .eq('enrollment_status', 'ACTIVE');

  const enrollmentByStudent = new Map(
    (enrollments || []).map(e => [e.student_id, e.sections])
  );

  const signedUrls = await Promise.all(
    regs.map(r => supabase.storage.from('student-photos').createSignedUrl(r.submitted_photo_url, 3600))
  );

  tbody.innerHTML = regs.map((r, i) => {
    const enr = enrollmentByStudent.get(r.students.id);
    const photoUrl = signedUrls[i].data?.signedUrl || '';
    const submitted = new Date(r.submitted_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

    return `
      <tr>
        <td><input type="checkbox" class="rowCheck" data-id="${r.id}"></td>
        <td><img class="photo-thumb" src="${photoUrl}" data-full="${photoUrl}" alt="Submitted photo"></td>
        <td>${escapeHtml(r.students.full_name)}</td>
        <td>${escapeHtml(r.students.student_number)}</td>
        <td>${enr ? `Grade ${enr.grade_level} – ${escapeHtml(enr.strands.code)} / ${escapeHtml(enr.section_name)}` : '<span class="text-muted">Not enrolled</span>'}</td>
        <td>${submitted}</td>
        <td>
          <button class="btn btn-primary btn-sm" data-approve="${r.id}">Approve</button>
          <button class="btn btn-danger btn-sm" data-reject="${r.id}">Reject</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.photo-thumb').forEach(img =>
    img.addEventListener('click', () => openModal(img.dataset.full)));
  tbody.querySelectorAll('.rowCheck').forEach(cb =>
    cb.addEventListener('change', () => toggleSelect(cb.dataset.id, cb.checked)));
  tbody.querySelectorAll('[data-approve]').forEach(btn =>
    btn.addEventListener('click', () => approveOne(btn.dataset.approve)));
  tbody.querySelectorAll('[data-reject]').forEach(btn =>
    btn.addEventListener('click', () => rejectOne(btn.dataset.reject)));

  document.getElementById('selectAll').checked = false;
}

function toggleSelect(id, checked) {
  if (checked) selectedIds.add(id); else selectedIds.delete(id);
  updateBulkBar();
}

function handleSelectAll(e) {
  document.querySelectorAll('.rowCheck').forEach(cb => {
    cb.checked = e.target.checked;
    toggleSelect(cb.dataset.id, e.target.checked);
  });
}

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  bar.classList.toggle('visible', selectedIds.size > 0);
  document.getElementById('bulkCount').textContent = selectedIds.size;
}

async function callReview(action, registrationId, reason) {
  const { data, error } = await supabase.functions.invoke('registration-review', {
    body: { action, registration_id: registrationId, reason }
  });

  if (error) {
    let message = 'Could not process this registration.';
    try {
      const parsed = await error.context?.json?.();
      if (parsed?.error) message = parsed.error;
    } catch (e) {}
    return { success: false, message };
  }

  if (data?.error) return { success: false, message: data.error };
  return data;
}

async function approveOne(id) {
  const data = await callReview('approve', id);
  if (!data.success) {
    alert(data?.message || 'Could not approve this registration.');
    return;
  }
  await loadPending();
}

async function rejectOne(id) {
  const reason = prompt('Reason for rejecting this registration (shown so the student can fix and resubmit):');
  if (reason === null) return;
  const data = await callReview('reject', id, reason || null);
  if (!data.success) {
    alert(data?.message || 'Could not reject this registration.');
    return;
  }
  await loadPending();
}

async function bulkAction(kind) {
  const ids = Array.from(selectedIds);
  if (ids.length === 0) return;

  let reason = null;
  if (kind === 'reject') {
    reason = prompt(`Reason for rejecting these ${ids.length} registrations:`);
    if (reason === null) return;
  } else {
    if (!confirm(`Approve ${ids.length} selected registrations? This generates a QR code for each.`)) return;
  }

  let failed = 0;
  for (const id of ids) {
    const data = await callReview(kind, id, reason);
    if (!data.success) failed++;
  }

  if (failed > 0) alert(`${ids.length - failed} succeeded, ${failed} failed. Check the list for what's left.`);
  await loadPending();
}

function openModal(url) {
  if (!url) return;
  document.getElementById('modalImg').src = url;
  document.getElementById('modalOverlay').classList.add('visible');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('visible');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
