import { useEffect, useMemo, useRef, useState } from 'react';
import { useCart } from '../../lib/cart/cart-context';
import { formatSignedBRL, signedDecimalToCents } from '../../lib/money';
import {
  buildCartItemOptions,
  clearGroupSelection,
  configuredPriceCents,
  emptySelection,
  firstSelectionError,
  selectedOptionIds,
  selectionError,
  toggleSelection,
} from '../../lib/menu/option-selection';
import type { OptionSelection } from '../../lib/menu/option-selection';
import type { PublicMenuProduct } from '../../lib/menu/menu';

export const CUSTOMIZER_PRICE_ID = 'product-customizer-price';

export function ProductCustomizer({
  product,
  versionId,
  onClose,
}: {
  product: PublicMenuProduct;
  versionId: string;
  onClose: () => void;
}) {
  const { addItem } = useCart();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<OptionSelection>(emptySelection);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => product.option_groups ?? [], [product.option_groups]);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      '[tabindex="-1"], button, input',
    );
    focusable?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusableElements =
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [];
      if (focusableElements.length === 0) return;
      const first = focusableElements[0]!;
      const last = focusableElements[focusableElements.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      triggerRef.current?.focus();
    };
  }, [onClose]);

  const priceCents = useMemo(
    () => configuredPriceCents(product.price, groups, selection),
    [groups, product.price, selection],
  );

  function confirmSelection() {
    const validationError = firstSelectionError(groups, selection);
    if (validationError !== null) {
      setError(validationError);
      return;
    }
    const options = buildCartItemOptions(groups, selection);
    addItem(versionId, {
      menu_item_id: product.id,
      name: product.name,
      unit_price: product.price,
      options,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-pedon-navy/55 p-0 sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-customizer-title"
        tabIndex={-1}
        className="flex max-h-[92svh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:max-h-[85svh] sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-pedon-navy/10 px-4 py-4">
          <div className="min-w-0">
            <h2 id="product-customizer-title" className="text-lg font-bold text-pedon-navy">
              {product.name}
            </h2>
            <p className="mt-1 text-sm text-pedon-text/70">{product.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Fechar customização de ${product.name}`}
            className="min-h-11 min-w-11 shrink-0 rounded-md text-2xl leading-none text-pedon-text transition hover:bg-pedon-navy/5"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error !== null && (
            <p
              role="alert"
              aria-live="assertive"
              className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
            >
              {error}
            </p>
          )}

          <div className="space-y-5">
            {groups.map((group) => {
              const selected = selectedOptionIds(selection, group.id);
              const groupError = selectionError(group, selection);
              const single = group.selection_mode === 'single';
              return (
                <fieldset
                  key={group.id}
                  className="rounded-lg border border-pedon-navy/10 p-4"
                  aria-describedby={groupError !== null ? `option-error-${group.id}` : undefined}
                >
                  <legend className="px-1 font-semibold text-pedon-navy">
                    {group.name}
                    <span className="ml-2 text-xs font-normal uppercase tracking-wider text-pedon-text/55">
                      {single ? 'Escolha única' : 'Múltipla escolha'}
                    </span>
                  </legend>
                  <p className="mt-1 text-sm text-pedon-text/65">
                    {group.min_select > 0
                      ? `Escolha ${group.min_select}${group.max_select === group.min_select ? '' : ` a ${group.max_select}`}`
                      : `Até ${group.max_select}`}
                  </p>
                  <div
                    className={`mt-3 space-y-2 ${single ? '' : ''}`}
                    role={single ? 'radiogroup' : 'group'}
                    aria-label={group.name}
                  >
                    {single && group.min_select === 0 && (
                      <label className="flex min-h-11 items-center gap-3 rounded-md border border-pedon-navy/15 px-3">
                        <input
                          type="radio"
                          name={`group-${group.id}`}
                          checked={selected.size === 0}
                          onChange={() => {
                            setError(null);
                            setSelection(clearGroupSelection(selection, group.id));
                          }}
                        />
                        <span className="text-pedon-text">Nenhum</span>
                      </label>
                    )}
                    {group.options.map((option) => {
                      const available = option.is_available;
                      const checked = selected.has(option.id);
                      return (
                        <label
                          key={option.id}
                          className={`flex min-h-11 items-center gap-3 rounded-md border px-3 ${
                            available ? 'border-pedon-navy/15' : 'border-pedon-navy/10 opacity-60'
                          }`}
                        >
                          <input
                            type={single ? 'radio' : 'checkbox'}
                            name={single ? `group-${group.id}` : `option-${option.id}`}
                            checked={checked}
                            disabled={!available}
                            aria-invalid={groupError !== null}
                            onChange={() => {
                              setError(null);
                              setSelection(toggleSelection(selection, group, option.id));
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-pedon-text">{option.name}</span>
                            {!available && (
                              <span className="block text-xs font-semibold uppercase tracking-wider text-pedon-text/55">
                                Indisponível
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-sm font-medium text-pedon-text/75">
                            {formatOptionDeltaForPublic(option.price_delta)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {groupError !== null && (
                    <p
                      id={`option-error-${group.id}`}
                      className="mt-2 text-sm font-medium text-red-700"
                    >
                      {groupError}
                    </p>
                  )}
                </fieldset>
              );
            })}
          </div>
        </div>

        <div className="border-t border-pedon-navy/10 px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-sm text-pedon-text/70">Preço configurado</span>
            <span id={CUSTOMIZER_PRICE_ID} className="text-lg font-bold text-pedon-navy">
              {formatSignedBRL(priceCents)}
            </span>
          </div>
          <button
            type="button"
            onClick={confirmSelection}
            className="min-h-12 w-full rounded-md bg-pedon-orange px-4 py-3 font-bold text-white"
          >
            Adicionar ao carrinho
          </button>
        </div>
      </div>
    </div>
  );
}

function formatOptionDeltaForPublic(delta: string): string {
  const cents = signedDecimalToCents(delta);
  if (cents === 0n) return 'Sem acréscimo';
  const sign = cents < 0n ? '-' : '+';
  return `${sign} ${formatSignedBRL(cents < 0n ? -cents : cents)}`;
}
