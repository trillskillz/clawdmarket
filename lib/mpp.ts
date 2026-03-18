import { Mppx, tempo } from 'mppx/nextjs';

const currency = '0x20c0000000000000000000000000000000000000' as const; // pathUSD on Tempo
const recipient = process.env.MPP_RECIPIENT_ADDRESS as `0x${string}` | undefined;

if (!recipient) {
  throw new Error('Missing MPP_RECIPIENT_ADDRESS environment variable.');
}

export const mppx = Mppx.create({
  methods: [
    tempo({
      currency,
      recipient,
    }),
  ],
});
