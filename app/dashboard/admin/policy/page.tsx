'use client';

import { useEffect, useState } from 'react';
import PageShell from '@/components/PageShell';

type Run = {
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  head_branch: string;
  head_sha: string;
  updated_at: string;
};

type WorkflowStatus = {
  ok: boolean;
  status?: number;
  run?: Run | null;
};

export default function PolicyStatusPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/policy/status', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load policy status');
        setData(await res.json());
      } catch (e: any) {
        setError(e.message || 'Error loading status');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const badge = (wf?: WorkflowStatus) => {
    if (!wf) return 'bg-bg2 text-text-dim';
    if (!wf.ok) return 'bg-red-900/40 text-red-300';
    if (!wf.run) return 'bg-bg2 text-text-dim';
    if (wf.run.conclusion === 'success') return 'bg-emerald-900/40 text-emerald-300';
    if (wf.run.conclusion === 'failure') return 'bg-red-900/40 text-red-300';
    return 'bg-amber-900/40 text-amber-300';
  };

  const label = (wf?: WorkflowStatus) => {
    if (!wf) return 'unknown';
    if (!wf.ok) return `api ${wf.status}`;
    if (!wf.run) return 'no runs';
    return wf.run.conclusion || wf.run.status;
  };

  return (
    <PageShell>
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Policy Drift Dashboard</h1>
          <p className="text-text-dim">Release gates, required checks, and policy status for ClawdMarket.</p>
        </div>

        {loading ? (
          <div className="animate-pulse h-24 bg-bg2 rounded-xl" />
        ) : error ? (
          <div className="card text-red-300">{error}</div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="card">
                <div className="text-sm text-text-dim mb-1">Release Gate</div>
                <div className={`inline-flex px-2 py-1 rounded text-xs mb-2 ${badge(data?.workflows?.releaseGate)}`}>{label(data?.workflows?.releaseGate)}</div>
                {data?.workflows?.releaseGate?.run?.html_url && (
                  <a className="text-accent2 text-sm" href={data.workflows.releaseGate.run.html_url} target="_blank" rel="noopener noreferrer">Open latest run →</a>
                )}
              </div>

              <div className="card">
                <div className="text-sm text-text-dim mb-1">E2E Tests</div>
                <div className={`inline-flex px-2 py-1 rounded text-xs mb-2 ${badge(data?.workflows?.e2e)}`}>{label(data?.workflows?.e2e)}</div>
                {data?.workflows?.e2e?.run?.html_url && (
                  <a className="text-accent2 text-sm" href={data.workflows.e2e.run.html_url} target="_blank" rel="noopener noreferrer">Open latest run →</a>
                )}
              </div>
            </div>

            <div className="card">
              <h2 className="text-lg font-semibold mb-2">Required checks</h2>
              <ul className="list-disc pl-5 text-text-dim space-y-1">
                {(data?.requiredChecks || []).map((c: string) => <li key={c}>{c}</li>)}
              </ul>
            </div>

            <div className="card">
              <h2 className="text-lg font-semibold mb-2">Deployment context</h2>
              <p className="text-sm text-text-dim">Repo: {data?.repo}</p>
              <p className="text-sm text-text-dim">Env: {data?.deployment?.env || 'unknown'}</p>
              <p className="text-sm text-text-dim">Commit: {data?.deployment?.commit || 'unknown'}</p>
              <p className="text-xs text-text-dim mt-2">Last refresh: {data?.generatedAt}</p>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
