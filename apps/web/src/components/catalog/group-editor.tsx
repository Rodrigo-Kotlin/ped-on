import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useId } from 'react';
import { z } from 'zod';
import type { OptionGroupKind, OptionSelectionMode } from '../../lib/catalog/product-options';
import {
  KIND_LABELS,
  OPTION_GROUP_KINDS,
  SELECTION_MODE_LABELS,
} from '../../lib/catalog/product-options';

export interface GroupFormValues {
  name: string;
  kind: OptionGroupKind;
  selection_mode: OptionSelectionMode;
  min_select: number;
  max_select: number;
}

function groupSchema() {
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Informe o nome do grupo.')
        .max(80, 'Use no máximo 80 caracteres.'),
      kind: z.enum(OPTION_GROUP_KINDS),
      selection_mode: z.enum(['single', 'multiple']),
      min_select: z.number('Informe o mínimo.'),
      max_select: z.number('Informe o máximo.'),
    })
    .superRefine((values, ctx) => {
      if (!Number.isInteger(values.min_select) || values.min_select < 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['min_select'],
          message: 'O mínimo deve ser um número inteiro igual ou maior que zero.',
        });
      }
      if (!Number.isInteger(values.max_select) || values.max_select < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['max_select'],
          message: 'O máximo deve ser um número inteiro igual ou maior que um.',
        });
      }
      if (values.max_select > 50) {
        ctx.addIssue({
          code: 'custom',
          path: ['max_select'],
          message: 'O máximo permitido é 50 opções.',
        });
      }
      if (values.min_select > values.max_select) {
        ctx.addIssue({
          code: 'custom',
          path: ['min_select'],
          message: 'O mínimo não pode ser maior que o máximo.',
        });
      }
      if (values.selection_mode === 'single' && values.max_select !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['max_select'],
          message: 'Escolha única permite selecionar no máximo 1 opção.',
        });
      }
      if (values.kind === 'variation' && values.selection_mode !== 'single') {
        ctx.addIssue({
          code: 'custom',
          path: ['selection_mode'],
          message: 'Variações usam sempre escolha única.',
        });
      }
      if (values.kind === 'variation' && values.max_select !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['max_select'],
          message: 'Variações permitem escolher exatamente 1 opção.',
        });
      }
      if (values.kind === 'removal' && values.selection_mode !== 'multiple') {
        ctx.addIssue({
          code: 'custom',
          path: ['selection_mode'],
          message: 'Remoções usam sempre múltipla escolha.',
        });
      }
      if (values.kind === 'removal' && values.min_select !== 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['min_select'],
          message: 'Remoções são opcionais (mínimo 0).',
        });
      }
    });
}

const inputClass =
  'mt-1 min-h-11 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30 disabled:cursor-not-allowed disabled:bg-pedon-surface disabled:text-pedon-text/50';
const secondaryButtonClass =
  'min-h-11 rounded-md border border-pedon-navy/25 px-3 py-2 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5 disabled:cursor-not-allowed disabled:opacity-60';
const primaryButtonClass =
  'min-h-11 rounded-md bg-pedon-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-pedon-navy/90 disabled:cursor-not-allowed disabled:opacity-60';

interface GroupEditorProps {
  submitLabel: string;
  initial?: GroupFormValues;
  onSubmit: (values: GroupFormValues) => Promise<void>;
  onCancel: () => void;
}

export function GroupEditor({ submitLabel, initial, onSubmit, onCancel }: GroupEditorProps) {
  const formId = useId();
  const defaultKind: OptionGroupKind = initial?.kind ?? 'addon';

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<GroupFormValues>({
    resolver: zodResolver(groupSchema()),
    defaultValues: {
      name: initial?.name ?? '',
      kind: defaultKind,
      selection_mode: initial?.selection_mode ?? 'multiple',
      min_select: initial?.min_select ?? 0,
      max_select: initial?.max_select ?? 5,
    },
  });

  const kind = useWatch({ control, name: 'kind' });
  const selectionMode = useWatch({ control, name: 'selection_mode' });

  function handleKindChange(nextKind: OptionGroupKind) {
    setValue('kind', nextKind, { shouldValidate: true });
    if (nextKind === 'variation') {
      setValue('selection_mode', 'single');
      setValue('min_select', 1);
      setValue('max_select', 1);
    } else if (nextKind === 'removal') {
      setValue('selection_mode', 'multiple');
      setValue('min_select', 0);
    } else if (nextKind === 'addon' && kind === 'variation') {
      setValue('selection_mode', 'multiple');
      setValue('max_select', 5);
    }
  }

  function handleSelectionModeChange(nextMode: OptionSelectionMode) {
    setValue('selection_mode', nextMode, { shouldValidate: true });
    if (nextMode === 'single') {
      setValue('max_select', 1, { shouldValidate: true });
    }
  }

  const isVariation = kind === 'variation';
  const isRemoval = kind === 'removal';

  return (
    <form
      className="mt-4 rounded-md border border-pedon-orange/30 bg-pedon-surface p-4"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`group-name-${formId}`} className="block text-sm font-medium">
            Nome do grupo
          </label>
          <input
            id={`group-name-${formId}`}
            className={inputClass}
            aria-invalid={errors.name !== undefined}
            aria-describedby={errors.name !== undefined ? `group-name-error-${formId}` : undefined}
            {...register('name')}
          />
          {errors.name !== undefined && (
            <p id={`group-name-error-${formId}`} role="alert" className="mt-1 text-sm text-red-700">
              {errors.name.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`group-kind-${formId}`} className="block text-sm font-medium">
            Tipo
          </label>
          <select
            id={`group-kind-${formId}`}
            className={inputClass}
            aria-invalid={errors.kind !== undefined}
            {...register('kind')}
            onChange={(event) => handleKindChange(event.target.value as OptionGroupKind)}
          >
            {OPTION_GROUP_KINDS.map((optionKind) => (
              <option key={optionKind} value={optionKind}>
                {KIND_LABELS[optionKind]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`group-mode-${formId}`} className="block text-sm font-medium">
            Modo de seleção
          </label>
          <select
            id={`group-mode-${formId}`}
            className={inputClass}
            disabled={isVariation || isRemoval}
            aria-invalid={errors.selection_mode !== undefined}
            aria-describedby={
              errors.selection_mode !== undefined ? `group-mode-error-${formId}` : undefined
            }
            {...register('selection_mode')}
            onChange={(event) =>
              handleSelectionModeChange(event.target.value as OptionSelectionMode)
            }
          >
            <option value="single">{SELECTION_MODE_LABELS.single}</option>
            <option value="multiple">{SELECTION_MODE_LABELS.multiple}</option>
          </select>
          {errors.selection_mode !== undefined && (
            <p id={`group-mode-error-${formId}`} role="alert" className="mt-1 text-sm text-red-700">
              {errors.selection_mode.message}
            </p>
          )}
          {(isVariation || isRemoval) && (
            <p className="mt-1 text-xs text-pedon-text/60">
              {isVariation
                ? 'Obrigatório pelo contrato: variações usam escolha única.'
                : 'Obrigatório pelo contrato: remoções usam múltipla escolha.'}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`group-min-${formId}`} className="block text-sm font-medium">
            Mínimo
          </label>
          <input
            id={`group-min-${formId}`}
            type="number"
            inputMode="numeric"
            min={0}
            max={50}
            disabled={isRemoval}
            className={inputClass}
            aria-invalid={errors.min_select !== undefined}
            aria-describedby={
              errors.min_select !== undefined ? `group-min-error-${formId}` : undefined
            }
            {...register('min_select', { valueAsNumber: true })}
          />
          {errors.min_select !== undefined && (
            <p id={`group-min-error-${formId}`} role="alert" className="mt-1 text-sm text-red-700">
              {errors.min_select.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`group-max-${formId}`} className="block text-sm font-medium">
            Máximo
          </label>
          <input
            id={`group-max-${formId}`}
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            disabled={isVariation || selectionMode === 'single'}
            className={inputClass}
            aria-invalid={errors.max_select !== undefined}
            aria-describedby={
              errors.max_select !== undefined ? `group-max-error-${formId}` : undefined
            }
            {...register('max_select', { valueAsNumber: true })}
          />
          {errors.max_select !== undefined && (
            <p id={`group-max-error-${formId}`} role="alert" className="mt-1 text-sm text-red-700">
              {errors.max_select.message}
            </p>
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
