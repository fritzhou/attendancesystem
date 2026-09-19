// /js/permissions.js
// Route guards. Every protected page calls requireRole() at the top
// of its script before rendering anything sensitive.

import { getCurrentProfile, appUrl } from './auth.js';

/**
 * Ensures the current user is logged in AND has one of the
 * allowed roles. Redirects otherwise. Returns the profile on success
 * so the calling page can use it (e.g. to greet the user by name).
 *
 * Usage on an admin-only page (e.g. /admin/dashboard.html):
 *
 *   import { requireRole } from '../js/permissions.js';
 *   const profile = await requireRole(['admin']);
 *
 * Usage on a page any logged-in staff member can see:
 *
 *   const profile = await requireRole(['admin', 'teacher']);
 */
export async function requireRole(allowedRoles, loginPath = appUrl('index.html')) {
  const profile = await getCurrentProfile();

  if (!profile) {
    const next = encodeURIComponent(window.location.pathname);
    window.location.replace(`${loginPath}?next=${next}`);
    return null;
  }

  if (!allowedRoles.includes(profile.role)) {
    // Logged in, but wrong role for this page — send them to
    // their own dashboard rather than an error page.
    const { dashboardPathForRole } = await import('./auth.js');
    window.location.replace(dashboardPathForRole(profile.role));
    return null;
  }

  return profile;
}
