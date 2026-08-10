import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cartStorageKey,
  cartSubtotalCents,
  isCartStale,
  loadCart,
  parseStoredCart,
  persistCart,
} from './cart';
import type { PublicCart } from './cart';

const cart: PublicCart = {
  slug: 'abc',
  menuVersionId: 'version-1',
  items: [{ menu_item_id: 'item-1', name: 'Lanche', unit_price: '10.10', quantity: 3, note: '' }],
};

describe('cart storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('persiste somente o schema público e calcula subtotal exato', () => {
    persistCart(cart);
    expect(loadCart('abc')).toEqual(cart);
    expect(cartSubtotalCents(cart)).toBe(3030n);
    expect(window.localStorage.getItem(cartStorageKey('abc'))).not.toMatch(
      /customer|phone|email|idempotency|payment/,
    );
  });

  it('descarta JSON corrompido, PII/propriedades extras e quantidades inválidas', () => {
    expect(parseStoredCart('{', 'abc').items).toEqual([]);
    expect(
      parseStoredCart(JSON.stringify({ ...cart, customer: { phone: '11999999999' } }), 'abc').items,
    ).toEqual([]);
    expect(
      parseStoredCart(
        JSON.stringify({ ...cart, items: [{ ...cart.items[0], quantity: 100 }] }),
        'abc',
      ).items,
    ).toEqual([]);
    expect(parseStoredCart(JSON.stringify(cart), 'outro').items).toEqual([]);
    persistCart({ ...cart, items: [{ ...cart.items[0]!, note: '<script>' }] });
    expect(window.localStorage.getItem(cartStorageKey('abc'))).toBeNull();
  });

  it('marca stale sem alterar versão, preço, nome ou itens', () => {
    const loaded = parseStoredCart(JSON.stringify(cart), 'abc');
    expect(isCartStale(loaded, 'version-2')).toBe(true);
    expect(loaded).toEqual(cart);
  });

  it('remove a chave quando o carrinho fica vazio', () => {
    persistCart(cart);
    persistCart({ slug: 'abc', menuVersionId: '', items: [] });
    expect(window.localStorage.getItem(cartStorageKey('abc'))).toBeNull();
  });

  it('mantém a UI funcional quando o storage é bloqueado ou está cheio', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(loadCart('abc').items).toEqual([]);
    getItem.mockRestore();

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(() => persistCart(cart)).not.toThrow();
    setItem.mockRestore();

    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(() => persistCart({ slug: 'abc', menuVersionId: '', items: [] })).not.toThrow();
    removeItem.mockRestore();
  });
});
