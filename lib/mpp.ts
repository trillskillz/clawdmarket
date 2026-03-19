import { Mppx, tempo } from 'mppx/nextjs';
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants';

const recipient = process.env.MPP_RECIPIENT_ADDRESS as `0x${string}` | undefined;

const passthrough = {
  charge: () => (handler: any) => handler,
  session: () => (handler: any) => handler,
};

export const mppx = recipient
  ? Mppx.create({
      methods: [
        tempo({
          currency: PATHUSD_ADDRESS,
          chainId: TEMPO_CHAIN_ID,
          recipient,
        }),
      ],
    })
  : passthrough;
