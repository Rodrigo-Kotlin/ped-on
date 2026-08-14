import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useId } from 'react';
import { z } from 'zod';
import type { OptionGroupKind } from '../../lib/catalog/product-options';
import { normalizeOptionDelta } from '../../lib/catalog/product-options';

export interface OptionFormValues {
  name: string;
  price_delta: string;
}

function optionSchema(kind: OptionGroupKind) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, 'Informe o nome da opção.')
      .max(80, 'Use no máximo 80 caracteres.'),
    price_delta: z.string().transform((value, ctx) => {
      try {
        return normalizeOptionDelta(value, kind);
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    }),
  });
}

const inputClass =
  'mt-1 min-h-11 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30 disabled:cursor-not-allowed disabled:bg-pedon-surface disabled:text-pedon-text/50';
const secondaryButtonClass =
  'min-h-11 rounded-md border border-pedon-navy/25 px-3 py-2 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5 disabled:cursor-not-allowed disabled:opacity-60';
const primaryButtonClass =
  'min-h-11 rounded-md bg-pedon-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-pedon-navy/90 disabled:cursor-not-allowed disabled:opacity-60';

interface OptionEditorProps {
  submitLabel: string;
  kind: OptionGroupKind;
  initial?: OptionFormValues;
  onSubmit: (values: OptionFormValues) => Promise<void>;
  onCancel: () => void;
}

export function OptionEditor({
  submitLabel,
  kind,
  initial,
  onSubmit,
  onCancel,
}: OptionEditorProps) {
  const formId = useId();
  const isRemoval = kind === 'removal';
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OptionFormValues>({
    resolver: zodResolver(optionSchema(kind)),
    defaultValues: {
      name: initial?.name ?? '',
      price_delta: initial?.price_delta ?? '0.00',
    },
  });

  return (
    <form
      className="mt-3 rounded-md border border-pedon-orange/30 bg-pedon-surface p-4"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`option-name-${formId}`} className="block text-sm font-medium">
            Nome da opção
          </label>
          <input
            id={`option-name-${formId}`}
            className={inputClass}
            aria-invalid={errors.name !== undefined}
            aria-describedby={errors.name !== undefined ? `option-name-error-${formId}` : undefined}
            {...register('name')}
          />
          {errors.name !== undefined && (
            <p
              id={`option-name-error-${formId}`}
              role="alert"
              className="mt-1 text-sm text-red-700"
            >
              {errors.name.message}
            </p>
          )}
        </div>

        <div>
          {isRemoval ? (
            <>
              <label className="block text-sm font-medium">Preço adicional</label>
              <input
                type="text"
                value="Sem acréscimo"
                readOnly
                disabled
                className={inputClass}
                aria-label="Preço adicional (remoção sem acréscimo)"
              />
            </>
          ) : (
            <>
              <label htmlFor={`option-price-${formId}`} className="block text-sm font-medium">
                Preço adicional (R$)
              </label>
              <input
                id={`option-price-${formId}`}
                type="text"
                inputMode="decimal"
                placeholder={kind === 'addon' ? '0,00' : '-3,00'}
                className={inputClass}
                aria-invalid={errors.price_delta !== undefined}
                aria-describedby={
                  errors.price_delta !== undefined ? `option-price-error-${formId}` : undefined
                }
                {...register('price_delta')}
              />
              {errors.price_delta !== undefined && (
                <p
                  id={`option-price-error-${formId}`}
                  role="alert"
                  className="mt-1 text-sm text-red-700"
                >
                  {errors.price_delta.message}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={isSubmitting} className={primaryButtonClass}>
          {isSubmitting ? 'Salvando…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
