import { BITCOIN_EXPLORER_API, BITCOIN_RECIPIENT_ADDRESS } from './constants';

export interface BitcoinPaymentResult {
  verified: boolean;
  amount_btc?: number;
  amount_sat?: number;
  txid: string;
  confirmations?: number;
  payer_address?: string;
}

export async function getBtcPriceUsd(): Promise<number> {
  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', {
    next: { revalidate: 60 },
  });
  const data = await res.json();
  return data?.bitcoin?.usd || 0;
}

export async function usdToBtc(usdAmount: number): Promise<number> {
  const price = await getBtcPriceUsd();
  if (!price) throw new Error('Could not fetch BTC price');
  return usdAmount / price;
}

export async function verifyBitcoinPayment(
  txid: string,
  expectedUsdAmount: number,
): Promise<BitcoinPaymentResult> {
  try {
    const res = await fetch(`${BITCOIN_EXPLORER_API}/tx/${txid}`, { next: { revalidate: 30 } });
    if (!res.ok) return { verified: false, txid };

    const tx = await res.json();

    const recipientOutput = tx.vout?.find(
      (out: any) => out.scriptpubkey_address === BITCOIN_RECIPIENT_ADDRESS,
    );

    if (!recipientOutput) return { verified: false, txid };

    const amount_sat = Number(recipientOutput.value || 0);
    const amount_btc = amount_sat / 1e8;

    const btcPriceUsd = await getBtcPriceUsd();
    const usd_received = amount_btc * btcPriceUsd;
    const sufficient = usd_received >= expectedUsdAmount * 0.95;

    const statusRes = await fetch(`${BITCOIN_EXPLORER_API}/tx/${txid}/status`, {
      next: { revalidate: 30 },
    });
    const status = await statusRes.json();

    let confirmations = 0;
    if (status.confirmed) {
      const tipRes = await fetch(`${BITCOIN_EXPLORER_API}/blocks/tip/height`, { next: { revalidate: 30 } });
      const tipHeight = Number(await tipRes.text());
      confirmations = Math.max(1, tipHeight - Number(status.block_height || tipHeight) + 1);
    }

    const requiredConfirmations = expectedUsdAmount >= 10 ? 3 : 1;
    const confirmed = confirmations >= requiredConfirmations;

    return {
      verified: sufficient && confirmed,
      amount_btc,
      amount_sat,
      txid,
      confirmations,
    };
  } catch (err) {
    console.error('Bitcoin payment verification failed:', err);
    return { verified: false, txid };
  }
}
