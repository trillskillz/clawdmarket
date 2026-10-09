import 'server-only'
export type OrganizationSpendingEvidence=Readonly<{accountId:string;organizationId:string;buyerId:string;agentId:string;credentialHash:string}>
const issued=new WeakSet<object>()
export function issueOrganizationSpendingEvidence(value:OrganizationSpendingEvidence){const evidence=Object.freeze({...value});issued.add(evidence);return evidence}
export function validOrganizationSpendingEvidence(value:unknown):value is OrganizationSpendingEvidence{return typeof value==='object'&&value!==null&&issued.has(value)}
