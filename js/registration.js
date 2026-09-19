// /js/registration.js
// Shared by /register.html and /registration-status.html.
// Lookup and submit go through the "public-registration" Edge
// Function instead of calling the database RPCs directly, so every
// public attempt is rate-limited by IP before it reaches the database.

import { supabase } from './supabaseClient.js';

async function callPublicRegistrationFn(payload) {
  const { data, error } = await supabase.functions.invoke('public-registration', { body: payload });

  if (error) {
    let message = 'Something went wrong. Please try again.';
    try {
      const parsed = await error.context?.json?.();
      if (parsed?.error) message = parsed.error;
    } catch (e) {
      // fall back to the generic message
    }
    throw new Error(message);
  }

  if (data?.error) throw new Error(data.error);
  return data;
}

export async function lookupStudent(studentNumber) {
  return callPublicRegistrationFn({ action: 'lookup', student_number: studentNumber.trim() });
}

export async function uploadRegistrationPhoto(studentNumber, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `pending/${studentNumber.trim()}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from('student-photos')
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (error) throw new Error('Could not upload photo. Please try again.');
  return path;
}

export async function submitRegistration(studentNumber, photoPath) {
  return callPublicRegistrationFn({
    action: 'submit', student_number: studentNumber.trim(), photo_path: photoPath
  });
}

export function validatePhotoFile(file) {
  const MAX_SIZE = 5 * 1024 * 1024;
  if (!file.type.startsWith('image/')) return 'Please choose an image file.';
  if (file.size > MAX_SIZE) return 'Photo must be smaller than 5MB.';
  return null;
}

/** Returns a blocking message if this status can't register right now, or null if it can. */
export function blockingMessage(status) {
  switch (status) {
    case 'UNREGISTERED':
    case 'REJECTED':
      return null;
    case 'PENDING':
      return 'This student number already has a registration pending review. Please wait for approval.';
    case 'VERIFIED':
      return 'This student is verified and their QR code is being prepared.';
    case 'ACTIVE':
      return 'This student is already registered and active.';
    case 'ARCHIVED':
      return 'This student record is archived. Please contact the admin office.';
    default:
      return 'This student cannot register at this time. Please contact the admin office.';
  }
}

export function statusLabel(status) {
  const labels = {
    UNREGISTERED: 'Not Registered', PENDING: 'Pending Review', VERIFIED: 'Verified',
    REJECTED: 'Rejected', ACTIVE: 'Active', ARCHIVED: 'Archived'
  };
  return labels[status] || status;
}

export function statusBadgeClass(status) {
  const map = {
    PENDING: 'badge-pending', ACTIVE: 'badge-present', VERIFIED: 'badge-present',
    REJECTED: 'badge-absent', ARCHIVED: 'badge-excused', UNREGISTERED: 'badge-excused'
  };
  return map[status] || 'badge-excused';
}
