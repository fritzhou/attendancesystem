// /js/scanner.js
// Expects the global `Html5Qrcode` (html5-qrcode) loaded via <script> tag.

import { supabase } from './supabaseClient.js';

let html5QrCode = null;
let sessionId = null;
let isProcessing = false;
let stats = { present: 0, late: 0, absent: 0, excused: 0 };
let liveList = [];

export async function initScannerPage() {
  sessionId = new URLSearchParams(window.location.search).get('session');
  if (!sessionId) {
    document.getElementById('scannerStatus').textContent = 'No attendance session specified.';
    return;
  }

  const ok = await loadSessionInfo();
  if (ok) await startCamera();

  document.getElementById('manualBtn').addEventListener('click', () => {
    window.location.href = `/teacher/attendance-manual.html?session=${sessionId}`;
  });
  document.getElementById('closeSessionBtn').addEventListener('click', () => {
    window.location.href = `/teacher/attendance-close.html?session=${sessionId}`;
  });
}

async function loadSessionInfo() {
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select(`
      id, status, late_after,
      class_assignments (
        subjects(subject_code, subject_name),
        sections(grade_level, section_name, strands(code))
      )
    `)
    .eq('id', sessionId)
    .single();

  if (error || !data) {
    document.getElementById('scannerStatus').textContent = 'Session not found.';
    return false;
  }
  if (data.status !== 'OPEN') {
    document.getElementById('scannerStatus').textContent = 'This attendance session is closed.';
    return false;
  }

  const ci = data.class_assignments;
  document.getElementById('classTitle').textContent =
    `${ci.subjects.subject_code} – Grade ${ci.sections.grade_level} ${ci.sections.strands.code}/${ci.sections.section_name}`;
  document.getElementById('lateAfterLabel').textContent =
    `Late after ${new Date(data.late_after).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  await loadExistingRecords();
  return true;
}

async function loadExistingRecords() {
  const { data } = await supabase
    .from('attendance_records')
    .select('status, time_in, students(full_name, student_number)')
    .eq('attendance_session_id', sessionId)
    .order('time_in');

  stats = { present: 0, late: 0, absent: 0, excused: 0 };
  liveList = (data || []).map(r => {
    const key = r.status.toLowerCase();
    stats[key] = (stats[key] || 0) + 1;
    return { name: r.students.full_name, number: r.students.student_number, status: r.status, time: r.time_in };
  }).reverse();

  renderStats();
  renderLiveList();
}

async function startCamera() {
  html5QrCode = new Html5Qrcode('qr-reader');
  try {
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      onScanSuccess,
      () => {}
    );
  } catch (err) {
    document.getElementById('scannerStatus').textContent =
      'Could not access the camera. Check permissions and try again.';
  }
}

async function onScanSuccess(decodedText) {
  if (isProcessing) return;
  isProcessing = true;

  try { await html5QrCode.pause(true); } catch (e) {}

  const { data, error } = await supabase.rpc('record_attendance_scan', {
    p_session_id: sessionId, p_qr_token: decodedText
  });

  if (error) {
    showConfirmation({ success: false, code: 'ERROR', message: 'Network error. Please try again.' }, null);
  } else {
    let photoUrl = null;
    if ((data.success || data.code === 'ALREADY_RECORDED') && data.photo_url) {
      photoUrl = await getSignedPhotoUrl(data.photo_url);
    }
    showConfirmation(data, photoUrl);

    if (data.success) {
      const key = data.status.toLowerCase();
      stats[key] = (stats[key] || 0) + 1;
      liveList.unshift({ name: data.student_name, number: data.student_number, status: data.status, time: data.time_in });
      renderStats();
      renderLiveList();
    }
  }

  setTimeout(async () => {
    hideConfirmation();
    try { html5QrCode.resume(); } catch (e) {}
    isProcessing = false;
  }, 1800);
}

async function getSignedPhotoUrl(path) {
  const { data } = await supabase.storage.from('student-photos').createSignedUrl(path, 120);
  return data?.signedUrl || null;
}

function showConfirmation(result, photoUrl) {
  const overlay = document.getElementById('confirmOverlay');
  const box = document.getElementById('confirmBox');

  if (result.success) {
    box.className = `confirm-box confirm-${result.status.toLowerCase()}`;
    box.innerHTML = `
      <div class="confirm-status">${result.status}</div>
      ${photoUrl ? `<img class="confirm-photo" src="${photoUrl}" alt="">` : ''}
      <div class="confirm-name">${escapeHtml(result.student_name)}</div>
      <div class="confirm-number">${escapeHtml(result.student_number)}</div>
      <div class="confirm-time">${formatTime(result.time_in)}</div>
    `;
  } else {
    const cls = result.code === 'ALREADY_RECORDED' ? 'confirm-already' : 'confirm-error';
    box.className = `confirm-box ${cls}`;
    box.innerHTML = `
      <div class="confirm-status">${result.code === 'ALREADY_RECORDED' ? 'ALREADY RECORDED' : 'NOT RECORDED'}</div>
      ${photoUrl ? `<img class="confirm-photo" src="${photoUrl}" alt="">` : ''}
      ${result.student_name ? `<div class="confirm-name">${escapeHtml(result.student_name)}</div>` : ''}
      <div class="confirm-message">${escapeHtml(result.message)}</div>
      ${result.status ? `<div class="confirm-time">${result.status} – ${formatTime(result.time_in)}</div>` : ''}
    `;
  }

  overlay.classList.add('visible');
}

function hideConfirmation() {
  document.getElementById('confirmOverlay').classList.remove('visible');
}

function renderStats() {
  document.getElementById('statPresent').textContent = stats.present;
  document.getElementById('statLate').textContent = stats.late;
  document.getElementById('statAbsent').textContent = stats.absent;
  document.getElementById('statExcused').textContent = stats.excused;
}

function renderLiveList() {
  const list = document.getElementById('liveList');
  if (liveList.length === 0) {
    list.innerHTML = `<div class="empty-state">No scans yet.</div>`;
    return;
  }
  list.innerHTML = liveList.slice(0, 30).map(r => `
    <div class="live-row">
      <span>${escapeHtml(r.name)}</span>
      <span class="live-number">${escapeHtml(r.number)}</span>
      <span class="badge ${badgeClass(r.status)}">${r.status}</span>
      <span class="live-time">${formatTime(r.time)}</span>
    </div>
  `).join('');
}

function badgeClass(status) {
  const map = { PRESENT: 'badge-present', LATE: 'badge-late', ABSENT: 'badge-absent', EXCUSED: 'badge-excused' };
  return map[status] || 'badge-excused';
}
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
