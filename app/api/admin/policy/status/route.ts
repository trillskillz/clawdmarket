import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const REPO = 'trillskillz/clawdmarket';

async function latestRun(workflowFile: string) {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/runs?per_page=1`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    next: { revalidate: 120 },
  });

  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json();
  const run = data.workflow_runs?.[0];
  if (!run) return { ok: true, run: null };

  return {
    ok: true,
    run: {
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      html_url: run.html_url,
      head_branch: run.head_branch,
      head_sha: run.head_sha,
      updated_at: run.updated_at,
    },
  };
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  const error = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null);
  if (error) return error;

  try {
    const [releaseGate, e2e] = await Promise.all([latestRun('release-gate.yml'), latestRun('e2e.yml')]);

    return NextResponse.json({
      repo: REPO,
      requiredChecks: ['Release Gate / verify', 'E2E Tests / e2e'],
      workflows: {
        releaseGate,
        e2e,
      },
      deployment: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
        env: process.env.VERCEL_ENV || null,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Policy status error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
