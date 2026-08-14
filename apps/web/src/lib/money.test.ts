import { describe, expect, it } from 'vitest';
import {
  addCents,
  centsToDecimal,
  decimalToCents,
  formatBRL,
  formatSignedBRL,
  multiplyCents,
  signedDecimalToCents,
} from './money';

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

  it('converte e formata deltas assinados sem perda de sinal', () => {
    expect(signedDecimalToCents('5.00')).toBe(500n);
    expect(signedDecimalToCents('-5.00')).toBe(-500n);
    expect(signedDecimalToCents('0.00')).toBe(0n);
    expect(signedDecimalToCents('-0.00')).toBe(0n);
    expect(signedDecimalToCents('4')).toBe(400n);
    expect(formatSignedBRL(500n)).toBe('R$ 5,00');
    expect(formatSignedBRL(-500n)).toBe('- R$ 5,00');
    expect(() => signedDecimalToCents('abc')).toThrow('Valor monetário inválido');
    expect(() => signedDecimalToCents('1,00')).toThrow('Valor monetário inválido');
  });

  it('preserva o sinal em descontos fracionários negativos', () => {
    expect(signedDecimalToCents('0.50')).toBe(50n);
    expect(signedDecimalToCents('1.50')).toBe(150n);
    expect(signedDecimalToCents('-0.50')).toBe(-50n);
    expect(signedDecimalToCents('-0.01')).toBe(-1n);
    expect(signedDecimalToCents('-1.50')).toBe(-150n);
    expect(signedDecimalToCents('-10.05')).toBe(-1005n);
    expect(signedDecimalToCents('-0.00')).toBe(0n);
  });
});
