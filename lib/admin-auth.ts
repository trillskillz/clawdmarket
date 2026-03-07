import { NextRequest, NextResponse } from 'next/server';

export function getAdminConfig() {
  const ids = (process.env.ADMIN_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
  const emails = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  return { ids, emails };
}

export function isAdmin(user: { id: string; email?: string | null }) {
  const { ids, emails } = getAdminConfig();
  if (user.id && ids.includes(user.id)) return true;
  if (user.email && emails.includes(user.email.toLowerCase())) return true;
  return false;
}

export function authorizeAdmin(auth: { userId: string; email?: string | null } | null) {
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  // Construct a user object compatible with isAdmin
  const user = { id: auth.userId, email: auth.email };
  
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null; // Authorized
}
