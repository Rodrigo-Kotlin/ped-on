import type { OrderItemOptionKind } from './orders';

export interface OrderOptionDisplay {
  group_name: string;
  group_kind: OrderItemOptionKind;
  option_name: string;
}

export function orderOptionLabel(option: OrderOptionDisplay): string {
  if (option.group_kind === 'variation') {
    return `${option.group_name}: ${option.option_name}`;
  }
  if (option.group_kind === 'addon') {
    return `+ ${option.option_name}`;
  }
  return option.option_name;
}
