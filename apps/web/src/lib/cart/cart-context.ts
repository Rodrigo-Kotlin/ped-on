import { createContext, useContext } from 'react';
import type { CartItem, PublicCart } from './cart';

export interface AddCartItem extends Omit<CartItem, 'quantity' | 'note'> {
  quantity?: number;
  note?: string;
}

export interface CartContextValue {
  cart: PublicCart;
  addItem: (menuVersionId: string, item: AddCartItem) => void;
  setQuantity: (menuItemId: string, quantity: number) => void;
  setNote: (menuItemId: string, note: string) => void;
  removeItem: (menuItemId: string) => void;
  clearCart: () => void;
}

export const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (value === null) throw new Error('useCart deve ser usado dentro de CartProvider.');
  return value;
}
