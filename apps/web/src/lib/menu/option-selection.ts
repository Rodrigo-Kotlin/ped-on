import type { CartItemOption } from '../cart/cart';
import { addCents, decimalToCents, signedDecimalToCents } from '../money';
import type { PublicMenuOptionGroup, PublicMenuOption } from './menu';

export type OptionSelection = ReadonlyMap<string, ReadonlySet<string>>;

export function emptySelection(): OptionSelection {
  return new Map();
}

export function toggleSelection(
  selection: OptionSelection,
  group: PublicMenuOptionGroup,
  optionId: string,
): OptionSelection {
  const next = new Map(selection);
  const current = new Set(selection.get(group.id) ?? []);
  if (group.selection_mode === 'single') {
    const selected = current.has(optionId) ? new Set<string>() : new Set([optionId]);
    next.set(group.id, selected);
    return next;
  }
  const selected = new Set(current);
  if (selected.has(optionId)) {
    selected.delete(optionId);
  } else {
    selected.add(optionId);
  }
  next.set(group.id, selected);
  return next;
}

export function clearGroupSelection(selection: OptionSelection, groupId: string): OptionSelection {
  const next = new Map(selection);
  next.delete(groupId);
  return next;
}

export function selectedOptionIds(
  selection: OptionSelection,
  groupId: string,
): ReadonlySet<string> {
  return selection.get(groupId) ?? new Set<string>();
}

export function optionById(
  group: PublicMenuOptionGroup,
  optionId: string,
): PublicMenuOption | undefined {
  return group.options.find((option) => option.id === optionId);
}

const KIND_WORDS: Record<PublicMenuOptionGroup['kind'], { one: string; many: string }> = {
  variation: { one: 'opção', many: 'opções' },
  addon: { one: 'adicional', many: 'adicionais' },
  removal: { one: 'remoção', many: 'remoções' },
};

export function selectionError(
  group: PublicMenuOptionGroup,
  selection: OptionSelection,
): string | null {
  const selected = selectedOptionIds(selection, group.id);
  const { one, many } = KIND_WORDS[group.kind];
  if (selected.size < group.min_select) {
    return group.min_select === 1
      ? `Escolha 1 ${one} de ${group.name}.`
      : `Escolha ${group.min_select} ${many} de ${group.name}.`;
  }
  if (selected.size > group.max_select) {
    return `Escolha no máximo ${group.max_select} ${group.max_select === 1 ? one : many}.`;
  }
  return null;
}

export function firstSelectionError(
  groups: readonly PublicMenuOptionGroup[],
  selection: OptionSelection,
): string | null {
  for (const group of groups) {
    const error = selectionError(group, selection);
    if (error !== null) return error;
  }
  return null;
}

export function configuredPriceCents(
  basePrice: string,
  groups: readonly PublicMenuOptionGroup[],
  selection: OptionSelection,
): bigint {
  const deltas: bigint[] = [];
  for (const group of groups) {
    for (const optionId of selectedOptionIds(selection, group.id)) {
      const option = optionById(group, optionId);
      if (option !== undefined) {
        deltas.push(signedDecimalToCents(option.price_delta));
      }
    }
  }
  return addCents(decimalToCents(basePrice), ...deltas);
}

export function buildCartItemOptions(
  groups: readonly PublicMenuOptionGroup[],
  selection: OptionSelection,
): CartItemOption[] {
  const options: CartItemOption[] = [];
  for (const group of groups) {
    for (const option of group.options) {
      if (selectedOptionIds(selection, group.id).has(option.id)) {
        options.push({
          menu_group_id: group.id,
          menu_option_id: option.id,
          name: option.name,
          price_delta: option.price_delta,
        });
      }
    }
  }
  return options;
}
