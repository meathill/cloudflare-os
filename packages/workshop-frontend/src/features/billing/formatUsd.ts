/** A balance or amount in dollars, to the cent: "$12.30", "-$0.40". */
export const formatUsd = (usd: number): string =>
  `${usd < 0 ? '-' : ''}$${Math.abs(usd).toFixed(2)}`

/** 管理端的小额金额按分显示容易全是 $0.00，用四位小数："$0.0024"。 */
export const formatUsd4 = (usd: number): string =>
  `${usd < 0 ? '-' : ''}$${Math.abs(usd).toFixed(4)}`
