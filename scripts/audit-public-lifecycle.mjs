// Read-only public evidence. No credentials, registrations, payments or cron calls.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const output = resolve(process.argv[2] || '/tmp/clawdmarket-public-lifecycle')
const origin = 'https://www.clawdmkt.com'
await mkdir(output, { recursive: true })
const evidence = { observed_at: new Date().toISOString(), origin, requests: [], renders: [] }
for (const path of ['/api/health', '/api/health/ready', '/api/payments/config', '/api/stats', '/api/agents/list?limit=5', '/api/services?limit=5', '/api/listings?limit=5', '/api/tasks?status=open&limit=5', '/api/agent']) {
  try {
    const response = await fetch(origin + path, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30000) })
    const body = await response.json().catch(() => null)
    evidence.requests.push({ path, status: response.status, observed_at: new Date().toISOString(), body })
  } catch (error) { evidence.requests.push({ path, error: String(error), body: null }) }
}
await writeFile(resolve(output, 'public-api.json'), JSON.stringify(evidence, null, 2) + '\n')
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true })
try {
  const agents = evidence.requests.find(request => request.path.startsWith('/api/agents/list'))?.body?.agents
  const profile = agents?.[0]?.id
  for (const width of [320, 390, 768, 1440, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      return ['GET', 'HEAD'].includes(request.method()) && [origin, 'https://clawdmkt.com'].includes(url.origin) ? route.continue() : route.abort()
    })
    for (const path of ['/', '/registry', '/marketplace', '/observe', '/docs', ...(profile ? [`/registry/${encodeURIComponent(profile)}`] : [])]) {
      const page = await context.newPage()
      try {
        const response = await page.goto('https://clawdmkt.com' + path, { waitUntil: 'domcontentloaded', timeout: 30000 })
        // The application polls; networkidle is not a render-completion signal.
        await page.waitForFunction(() => document.styleSheets.length > 0 && getComputedStyle(document.body).backgroundColor === 'rgb(8, 10, 9)', { timeout: 20000 })
        await page.evaluate(() => document.fonts.ready)
        await page.locator('h1').first().waitFor({ timeout: 20000 })
        if (path === '/registry') await page.locator('a[href^="/registry/"]').first().waitFor({ timeout: 20000 })
        // Trigger the site's existing intersection animations before a full-page
        // capture, then return to the top. No UI mutation or API write occurs.
        await page.evaluate(async () => {
          const height = Math.min(document.documentElement.scrollHeight, 20000)
          for (let y = 0; y < height; y += 800) { scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 30)) }
          scrollTo(0, 0)
        })
        const name = `${path === '/' ? 'home' : path.slice(1).replaceAll('/', '-')}-${width}.png`
        await page.screenshot({ path: resolve(output, name), fullPage: true, animations: 'disabled' })
        evidence.renders.push({ path, width, status: response?.status(), final_url: page.url(), screenshot: name,
          ...await page.evaluate(() => ({ title: document.title, overflow: document.documentElement.scrollWidth > innerWidth,
            fonts: document.fonts.status, stylesheet_count: document.styleSheets.length, background: getComputedStyle(document.body).backgroundColor,
            h1: [...document.querySelectorAll('h1')].map(node => node.textContent) })) })
      } catch (error) { evidence.renders.push({ path, width, error: String(error) }) }
      await page.close()
      await writeFile(resolve(output, 'public-api.json'), JSON.stringify(evidence, null, 2) + '\n')
    }
    await context.close()
  }
} finally {
  await browser.close()
  await writeFile(resolve(output, 'public-api.json'), JSON.stringify(evidence, null, 2) + '\n')
}
console.log(JSON.stringify({ output, api: evidence.requests.map(({ path, status, error }) => ({ path, status, error })), renders: evidence.renders.length, failures: evidence.renders.filter(row => row.error || row.overflow) }, null, 2))
