// /js/qr.js
// Renders one QR card. Expects the global `QRCode` library
// (qrcodejs) to already be loaded via a <script> tag on the page.

import { SCHOOL_NAME } from './config.js';

export function renderQrCard(container, { studentName, studentNumber, gradeStrandSection, token }) {
  const codeId = `qr_${token.replace(/[^a-zA-Z0-9]/g, '')}`;

  container.innerHTML = `
    <div class="qr-card">
      <div class="qr-card-school">${escapeHtml(SCHOOL_NAME)}</div>
      <div class="qr-card-code" id="${codeId}"></div>
      <div class="qr-card-name">${escapeHtml(studentName)}</div>
      <div class="qr-card-number">Student No: ${escapeHtml(studentNumber)}</div>
      <div class="qr-card-section">${escapeHtml(gradeStrandSection)}</div>
    </div>
  `;

  new QRCode(document.getElementById(codeId), {
    text: token,
    width: 150,
    height: 150,
    correctLevel: QRCode.CorrectLevel.M
  });
}

export function gradeStrandSectionLabel(enr) {
  if (!enr) return 'Not enrolled';
  return `Grade ${enr.grade_level} – ${enr.strands.code} / ${enr.section_name}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
