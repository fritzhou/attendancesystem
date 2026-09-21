// /js/teacher-classes.js — "My Classes": read-only list of this teacher's class assignments + schedule

import { supabase } from './supabaseClient.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function initTeacherClassesPage(profile) {
  const { data: teacherRow } = await supabase.from('teachers').select('id').eq('profile_id', profile.id).single();
  if (!teacherRow) {
    document.getElementById('classesList').innerHTML = `<div class="empty-state">No teacher record found for this account.</div>`;
    return;
  }

  const { data: assignments, error } = await supabase
    .from('class_assignments')
    .select(`
      id,
      subjects(subject_code, subject_name),
      sections(grade_level, section_name, strands(code)),
      semesters(name, school_years(name)),
      class_schedules(day_of_week, start_time, end_time)
    `)
    .eq('teacher_id', teacherRow.id)
    .order('id');

  const list = document.getElementById('classesList');

  if (error || !assignments || assignments.length === 0) {
    list.innerHTML = `<div class="empty-state">You have no class assignments yet. Ask an admin to assign you a class.</div>`;
    return;
  }

  list.innerHTML = assignments.map(a => {
    const slots = (a.class_schedules || []).slice().sort((x, y) => x.day_of_week - y.day_of_week || x.start_time.localeCompare(y.start_time));
    const scheduleText = slots.length
      ? slots.map(s => `${DAY_NAMES[s.day_of_week]} ${formatTime(s.start_time)}–${formatTime(s.end_time)}`).join(' · ')
      : 'No schedule set yet';

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="class-row-subject" style="font-size:16px;">${escapeHtml(a.subjects.subject_code)} – ${escapeHtml(a.subjects.subject_name)}</div>
        <div class="class-row-section" style="margin-top:4px;">Grade ${a.sections.grade_level} – ${escapeHtml(a.sections.strands.code)} / ${escapeHtml(a.sections.section_name)}</div>
        <div class="text-muted" style="margin-top:6px;">${escapeHtml(a.semesters.school_years.name)} – ${escapeHtml(a.semesters.name)}</div>
        <div class="text-muted" style="margin-top:6px;">🗓️ ${escapeHtml(scheduleText)}</div>
      </div>
    `;
  }).join('');
}

function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')}${period}`;
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
