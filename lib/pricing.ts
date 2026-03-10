export function toCdcPrice(value: any): number {
  const raw = value?.price_cdc ?? value?.price_bankr ?? value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
