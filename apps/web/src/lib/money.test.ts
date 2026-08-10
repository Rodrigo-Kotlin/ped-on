import { describe, expect, it } from 'vitest';
import { addCents, centsToDecimal, decimalToCents, formatBRL, multiplyCents } from './money';

describe('money', () => {
  it('converte strings decimais e centavos sem ponto flutuante', () => {
    expect(decimalToCents('0.01')).toBe(1n);
    expect(decimalToCents('29.9')).toBe(2990n);
    expect(centsToDecimal(2990n)).toBe('29.90');
  });

  it('multiplica, soma e formata valores exatos', () => {
    const total = addCents(multiplyCents(decimalToCents('0.10'), 3), decimalToCents('0.20'));
    expect(total).toBe(50n);
    expect(formatBRL(total)).toBe('R$ 0,50');
    expect(formatBRL('1234567.89')).toBe('R$ 1.234.567,89');
  });

  it('recusa decimais ambíguos ou com precisão excedente', () => {
    expect(() => decimalToCents('1.001')).toThrow('Valor monetário inválido');
    expect(() => decimalToCents('1,00')).toThrow('Valor monetário inválido');
    expect(() => multiplyCents(100n, 1.5)).toThrow('Quantidade inválida');
  });
});
