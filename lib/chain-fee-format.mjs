/** Exact decimal display; amounts never pass through floating point. */
export function formatChainFeeUnits(units,decimals){
  if(typeof units!=='string'||!/^(0|[1-9][0-9]*)$/.test(units)||![6,18].includes(decimals))throw Error('CHAIN_FEE_DISPLAY_INVALID')
  const value=units.padStart(decimals+1,'0'),fraction=value.slice(-decimals).replace(/0+$/,'')
  return value.slice(0,-decimals)+(fraction?'.'+fraction:'')
}
