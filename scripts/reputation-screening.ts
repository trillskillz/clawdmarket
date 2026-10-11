// Disposable local rehearsal. Production scheduling is a separate operator step.
async function main(){
const url=process.env.TURSO_DATABASE_URL??''
if(!/^file:\/tmp\/clawdmarket-workspace-test-/.test(url)||process.env.TURSO_AUTH_TOKEN)throw Error('This screening rehearsal requires an isolated local test database')
const {runReputationScreening}=await import('../lib/reputation-screening-store')
const {db}=await import('../lib/db')
try{const result=await runReputationScreening()
console.log(JSON.stringify({run_id:result.run.id,status:result.run.status,statistics:JSON.parse(result.run.statistics_json),queued_cases:result.queued_cases,idempotent:result.idempotent}))}finally{db.$client.close()}
}
main().catch(()=>{console.error('REPUTATION_SCREENING_REHEARSAL_UNAVAILABLE');process.exitCode=1})

export {}
