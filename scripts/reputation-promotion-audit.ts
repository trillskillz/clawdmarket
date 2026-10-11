import { writeFile } from 'node:fs/promises'
async function main(){
const url=process.env.TURSO_DATABASE_URL??''
const production=process.env.REPUTATION_AUDIT_SOURCE==='production'
if(production?(!url.startsWith('libsql://')||!process.env.TURSO_AUTH_TOKEN):(!url.startsWith('file:/tmp/clawdmarket-workspace-test-')||Boolean(process.env.TURSO_AUTH_TOKEN)))throw Error('Explicit production credentials or a disposable local audit database required')
const {inspectReputationPromotion}=await import('../lib/reputation-promotion-audit')
const {db}=await import('../lib/db')
try {
  const report=await inspectReputationPromotion()
  await writeFile(process.env.REPUTATION_AUDIT_OUTPUT??'reputation-promotion-report.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({promotion_ready:report.promotion_ready,blockers:report.blockers,coverage:report.coverage,default_ranking_changed:false}))
} finally {db.$client.close()}
}
main().catch(()=>{console.error('REPUTATION_PROMOTION_AUDIT_UNAVAILABLE');process.exitCode=1})
export {}
