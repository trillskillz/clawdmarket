/** Fresh reviewed funding stays closed by default; original paid recovery is separate. */
export const reviewedContractFundingEnabled = () => process.env.CLAWDMARKET_REVIEWED_CONTRACT_FUNDING_ENABLED === 'true'
