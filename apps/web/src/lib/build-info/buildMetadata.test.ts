import { describe, expect, it } from 'vitest';
import { buildMetadata, formatBuildTimestamp } from './buildMetadata';

describe('buildMetadata', () => {
  it('expõe versão, revisão e timestamp como textos', () => {
    expect(typeof buildMetadata.version).toBe('string');
    expect(typeof buildMetadata.sha).toBe('string');
    expect(typeof buildMetadata.timestamp).toBe('string');
    expect(buildMetadata.version.length).toBeGreaterThan(0);
  });

  it('formata timestamp ISO válido no padrão pt-BR curto', () => {
    const value = '2026-08-13T10:30:00.000Z';
    const expected = new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(value));
    expect(formatBuildTimestamp(value)).toBe(expected);
  });

  it('devolve o valor original quando o timestamp é inválido', () => {
    expect(formatBuildTimestamp('nao-e-data')).toBe('nao-e-data');
    expect(formatBuildTimestamp('')).toBe('');
  });
});
