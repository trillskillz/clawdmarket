/** Trusted external host launcher. Refuse execution without effective kernel limits. */
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function assertResourceControls(controls) {
  const bounded = (value, ceiling) => /^\d+$/.test(value.trim()) && BigInt(value.trim()) > 0n && BigInt(value.trim()) <= BigInt(ceiling)
  const cpu = controls.cpu.trim().split(/\s+/)
  if (!bounded(controls.memory, 134_217_728) || controls.swap.trim() !== '0' || !bounded(controls.tasks, 32)
    || cpu.length !== 2 || !/^\d+$/.test(cpu[1]) || !bounded(cpu[0], BigInt(cpu[1])) ) throw new Error('VERIFIER_RESOURCE_LIMITS_UNAVAILABLE')
}

async function main() {
  const membership = (await readFile('/proc/self/cgroup', 'utf8')).split('\n').find((line) => line.startsWith('0::'))?.slice(3)
  if (!membership?.startsWith('/') || membership.split('/').includes('..')) throw new Error('VERIFIER_CGROUP_UNAVAILABLE')
  const root = `/sys/fs/cgroup${membership}`
  const [memory, swap, tasks, cpu] = await Promise.all(['memory.max', 'memory.swap.max', 'pids.max', 'cpu.max'].map((name) => readFile(`${root}/${name}`, 'utf8')))
  assertResourceControls({ memory, swap, tasks, cpu })
  const child = spawn('/usr/bin/bwrap', process.argv.slice(2), { stdio: 'inherit' })
  await new Promise((done, reject) => { child.once('error', reject); child.once('close', (code) => { process.exitCode = code ?? 1; done() }) })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  process.stderr.write('VERIFIER_SANDBOX_UNAVAILABLE\n'); process.exitCode = 1
})
