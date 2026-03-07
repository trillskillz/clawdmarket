export const CONTRACT_STATES = [
  'DRAFT',
  'FUNDED',
  'IN_PROGRESS',
  'AWAITING_REVIEW',
  'DISPUTED',
  'COMPLETED',
  'CANCELED',
  'EXPIRED',
  'REFUNDED',
] as const;

export const MILESTONE_STATES = [
  'PENDING',
  'ACTIVE',
  'SUBMITTED',
  'AUTO_FAILED',
  'AWAITING_BUYER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'PAID',
  'DISPUTED',
  'REFUNDED',
] as const;

export type ContractState = (typeof CONTRACT_STATES)[number];
export type MilestoneState = (typeof MILESTONE_STATES)[number];

export function canTransitionContract(from: ContractState, to: ContractState) {
  const allowed: Record<ContractState, ContractState[]> = {
    DRAFT: ['FUNDED', 'CANCELED'],
    FUNDED: ['IN_PROGRESS', 'EXPIRED', 'REFUNDED', 'CANCELED'],
    IN_PROGRESS: ['AWAITING_REVIEW', 'DISPUTED', 'COMPLETED', 'EXPIRED', 'REFUNDED'],
    AWAITING_REVIEW: ['IN_PROGRESS', 'DISPUTED', 'COMPLETED'],
    DISPUTED: ['IN_PROGRESS', 'COMPLETED', 'REFUNDED'],
    COMPLETED: [],
    CANCELED: [],
    EXPIRED: ['REFUNDED'],
    REFUNDED: [],
  };
  return allowed[from].includes(to);
}

export function canTransitionMilestone(from: MilestoneState, to: MilestoneState) {
  const allowed: Record<MilestoneState, MilestoneState[]> = {
    PENDING: ['ACTIVE'],
    ACTIVE: ['SUBMITTED', 'DISPUTED'],
    SUBMITTED: ['AUTO_FAILED', 'AWAITING_BUYER_REVIEW', 'CHANGES_REQUESTED', 'DISPUTED'],
    AUTO_FAILED: ['CHANGES_REQUESTED', 'ACTIVE', 'DISPUTED'],
    AWAITING_BUYER_REVIEW: ['APPROVED', 'CHANGES_REQUESTED', 'DISPUTED'],
    CHANGES_REQUESTED: ['ACTIVE', 'DISPUTED'],
    APPROVED: ['PAID', 'DISPUTED'],
    PAID: [],
    DISPUTED: ['ACTIVE', 'APPROVED', 'REFUNDED'],
    REFUNDED: [],
  };
  return allowed[from].includes(to);
}

export function nextContractStateFromMilestones(states: MilestoneState[]): ContractState {
  if (states.length > 0 && states.every((s) => s === 'PAID')) return 'COMPLETED';
  if (states.some((s) => s === 'DISPUTED')) return 'DISPUTED';
  if (states.some((s) => s === 'AWAITING_BUYER_REVIEW' || s === 'SUBMITTED')) return 'AWAITING_REVIEW';
  if (states.some((s) => s === 'ACTIVE' || s === 'CHANGES_REQUESTED' || s === 'AUTO_FAILED')) return 'IN_PROGRESS';
  return 'FUNDED';
}
