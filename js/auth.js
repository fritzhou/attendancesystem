// /js/auth.js
// Core sign-in/out helpers and profile lookup. Every other script
// that needs to know "who is logged in" goes through this file.

import { supabase } from './supabaseClient.js';

/**
 * Signs a user in with email + password.
 * Returns { profile } on success, throws an Error with a friendly
 * message on failure.
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  });

  if (error) {
    throw new Error('Incorrect email or password.');
  }

  const profile = await getCurrentProfile();

  if (!profile) {
    await supabase.auth.signOut();
    throw new Error('No account profile found for this login. Contact an administrator.');
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    throw new Error('This account has been deactivated. Contact an administrator.');
  }

  return { profile };
}

export async function signOut() {
  await supabase.auth.signOut();
}

/**
 * Returns the current Supabase auth session, or null if logged out.
 */
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Returns the profiles row (id, full_name, email, role, is_active)
 * for the currently logged-in user, or null if not logged in or
 * no matching profile exists.
 */
export async function getCurrentProfile() {
  const session = await getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active')
    .eq('id', session.user.id)
    .single();

  if (error) return null;
  return data;
}

/**
 * Where to send a user right after a successful login,
 * based on their role.
 */
const APP_ROOT = new URL('../', import.meta.url);

export function appUrl(path = '') {
  return new URL(path, APP_ROOT).href;
}

export function dashboardPathForRole(role) {
  if (role === 'admin') return appUrl('admin/dashboard.html');
  if (role === 'teacher') return appUrl('teacher/dashboard.html');
  return appUrl('index.html');
}
