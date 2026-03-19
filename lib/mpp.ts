import { Mppx, tempo } from 'mppx/nextjs';
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from './constants';

const recipient = process.env.MPP_RECIPIENT_ADDRESS;

export const mppx: any = recipient
  ? Mppx.create({
      methods: [
        tempo({
          currency: PATHUSD_ADDRESS,
          recipient: recipient as `0x${string}`,
          chainId: TEMPO_CHAIN_ID,
          testnet: false,
        }),
      ],
    })
  : {
      charge: (_opts: any) => (handler: any) => handler,
      session: (_opts: any) => (handler: any) => handler,
    };
