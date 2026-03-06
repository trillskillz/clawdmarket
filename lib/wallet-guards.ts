export const MAX_TRANSFER_AMOUNT = 1_000_000;
export const MAX_ESCROW_AMOUNT = 1_000_000;

export class WalletGuardError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'WalletGuardError';
  }
}

export function validateTransferAmount(amount: number) {
  if (amount <= 0) {
    throw new WalletGuardError('Amount must be positive', 'INVALID_AMOUNT');
  }
  if (amount > MAX_TRANSFER_AMOUNT) {
    throw new WalletGuardError(`Transfer exceeds max amount of ${MAX_TRANSFER_AMOUNT}`, 'AMOUNT_EXCEEDS_CAP');
  }
}

export function validateEscrowAmount(amount: number) {
  if (amount <= 0) {
    throw new WalletGuardError('Amount must be positive', 'INVALID_AMOUNT');
  }
  if (amount > MAX_ESCROW_AMOUNT) {
    throw new WalletGuardError(`Escrow amount exceeds cap (${MAX_ESCROW_AMOUNT})`, 'AMOUNT_EXCEEDS_CAP');
  }
}
