export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const configured = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return configured.includes(email.toLowerCase());
}
