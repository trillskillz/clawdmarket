import { REPUTATION_V2_POLICY as policy, type ReputationScope } from './reputation-v2-policy'

/** Internal facts only: IDs and principal groups never appear in the public record. */
export type ReputationObservation = {
  workId: string
  group: string
  outcome: 'accepted' | 'provider_failure' | 'pending' | 'unknown'
  at: number
  recordedAt?:number|null
  rating?: number | null
  ratingAt?:number|null
  deliveryAt?: number | null
  deadlineAt?: number | null
  committedAt?: number | null
  firstPassFailure?: boolean
  methods?: string[]
  incident?: 'upheld' | 'appealed' | 'overturned' | null
  serviceVersion?:string|null
  agentVersion?:number|null
  operatorPeriod?:string|null
  seriousIncident?: boolean
  openCase?: boolean
  valueMinor?: number
}
const days = 86400000
const rounded = (n: number) => Math.round(n * 1000000) / 1000000

// Lanczos log-gamma and continued-fraction incomplete beta. Used only by the
// documented internal model estimate; never presented as a calibrated chance.
function logGamma(z: number): number {
  const c=[676.5203681218851,-1259.1392167224028,771.3234287776531,-176.6150291621406,12.507343278686905,-0.13857109526572012,9.984369578019572e-6,1.5056327351493116e-7]
  if(z<0.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z)
  z-=1;let x=0.9999999999998099;for(let i=0;i<c.length;i++)x+=c[i]/(z+i+1)
  const t=z+c.length-0.5;return 0.5*Math.log(2*Math.PI)+(z+0.5)*Math.log(t)-t+Math.log(x)
}
function betaFraction(a:number,b:number,x:number) {
  const tiny=1e-30;let c=1,d=1-(a+b)*x/(a+1);if(Math.abs(d)<tiny)d=tiny;d=1/d;let h=d
  for(let m=1;m<=200;m++){
    const step=(aa:number)=>{d=1+aa*d;if(Math.abs(d)<tiny)d=tiny;c=1+aa/c;if(Math.abs(c)<tiny)c=tiny;d=1/d;const delta=d*c;h*=delta;return delta}
    step(m*(b-m)*x/((a+2*m-1)*(a+2*m)))
    if(Math.abs(step(-(a+m)*(a+b+m)*x/((a+2*m)*(a+2*m+1)))-1)<1e-12)break
  }return h
}
function betaCdf(x:number,a:number,b:number):number {
  if(x<=0)return 0;if(x>=1)return 1
  const bt=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x))
  return x<(a+1)/(a+b+2)?bt*betaFraction(a,b,x)/a:1-bt*betaFraction(b,a,1-x)/b
}
export function lowerBetaQuantile(a:number,b:number,q=policy.ranking_quantile):number {
  let lo=0,hi=1;for(let i=0;i<64;i++){const x=(lo+hi)/2;if(betaCdf(x,a,b)<q)lo=x;else hi=x}return rounded((lo+hi)/2)
}

export function projectReputation(observations: ReputationObservation[], scope: ReputationScope, now=Date.now()) {
  const facts=[...new Map(observations.map(o=>[o.workId,o])).values()]
  const terminal=facts.filter(o=>o.outcome==='accepted'||o.outcome==='provider_failure')
  const groups=new Map<string,{total:number;success:number;failure:number;reviewWeight:number;reviewTotal:number}>()
  let latest:number|null=null
  for(const o of terminal){
    if(!Number.isFinite(o.at)||o.at>now)continue
    latest=Math.max(latest??0,o.at)
    const weight=2**(-Math.max(0,(now-o.at)/days)/policy.half_life_days)
    const g=groups.get(o.group)??{total:0,success:0,failure:0,reviewWeight:0,reviewTotal:0}
    g.total+=weight;if(o.outcome==='accepted')g.success+=weight;else g.failure+=weight
    groups.set(o.group,g)
  }
  for(const o of terminal){const at=o.ratingAt??o.at;if(o.outcome!=='accepted'||o.rating==null||o.rating<1||o.rating>5||!Number.isFinite(at)||at>now)continue
    const weight=2**(-Math.max(0,(now-at)/days)/policy.half_life_days),g=groups.get(o.group)??{total:0,success:0,failure:0,reviewWeight:0,reviewTotal:0}
    g.reviewWeight+=weight;g.reviewTotal+=o.rating*weight;groups.set(o.group,g)
  }
  let successes=0,failures=0,reviewWeight=0,reviewTotal=0,largest=0
  for(const g of groups.values()){
    const cap=Math.max(1,g.total);successes+=g.success/cap;failures+=g.failure/cap;largest=Math.max(largest,g.total/cap)
    // Reviews have their own one-group cap; missing reviews add no star or failure.
    const rw=Math.min(1,g.reviewWeight);reviewWeight+=rw;if(g.reviewWeight)reviewTotal+=rw*g.reviewTotal/g.reviewWeight
  }
  const accepted=facts.filter(o=>o.outcome==='accepted').length,providerFailures=facts.filter(o=>o.outcome==='provider_failure').length
  const weight=successes+failures,stale=latest!==null&&now-latest>policy.stale_after_days*days
  const observedGroups=new Set(terminal.map(o=>o.group)).size
  const maturity=terminal.length===0&&!facts.some(o=>o.outcome==='unknown')?'new':observedGroups>=policy.established_groups&&weight>=policy.established_weight?'established':observedGroups>=policy.developing_groups&&weight>=policy.developing_weight?'developing':'limited'
  const deadlines=facts.filter(o=>o.deliveryAt!=null&&o.deadlineAt!=null&&o.committedAt!=null&&o.deliveryAt>=o.committedAt&&o.deadlineAt>=o.committedAt)
  const latencies=deadlines.map(o=>(o.deliveryAt!-o.committedAt!)/1000).sort((a,b)=>a-b)
  const percentile=(q:number)=>latencies[Math.min(latencies.length-1,Math.ceil(q*latencies.length)-1)]
  const reviews=facts.filter(o=>o.outcome==='accepted'&&o.rating!=null)
  const verification:Record<string,number>={};for(const o of facts)for(const method of new Set(o.methods??[]))verification[method]=(verification[method]??0)+1
  const bands={'under_1_usd':0,'1_to_10_usd':0,'10_to_100_usd':0,'100_usd_and_up':0}
  for(const o of terminal){if(o.valueMinor==null)continue;const key=o.valueMinor<100?'under_1_usd':o.valueMinor<1000?'1_to_10_usd':o.valueMinor<10000?'10_to_100_usd':'100_usd_and_up';bands[key]++}
  return {
    policy_version:policy.aggregation_policy_version,evidence_eligibility_version:policy.evidence_eligibility_version,event_schema_version:policy.event_schema_version,
    computed_at:new Date(now).toISOString(),evidence_recorded_as_of:facts.some(o=>o.recordedAt!=null&&Number.isFinite(o.recordedAt))?new Date(Math.max(...facts.flatMap(o=>o.recordedAt!=null&&Number.isFinite(o.recordedAt)?[o.recordedAt]:[]))).toISOString():null,evidence_as_of:latest===null?null:new Date(latest).toISOString(),projection_status:'current' as 'current'|'unavailable',
    evidence_status:maturity,stale,scope,execution_mode:scope.execution_mode??'mixed_provider_history',
    scope_coverage:{work_units:facts.length,unattributed_work_units:0,unknown_service_version:facts.filter(o=>!o.serviceVersion).length,unknown_agent_version:facts.filter(o=>o.agentVersion==null).length,known_operator_periods:new Set(facts.flatMap(o=>o.operatorPeriod?[o.operatorPeriod]:[])).size,continuity:'provider_identity_preserved; transfer_never_resets_history'},
    service_versions:[...new Set(facts.flatMap(o=>o.serviceVersion?[o.serviceVersion]:[]))].sort().map(version=>({version,accepted:facts.filter(o=>o.serviceVersion===version&&o.outcome==='accepted').length,provider_failures:facts.filter(o=>o.serviceVersion===version&&o.outcome==='provider_failure').length})),
    software_versions:[...new Set(facts.flatMap(o=>o.agentVersion==null?[]:[o.agentVersion]))].sort((a,b)=>a-b).map(version=>({version,observed_work_units:facts.filter(o=>o.agentVersion===version).length})),
    instant_execution:{schema_transport_success:0,failed_operations:0,pending:0,unknown:0,semantic_quality:'unmeasured',buyer_acceptance:'not_performed',affects_contracted_delivery:false},
    delivery:{accepted,provider_failures:providerFailures,pending:facts.filter(o=>o.outcome==='pending').length,unknown:facts.filter(o=>o.outcome==='unknown').length,
      raw_rate:accepted+providerFailures?rounded(accepted/(accepted+providerFailures)):null,
      weighted_model_estimate:weight?{mean:rounded((1+successes)/(2+weight)),lower_quantile:lowerBetaQuantile(1+successes,1+failures),quantile:policy.ranking_quantile,mode:policy.mode,calibrated:false}:null},
    deadlines:{on_time:deadlines.filter(o=>o.deliveryAt!<=o.deadlineAt!).length,eligible:deadlines.length,unknown:facts.filter(o=>o.deliveryAt!=null).length-deadlines.length,
      rate:deadlines.length?rounded(deadlines.filter(o=>o.deliveryAt!<=o.deadlineAt!).length/deadlines.length):null,
      p50_seconds:latencies.length>=policy.latency_minimum_p50?percentile(0.5):null,p95_seconds:latencies.length>=policy.latency_minimum_p95?percentile(0.95):null},
    satisfaction:{mean:reviewWeight?rounded(reviewTotal/reviewWeight):null,eligible_review_count:reviews.length,reviewed_job_coverage:accepted?rounded(reviews.length/accepted):null,subjective:true},
    breadth:{observed_buyer_groups:observedGroups,decayed_group_weight:rounded(weight),concentration:weight?rounded(largest/weight):null},
    freshness:{dated_terminal_observations:terminal.filter(o=>Number.isFinite(o.at)&&o.at<=now).length,unknown_date_observations:terminal.filter(o=>!Number.isFinite(o.at)||o.at>now).length},
    verification,first_pass:{jobs_with_failed_check:facts.filter(o=>o.firstPassFailure).length,interpretation:'operational_check; not_a_second_terminal_failure'},
    incidents:{serious_unremediated:facts.filter(o=>o.seriousIncident&&(o.incident==='upheld'||o.incident==='appealed')).length,remediation_policy:policy.serious_incident_expiry,pending:facts.filter(o=>o.openCase).length,adjudicated:facts.filter(o=>o.incident==='upheld'||o.incident==='appealed').length,appealed:facts.filter(o=>o.incident==='appealed').length,overturned:facts.filter(o=>o.incident==='overturned').length},
    value_experience:bands,limitations:{calibrated:false,representative_evidence_review:'pending',model_version:policy.aggregation_policy_version,buyer_independence:'not_verified',semantic_quality:'unmeasured',capability_attribution:policy.scope_attribution,private_work:policy.private_work},
  }
}
export type ReputationV2=ReturnType<typeof projectReputation>
export function unavailableReputation(scope:ReputationScope):ReputationV2 {
  return {...projectReputation([],scope),projection_status:'unavailable',evidence_status:'unknown'}
}
