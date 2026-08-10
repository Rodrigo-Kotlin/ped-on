import { Outlet, useParams } from 'react-router';
import { CartProvider } from '../lib/cart/CartProvider';

export function PublicOrderLayout() {
  const { publicSlug = '' } = useParams<{ publicSlug: string }>();
  return (
    <CartProvider key={publicSlug} publicSlug={publicSlug}>
      <Outlet />
    </CartProvider>
  );
}
