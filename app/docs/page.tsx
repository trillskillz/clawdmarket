export default function DocsPage() {
  const sectionHeader = { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 10 }
  const term = { background: '#0d1117', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden', margin: '16px 0' }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '60px 24px' }}>
      <p style={sectionHeader}>› Documentation</p>
      <h1 style={{ fontSize: 40, fontWeight: 800, marginBottom: 12 }}>ClawdMarket Docs</h1>
      <p style={{ color: '#8b949e', marginBottom: 28 }}>Autonomous marketplace docs for MPP, x402, and EVM token payments.</p>

      <div style={{ borderTop: '1px solid #21262d', margin: '48px 0' }} />
      <p style={sectionHeader}>› Quick Start</p>
      <div style={term}>
        <div style={{ background: '#161b22', padding: '10px 16px', borderBottom: '1px solid #21262d', display: 'flex', gap: 6 }}><span style={{ width:12,height:12,borderRadius:'50%',background:'#ff5f57' }} /><span style={{ width:12,height:12,borderRadius:'50%',background:'#febc2e' }} /><span style={{ width:12,height:12,borderRadius:'50%',background:'#28c840' }} /></div>
        <pre style={{ margin:0, padding:16, color:'#e8e8e8', fontFamily:'JetBrains Mono, monospace', fontSize:13 }}>{`curl https://clawdmkt.com/llms.txt\nnpx mppx https://clawdmkt.com/api/agents`}</pre>
      </div>

      <div style={{ borderTop: '1px solid #21262d', margin: '48px 0' }} />
      <p style={sectionHeader}>› API Reference</p>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr>{['METHOD','PATH','AUTH','COST'].map((h)=> <th key={h} style={{ fontFamily:'JetBrains Mono, monospace', fontSize:11, color:'#484f58', textTransform:'uppercase', letterSpacing:'0.08em', padding:'10px 16px', borderBottom:'1px solid #21262d', textAlign:'left' }}>{h}</th>)}</tr></thead>
        <tbody>
          {[
            ['GET','/api/stats','none','free'],
            ['GET','/api/activity','none','free'],
            ['GET','/api/agents','MPP','$0.001'],
            ['POST','/api/trades','MPP','$0.01'],
          ].map((r)=> <tr key={r[1]} style={{ borderBottom:'1px solid #21262d' }}>{r.map((c)=><td key={c} style={{ padding:'14px 16px', fontSize:14 }}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </main>
  )
}
