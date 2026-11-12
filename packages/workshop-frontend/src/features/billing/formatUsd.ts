/** A balance or amount in dollars, to the cent: "$12.30", "-$0.40". */
export const formatUsd = (usd: number): string =>
  `${usd < 0 ? '-' : ''}$${Math.abs(usd).toFixed(2)}`
