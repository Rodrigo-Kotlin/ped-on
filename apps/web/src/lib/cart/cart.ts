import { addCents, decimalToCents, multiplyCents, signedDecimalToCents } from '../money';
import { isPlainText } from '../plain-text';

export const CART_ITEM_LIMIT = 50;
export const CART_QUANTITY_LIMIT = 99;
export const CART_ITEM_OPTIONS_LIMIT = 50;

export interface CartItemOption {
  menu_group_id: string;
  menu_option_id: string;
  name: string;
  price_delta: string;
}

export interface CartItem {
  menu_item_id: string;
  name: string;
  unit_price: string;
  quantity: number;
  note: string;
  options: CartItemOption[];
}

export interface PublicCart {
  slug: string;
  menuVersionId: string;
  items: CartItem[];
}

const moneyPattern = /^(0|[1-9]\d*)(?:\.\d{1,2})?$/;
const signedMoneyPattern = /^-?(0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function cartStorageKey(publicSlug: string): string {
  return `pedon:cart:${publicSlug}`;
}

export function emptyCart(publicSlug: string): PublicCart {
  return { slug: publicSlug, menuVersionId: '', items: [] };
}

function isExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isValidCartItemOption(value: unknown): value is CartItemOption {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const option = value as Record<string, unknown>;
  return (
    isExactKeys(option, ['menu_group_id', 'menu_option_id', 'name', 'price_delta']) &&
    typeof option.menu_group_id === 'string' &&
    option.menu_group_id.length > 0 &&
    typeof option.menu_option_id === 'string' &&
    option.menu_option_id.length > 0 &&
    typeof option.name === 'string' &&
    option.name.length >= 1 &&
    option.name.length <= 80 &&
    isPlainText(option.name) &&
    typeof option.price_delta === 'string' &&
    signedMoneyPattern.test(option.price_delta) &&
    decimalToCents(option.price_delta.replace('-', '')) <= 999999999999n
  );
}

function isValidOptions(value: unknown): value is CartItemOption[] {
  return (
    Array.isArray(value) &&
    value.length <= CART_ITEM_OPTIONS_LIMIT &&
    value.every(isValidCartItemOption) &&
    new Set(value.map((option) => option.menu_option_id)).size === value.length
  );
}

export function isValidCartItem(value: unknown): value is CartItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    !isExactKeys(item, ['menu_item_id', 'name', 'unit_price', 'quantity', 'note', 'options']) &&
    !isExactKeys(item, ['menu_item_id', 'name', 'unit_price', 'quantity', 'note'])
  ) {
    return false;
  }
  return (
    typeof item.menu_item_id === 'string' &&
    item.menu_item_id.length > 0 &&
    typeof item.name === 'string' &&
    item.name.length >= 1 &&
    item.name.length <= 120 &&
    isPlainText(item.name) &&
    typeof item.unit_price === 'string' &&
    moneyPattern.test(item.unit_price) &&
    decimalToCents(item.unit_price) > 0n &&
    typeof item.quantity === 'number' &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 1 &&
    item.quantity <= CART_QUANTITY_LIMIT &&
    typeof item.note === 'string' &&
    item.note.length <= 300 &&
    isPlainText(item.note) &&
    (item.options === undefined || isValidOptions(item.options))
  );
}

function normalizeCartItem(value: unknown): CartItem {
  const item = value as Record<string, unknown>;
  return {
    menu_item_id: String(item.menu_item_id),
    name: String(item.name),
    unit_price: String(item.unit_price),
    quantity: Number(item.quantity),
    note: String(item.note),
    options: Array.isArray(item.options) ? (item.options as CartItemOption[]) : [],
  };
}

export function parseStoredCart(raw: string | null, publicSlug: string): PublicCart {
  if (raw === null) return emptyCart(publicSlug);

  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return emptyCart(publicSlug);
    }
    const cart = value as Record<string, unknown>;
    if (
      !isExactKeys(cart, ['slug', 'menuVersionId', 'items']) ||
      cart.slug !== publicSlug ||
      typeof cart.menuVersionId !== 'string' ||
      cart.menuVersionId.length === 0 ||
      !Array.isArray(cart.items) ||
      cart.items.length > CART_ITEM_LIMIT ||
      !cart.items.every(isValidCartItem)
    ) {
      return emptyCart(publicSlug);
    }
    const items = cart.items.map(normalizeCartItem);
    const keys = new Set(items.map(cartItemKey));
    if (keys.size !== items.length) return emptyCart(publicSlug);
    return { slug: publicSlug, menuVersionId: cart.menuVersionId, items };
  } catch {
    return emptyCart(publicSlug);
  }
}

export function loadCart(publicSlug: string): PublicCart {
  if (typeof window === 'undefined') return emptyCart(publicSlug);
  try {
    return parseStoredCart(window.localStorage.getItem(cartStorageKey(publicSlug)), publicSlug);
  } catch {
    return emptyCart(publicSlug);
  }
}

export function persistCart(cart: PublicCart): void {
  if (typeof window === 'undefined') return;
  try {
    if (cart.items.length === 0) {
      window.localStorage.removeItem(cartStorageKey(cart.slug));
      return;
    }
    const serialized = JSON.stringify(cart);
    if (parseStoredCart(serialized, cart.slug).items.length !== cart.items.length) {
      window.localStorage.removeItem(cartStorageKey(cart.slug));
      return;
    }
    window.localStorage.setItem(cartStorageKey(cart.slug), serialized);
  } catch {
    // Storage may be blocked or full. The in-memory cart remains usable.
  }
}

export function cartItemKey(item: Pick<CartItem, 'menu_item_id' | 'options'>): string {
  const optionIds = item.options
    .map((option) => option.menu_option_id)
    .sort()
    .join(',');
  return `${item.menu_item_id}:${optionIds}`;
}

export function cartItemConfiguredUnitPriceCents(item: CartItem): bigint {
  const deltas = item.options.map((option) => signedDecimalToCents(option.price_delta));
  return addCents(decimalToCents(item.unit_price), ...deltas);
}

export function cartQuantity(cart: PublicCart): number {
  return cart.items.reduce((total, item) => total + item.quantity, 0);
}

export function cartSubtotalCents(cart: PublicCart): bigint {
  return addCents(
    ...cart.items.map((item) =>
      multiplyCents(cartItemConfiguredUnitPriceCents(item), item.quantity),
    ),
  );
}

export function isCartStale(cart: PublicCart, currentMenuVersionId: string): boolean {
  return cart.items.length > 0 && cart.menuVersionId !== currentMenuVersionId;
}
