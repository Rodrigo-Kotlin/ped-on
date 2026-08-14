import { describe, expect, it } from 'vitest';
import { orderOptionLabel } from './order-option-label';

describe('orderOptionLabel', () => {
  it('formata snapshots por tipo sem usar IDs', () => {
    expect(
      orderOptionLabel({ group_name: 'Tamanho', group_kind: 'variation', option_name: 'Duplo' }),
    ).toBe('Tamanho: Duplo');
    expect(
      orderOptionLabel({ group_name: 'Adicionais', group_kind: 'addon', option_name: 'Bacon' }),
    ).toBe('+ Bacon');
    expect(
      orderOptionLabel({ group_name: 'Sem', group_kind: 'removal', option_name: 'Sem cebola' }),
    ).toBe('Sem cebola');
  });
});
