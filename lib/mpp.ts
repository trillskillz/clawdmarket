import { Mppx, tempo } from 'mppx/nextjs';
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants';

const recipient = process.env.MPP_RECIPIENT_ADDRESS as `0x${string}` | undefined;

const passthrough = {
  charge: () => (handler: any) => handler,
  session: () => (handler: any) => handler,
};

// Note: mppx/lightning is not exported in the currently installed mppx build.
// When available, lightning can be appended here as an additional method.
export const mppx: any = recipient
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
