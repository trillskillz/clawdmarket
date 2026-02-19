import { NextRequest } from 'next/server';
import crypto from 'crypto';

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function validateCsrf(req: NextRequest): boolean {
  const headerToken = req.headers.get('x-csrf-token');
  const cookieToken = req.cookies.get('csrf-token')?.value;
  
  if (!headerToken || !cookieToken) {
    return false;
  }

  if (headerToken.length !== cookieToken.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(
    Buffer.from(headerToken),
    Buffer.from(cookieToken)
  );
}
