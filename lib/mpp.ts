import { Mppx, tempo } from 'mppx/nextjs';
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants';

const recipient = process.env.MPP_RECIPIENT_ADDRESS as `0x${string}` | undefined;

if (!recipient) {
  throw new Error('Missing MPP_RECIPIENT_ADDRESS environment variable.');
}

export const mppx = Mppx.create({
  methods: [
    tempo({
      currency: PATHUSD_ADDRESS,
      chainId: TEMPO_CHAIN_ID,
      recipient,
    }),
  ],
});
