const DECIMAL_MONEY_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
const SIGNED_DECIMAL_MONEY_PATTERN = /^(-?0|-?[1-9]\d*)(?:\.(\d{1,2}))?$/;

export function decimalToCents(value: string): bigint {
  const normalized = value.trim();
  const match = DECIMAL_MONEY_PATTERN.exec(normalized);
  if (match === null) {
    throw new Error('Valor monetário inválido.');
  }

  const fraction = (match[2] ?? '').padEnd(2, '0');
  return BigInt(match[1]!) * 100n + BigInt(fraction || '0');
}

export function signedDecimalToCents(value: string): bigint {
  const normalized = value.trim();
  const match = SIGNED_DECIMAL_MONEY_PATTERN.exec(normalized);
  if (match === null) {
    throw new Error('Valor monetário inválido.');
  }

  const fraction = (match[2] ?? '').padEnd(2, '0');
  const unsigned = BigInt(match[1]!.replace(/^-/, '')) * 100n + BigInt(fraction || '0');
  return normalized.startsWith('-') ? -unsigned : unsigned;
}

export function centsToDecimal(cents: bigint): string {
  if (cents < 0n) {
    throw new Error('Valor monetário não pode ser negativo.');
  }

  const integer = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return `${integer}.${fraction}`;
}

export function multiplyCents(cents: bigint, quantity: number): bigint {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error('Quantidade inválida.');
  }
  return cents * BigInt(quantity);
}

export function addCents(...values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

export function formatBRL(value: string | bigint): string {
  const cents = typeof value === 'bigint' ? value : decimalToCents(value);
  const [integer = '0', fraction = '00'] = centsToDecimal(cents).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${grouped},${fraction}`;
}

export function formatSignedBRL(cents: bigint): string {
  if (cents < 0n) {
    return `- ${formatBRL(-cents)}`;
  }
  return formatBRL(cents);
}
