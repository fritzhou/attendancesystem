// /js/class-schedules.js

import { supabase } from './supabaseClient.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let classAssignmentId = null;

export async function initClassSchedulesPage() {
  classAssignmentId = new URLSearchParams(window.location.search).get('id');
  if (!classAssignmentId) {
    document.getElementById('pageSub').textContent = 'No class assignment specified.';
    return;
  }

  await loadHeader();
  await loadSlots();
  document.getElementById('addForm').addEventListener('submit', handleAdd);
}

async function loadHeader() {
  const { data, error } = await supabase
    .from('class_assignments')
    .select(`
      subjects(subject_code, subject_name),
      sections(grade_level, section_name, strands(code)),
      teachers(profiles(full_name))
    `)
    .eq('id', classAssignmentId)
    .single();

  if (error || !data) {
    document.getElementById('pageSub').textContent = 'Class assignment not found.';
    return;
  }

  document.getElementById('pageTitle').textContent =
    `${data.subjects.subject_code} – Grade ${data.sections.grade_level} ${data.sections.strands.code}/${data.sections.section_name}`;
  document.getElementById('pageSub').textContent = `Teacher: ${data.teachers.profiles.full_name}`;
}

async function loadSlots() {
  const list = document.getElementById('slotsList');
  list.innerHTML = `<div class="empty-state">Loading...</div>`;

  const { data, error } = await supabase
    .from('class_schedules')
    .select('id, day_of_week, start_time, end_time')
    .eq('class_assignment_id', classAssignmentId)
    .order('day_of_week')
    .order('start_time');

  if (error) { list.innerHTML = `<div class="empty-state">Could not load schedule.</div>`; return; }
  if (data.length === 0) { list.innerHTML = `<div class="empty-state">No schedule slots yet. Add one below.</div>`; return; }

  list.innerHTML = data.map(slot => `
    <div class="slot-row">
      <span class="slot-day">${DAY_NAMES[slot.day_of_week]}</span>
      <span class="slot-time">${formatTime(slot.start_time)} – ${formatTime(slot.end_time)}</span>
      <button class="btn btn-danger btn-sm" data-delete="${slot.id}">Remove</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteSlot(btn.dataset.delete)));
}

async function handleAdd(e) {
  e.preventDefault();
  const errorBox = document.getElementById('formError');
  errorBox.style.display = 'none';

  const day_of_week = parseInt(document.getElementById('fieldDay').value, 10);
  const start_time = document.getElementById('fieldStart').value;
  const end_time = document.getElementById('fieldEnd').value;

  if (!start_time || !end_time) return;
  if (end_time <= start_time) { showError('End time must be after start time.'); return; }

  const { error } = await supabase.from('class_schedules').insert({
    class_assignment_id: classAssignmentId, day_of_week, start_time, end_time
  });

  if (error) {
    showError(error.message.includes('duplicate')
      ? 'A slot already starts at that exact time on that day.'
      : 'Could not save. Please try again.');
    return;
  }

  await loadSlots();
}

async function deleteSlot(id) {
  if (!confirm('Remove this schedule slot?')) return;
  const { error } = await supabase.from('class_schedules').delete().eq('id', id);
  if (error) { alert('Could not remove this slot.'); return; }
  await loadSlots();
}

function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function showError(msg) {
  const errorBox = document.getElementById('formError');
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}
