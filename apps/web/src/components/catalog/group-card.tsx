import type {
  CatalogProductOption,
  CatalogProductOptionGroup,
} from '../../lib/catalog/product-options';
import {
  KIND_LABELS,
  formatOptionDelta,
  selectionSummary,
} from '../../lib/catalog/product-options';

const secondaryButtonClass =
  'min-h-11 rounded-md border border-pedon-navy/25 px-3 py-2 text-sm font-medium text-pedon-navy transition hover:bg-pedon-navy/5 disabled:cursor-not-allowed disabled:opacity-60';

interface GroupCardProps {
  group: CatalogProductOptionGroup;
  options: CatalogProductOption[];
  canManage: boolean;
  online: boolean;
  pending: boolean;
  onEditGroup: () => void;
  onToggleGroupActive: (isActive: boolean) => void;
  onCreateOption: () => void;
  onEditOption: (optionId: string) => void;
  onToggleOptionActive: (optionId: string, isActive: boolean) => void;
  onToggleOptionAvailable: (optionId: string, isAvailable: boolean) => void;
}

export function GroupCard({
  group,
  options,
  canManage,
  online,
  pending,
  onEditGroup,
  onToggleGroupActive,
  onCreateOption,
  onEditOption,
  onToggleOptionActive,
  onToggleOptionAvailable,
}: GroupCardProps) {
  const orderedOptions = [...options].sort(
    (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
  );

  return (
    <section
      aria-labelledby={`group-name-${group.id}`}
      className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4
              id={`group-name-${group.id}`}
              className="break-words text-base font-semibold text-pedon-navy"
            >
              {group.name}
            </h4>
            <span className="rounded-full bg-pedon-surface px-2 py-1 text-xs font-bold text-pedon-navy">
              {KIND_LABELS[group.kind]}
            </span>
            <span
              className={`rounded-full px-2 py-1 text-xs font-bold ${
                group.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'
              }`}
            >
              {group.is_active ? 'ATIVO' : 'INATIVO'}
            </span>
          </div>
          <p className="mt-1 text-sm text-pedon-text/70">{selectionSummary(group)}</p>
          <p className="mt-0.5 text-sm text-pedon-text/60">
            {options.length} {options.length === 1 ? 'opção' : 'opções'}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={!online}
              onClick={onEditGroup}
            >
              Editar grupo
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={pending || !online}
              onClick={() => onToggleGroupActive(!group.is_active)}
            >
              {group.is_active ? 'Desativar grupo' : 'Ativar grupo'}
            </button>
          </div>
        )}
      </div>

      {orderedOptions.length === 0 ? (
        <p className="mt-3 rounded-md bg-pedon-surface px-3 py-4 text-sm text-pedon-text/70">
          Este grupo ainda não possui opções.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {orderedOptions.map((option) => (
            <li
              key={option.id}
              className="flex flex-col gap-2 rounded-md border border-pedon-navy/10 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words font-medium text-pedon-navy">{option.name}</p>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-bold ${
                      option.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {option.is_active ? 'ATIVA' : 'INATIVA'}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-bold ${
                      option.is_available
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {option.is_available ? 'DISPONÍVEL' : 'INDISPONÍVEL'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-pedon-text/70">
                  {formatOptionDelta(option.price_delta)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canManage && (
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    disabled={!online}
                    onClick={() => onEditOption(option.id)}
                  >
                    Editar
                  </button>
                )}
                {canManage && (
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    disabled={pending || !online}
                    onClick={() => onToggleOptionActive(option.id, !option.is_active)}
                  >
                    {option.is_active ? 'Desativar' : 'Ativar'}
                  </button>
                )}
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={pending || !online}
                  onClick={() => onToggleOptionAvailable(option.id, !option.is_available)}
                >
                  {option.is_available ? 'Indisponível' : 'Disponível'}
                  <span className="sr-only">: {option.name}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <button
          type="button"
          className={`${secondaryButtonClass} mt-3`}
          disabled={!online}
          onClick={onCreateOption}
        >
          Nova opção
        </button>
      )}
    </section>
  );
}
