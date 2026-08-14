import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cartItemConfiguredUnitPriceCents,
  cartItemKey,
  cartStorageKey,
  cartSubtotalCents,
  isCartStale,
  loadCart,
  parseStoredCart,
  persistCart,
} from './cart';
import type { CartItem, PublicCart } from './cart';

const cart: PublicCart = {
  slug: 'abc',
  menuVersionId: 'version-1',
  items: [
    {
      menu_item_id: 'item-1',
      name: 'Lanche',
      unit_price: '10.10',
      quantity: 3,
      note: '',
      options: [],
    },
  ],
};

const configurableCart: PublicCart = {
  slug: 'abc',
  menuVersionId: 'version-1',
  items: [
    {
      menu_item_id: 'item-1',
      name: 'Lanche',
      unit_price: '10.10',
      quantity: 1,
      note: '',
      options: [
        { menu_group_id: 'grp-1', menu_option_id: 'opt-1', name: 'Duplo', price_delta: '5.00' },
        { menu_group_id: 'grp-2', menu_option_id: 'opt-2', name: 'Bacon', price_delta: '-1.00' },
        { menu_group_id: 'grp-3', menu_option_id: 'opt-3', name: 'Cebola', price_delta: '0.00' },
      ],
    },
  ],
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

  it('aceita carrinho legado sem options e normaliza para lista vazia', () => {
    const legacy = {
      slug: 'abc',
      menuVersionId: 'version-1',
      items: [
        { menu_item_id: 'item-1', name: 'Lanche', unit_price: '10.10', quantity: 3, note: '' },
      ],
    } as unknown as PublicCart;
    const loaded = parseStoredCart(JSON.stringify(legacy), 'abc');
    expect(loaded).toEqual(cart);
  });

  it('calcula preço configurado, subtotal exato e chave canônica da linha', () => {
    const item = configurableCart.items[0]!;
    expect(cartItemConfiguredUnitPriceCents(item)).toBe(1410n);
    expect(cartSubtotalCents(configurableCart)).toBe(1410n);

    const sameConfig: CartItem = {
      ...item,
      options: [
        { menu_group_id: 'grp-2', menu_option_id: 'opt-2', name: 'Bacon', price_delta: '-1.00' },
        { menu_group_id: 'grp-1', menu_option_id: 'opt-1', name: 'Duplo', price_delta: '5.00' },
        { menu_group_id: 'grp-3', menu_option_id: 'opt-3', name: 'Cebola', price_delta: '0.00' },
      ],
    };
    expect(cartItemKey(item)).toBe(cartItemKey(sameConfig));

    const differentConfig: CartItem = { ...item, options: item.options.slice(0, 1) };
    expect(cartItemKey(item)).not.toBe(cartItemKey(differentConfig));
  });

  it('descarta carrinho com opção duplicada, chave duplicada ou delta inválido', () => {
    const duplicatedOption: PublicCart = {
      ...configurableCart,
      items: [
        {
          ...configurableCart.items[0]!,
          options: [
            { menu_group_id: 'grp-1', menu_option_id: 'opt-1', name: 'Duplo', price_delta: '5.00' },
            {
              menu_group_id: 'grp-1',
              menu_option_id: 'opt-1',
              name: 'Duplo 2',
              price_delta: '1.00',
            },
          ],
        },
      ],
    };
    expect(parseStoredCart(JSON.stringify(duplicatedOption), 'abc').items).toEqual([]);

    const duplicatedLine: PublicCart = {
      ...configurableCart,
      items: [configurableCart.items[0]!, { ...configurableCart.items[0]! }],
    };
    expect(parseStoredCart(JSON.stringify(duplicatedLine), 'abc').items).toEqual([]);

    const invalidDelta: PublicCart = {
      ...configurableCart,
      items: [
        {
          ...configurableCart.items[0]!,
          options: [
            { menu_group_id: 'grp-1', menu_option_id: 'opt-1', name: 'Duplo', price_delta: 'abc' },
          ],
        },
      ],
    };
    expect(parseStoredCart(JSON.stringify(invalidDelta), 'abc').items).toEqual([]);
  });

  it('persiste itens configurados e não vaza campos internos', () => {
    persistCart(configurableCart);
    expect(loadCart('abc')).toEqual(configurableCart);
    expect(window.localStorage.getItem(cartStorageKey('abc'))).not.toMatch(
      /source_|idempotency|customer|payment/,
    );
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
