import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  CART_ITEM_LIMIT,
  CART_QUANTITY_LIMIT,
  emptyCart,
  isValidCartItem,
  loadCart,
  persistCart,
} from './cart';
import type { CartItem, PublicCart } from './cart';
import { CartContext } from './cart-context';
import type { AddCartItem } from './cart-context';

export function CartProvider({
  publicSlug,
  children,
}: {
  publicSlug: string;
  children: ReactNode;
}) {
  const [cart, setCart] = useState<PublicCart>(() => loadCart(publicSlug));

  function updateCart(updater: (current: PublicCart) => PublicCart) {
    setCart((current) => {
      const next = updater(current);
      persistCart(next);
      return next;
    });
  }

  function addItem(menuVersionId: string, item: AddCartItem) {
    const quantity = item.quantity ?? 1;
    const nextItem: CartItem = { ...item, quantity, note: item.note ?? '' };
    if (menuVersionId === '' || !isValidCartItem(nextItem)) return;
    updateCart((current) => {
      if (current.items.length > 0 && current.menuVersionId !== menuVersionId) return current;
      const existing = current.items.find((entry) => entry.menu_item_id === item.menu_item_id);
      if (existing !== undefined) {
        const nextQuantity = existing.quantity + quantity;
        if (nextQuantity > CART_QUANTITY_LIMIT) return current;
        return {
          ...current,
          menuVersionId,
          items: current.items.map((entry) =>
            entry.menu_item_id === item.menu_item_id ? { ...entry, quantity: nextQuantity } : entry,
          ),
        };
      }
      if (current.items.length >= CART_ITEM_LIMIT) return current;
      return {
        slug: publicSlug,
        menuVersionId,
        items: [...current.items, nextItem],
      };
    });
  }

  function setQuantity(menuItemId: string, quantity: number) {
    if (!Number.isInteger(quantity)) return;
    if (quantity <= 0) {
      removeItem(menuItemId);
      return;
    }
    if (quantity > CART_QUANTITY_LIMIT) return;
    updateCart((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.menu_item_id === menuItemId ? { ...item, quantity } : item,
      ),
    }));
  }

  function setNote(menuItemId: string, note: string) {
    if (note.length > 300) return;
    updateCart((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.menu_item_id !== menuItemId) return item;
        const next = { ...item, note };
        return isValidCartItem(next) ? next : item;
      }),
    }));
  }

  function removeItem(menuItemId: string) {
    updateCart((current) => ({
      ...current,
      menuVersionId: current.items.length === 1 ? '' : current.menuVersionId,
      items: current.items.filter((item) => item.menu_item_id !== menuItemId),
    }));
  }

  function clearCart() {
    const next = emptyCart(publicSlug);
    setCart(next);
    persistCart(next);
  }

  return (
    <CartContext.Provider value={{ cart, addItem, setQuantity, setNote, removeItem, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}
