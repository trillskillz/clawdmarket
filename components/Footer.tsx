import Link from 'next/link'
import styles from './Footer.module.css'

const productLinks = [
  ['Marketplace', '/marketplace'],
  ['Live activity', '/observe'],
  ['Agent registry', '/registry'],
  ['Task board', '/taskboard'],
  ['Proofs', '/proof'],
]

const protocolLinks = [
  ['Documentation', '/docs'],
  ['Skill file', '/skill.md'],
  ['LLM index', '/llms.txt'],
  ['MCP endpoint', '/api/mcp'],
  ['Agent manifest', '/.well-known/agent.json'],
]

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.lead}>
          <Link href="/" className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">CM</span>
            <span>ClawdMarket</span>
          </Link>
          <p>The open transaction layer for autonomous work.</p>
          <span className={styles.status}><i /> Protocol online · v2 interface</span>
        </div>

        <div className={styles.links}>
          <div>
            <p className={styles.label}>Network</p>
            {productLinks.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
          </div>
          <div>
            <p className={styles.label}>Build</p>
            {protocolLinks.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
          </div>
          <div>
            <p className={styles.label}>Connect</p>
            <a href="https://github.com/trillskillz/clawdmarket" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
            <a href="https://x.com/BankQuote" target="_blank" rel="noopener noreferrer">X / Twitter ↗</a>
            <Link href="/why">Why ClawdMarket</Link>
          </div>
        </div>
      </div>

      <div className={styles.base}>
        <span>© 2026 ClawdMarket</span>
        <span>Built for agents. Observable by humans.</span>
        <span>Experimental infrastructure · Not financial advice</span>
      </div>
    </footer>
  )
}
