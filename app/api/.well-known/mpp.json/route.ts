import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-static';
export const revalidate = 3600;

export async function GET() {
  const filePath = path.join(process.cwd(), 'public', '.well-known', 'mpp.json');
  const content = await readFile(filePath, 'utf8');

  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
