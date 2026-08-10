import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useAdmin } from '../lib/admin/admin-context';
import {
  DEFAULT_TIMEZONE,
  fetchUnitOperationalConfig,
  normalizeConfig,
  PAYMENT_METHOD_LABELS,
  saveUnitOperationalConfig,
  WEEKDAY_LABELS,
} from '../lib/config/operational-config';
import type { UnitOperationalConfigInput } from '../lib/config/operational-config';

const moneyRegex = /^\d+(\.\d{1,2})?$/;
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const businessHourSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  is_open: z.boolean(),
  is_24h: z.boolean(),
  open_time: z.string(),
  close_time: z.string(),
});

const paymentMethodSchema = z.object({
  method: z.enum(['cash', 'pix', 'credit_card', 'debit_card']),
  is_enabled: z.boolean(),
});

const configSchema = z
  .object({
    timezone: z.string().min(1, 'Informe o fuso horário'),
    pickup_enabled: z.boolean(),
    delivery_enabled: z.boolean(),
    delivery_fee: z.string().trim().regex(moneyRegex, 'Use um valor com até 2 casas decimais'),
    min_order_value: z.string().trim().regex(moneyRegex, 'Use um valor com até 2 casas decimais'),
    estimated_pickup_minutes: z.string().trim(),
    estimated_delivery_minutes: z.string().trim(),
    accepting_orders: z.boolean(),
    business_hours: z.array(businessHourSchema).length(7),
    payment_methods: z.array(paymentMethodSchema),
  })
  .superRefine((values, ctx) => {
    if (!values.pickup_enabled && !values.delivery_enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pickup_enabled'],
        message: 'Selecione ao menos uma modalidade (retirada ou entrega)',
      });
    }
    values.business_hours.forEach((hour, index) => {
      if (hour.is_open && !hour.is_24h) {
        if (!timeRegex.test(hour.open_time)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['business_hours', index, 'open_time'],
            message: 'Horário inválido (formato HH:MM)',
          });
        }
        if (!timeRegex.test(hour.close_time)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['business_hours', index, 'close_time'],
            message: 'Horário inválido (formato HH:MM)',
          });
        }
      }
    });
    ['estimated_pickup_minutes', 'estimated_delivery_minutes'].forEach((field) => {
      const raw = values[field as 'estimated_pickup_minutes'];
      if (raw !== '') {
        const num = Number(raw);
        if (!Number.isInteger(num) || num < 0 || num > 1440) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: 'Informe minutos inteiros entre 0 e 1440',
          });
        }
      }
    });
  });

type ConfigFormValues = z.infer<typeof configSchema>;

const TIMEZONES = [
  DEFAULT_TIMEZONE,
  'America/Manaus',
  'America/Noronha',
  'America/Recife',
  'America/Santarem',
  'America/Bahia',
  'America/Cuiaba',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Rio_Branco',
  'Europe/Lisbon',
  'Atlantic/Azores',
];

function fromServerConfig(
  config: NonNullable<ReturnType<typeof normalizeConfig>>,
): ConfigFormValues {
  return {
    timezone: config.timezone,
    pickup_enabled: config.pickup_enabled,
    delivery_enabled: config.delivery_enabled,
    delivery_fee: config.delivery_fee,
    min_order_value: config.min_order_value,
    estimated_pickup_minutes:
      config.estimated_pickup_minutes === null ? '' : String(config.estimated_pickup_minutes),
    estimated_delivery_minutes:
      config.estimated_delivery_minutes === null ? '' : String(config.estimated_delivery_minutes),
    accepting_orders: config.accepting_orders,
    business_hours: config.business_hours.map((hour) => ({
      weekday: hour.weekday,
      is_open: hour.is_open,
      is_24h: hour.is_24h,
      open_time: hour.is_open && !hour.is_24h && hour.open_time !== null ? hour.open_time : '',
      close_time: hour.is_open && !hour.is_24h && hour.close_time !== null ? hour.close_time : '',
    })),
    payment_methods: config.payment_methods,
  };
}

function toServerConfig(values: ConfigFormValues): UnitOperationalConfigInput {
  return {
    timezone: values.timezone,
    pickup_enabled: values.pickup_enabled,
    delivery_enabled: values.delivery_enabled,
    delivery_fee: values.delivery_fee,
    min_order_value: values.min_order_value,
    estimated_pickup_minutes:
      values.estimated_pickup_minutes === '' ? null : Number(values.estimated_pickup_minutes),
    estimated_delivery_minutes:
      values.estimated_delivery_minutes === '' ? null : Number(values.estimated_delivery_minutes),
    accepting_orders: values.accepting_orders,
    business_hours: values.business_hours.map((hour) => ({
      weekday: hour.weekday,
      is_open: hour.is_open,
      is_24h: hour.is_24h,
      open_time: hour.is_open && !hour.is_24h ? hour.open_time : null,
      close_time: hour.is_open && !hour.is_24h ? hour.close_time : null,
    })),
    payment_methods: values.payment_methods,
  };
}

export function ConfiguracoesPage() {
  const { selectedUnit } = useAdmin();
  const queryClient = useQueryClient();

  const {
    data: serverConfig,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['unit-operational-config', selectedUnit?.id ?? ''],
    queryFn: () => fetchUnitOperationalConfig(selectedUnit!.id),
    enabled: selectedUnit !== null,
  });

  const normalized = useMemo(
    () => (serverConfig !== undefined ? normalizeConfig(serverConfig) : null),
    [serverConfig],
  );

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ConfigFormValues>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      timezone: DEFAULT_TIMEZONE,
      pickup_enabled: true,
      delivery_enabled: false,
      delivery_fee: '0.00',
      min_order_value: '0.00',
      estimated_pickup_minutes: '',
      estimated_delivery_minutes: '',
      accepting_orders: false,
      business_hours: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        is_open: false,
        is_24h: false,
        open_time: '',
        close_time: '',
      })),
      payment_methods: [
        { method: 'cash', is_enabled: false },
        { method: 'pix', is_enabled: false },
        { method: 'credit_card', is_enabled: false },
        { method: 'debit_card', is_enabled: false },
      ],
    },
  });

  useEffect(() => {
    if (normalized !== null) {
      reset(fromServerConfig(normalized));
    }
  }, [normalized, reset]);

  const watchedHours = useWatch({ control, name: 'business_hours' });
  const pickupEnabled = useWatch({ control, name: 'pickup_enabled' });
  const deliveryEnabled = useWatch({ control, name: 'delivery_enabled' });
  const watchedPayments = useWatch({ control, name: 'payment_methods' });

  async function onSubmit(values: ConfigFormValues) {
    if (selectedUnit === null) {
      return;
    }
    const { config, error } = await saveUnitOperationalConfig(
      selectedUnit.id,
      toServerConfig(values),
    );
    if (config !== null) {
      queryClient.setQueryData(['unit-operational-config', selectedUnit.id], config);
      reset(fromServerConfig(normalizeConfig(config)));
    } else if (error !== null) {
      alert(error.message);
    }
  }

  if (selectedUnit === null) {
    return (
      <p className="text-pedon-text/70">
        Selecione uma unidade para configurar. Nenhuma unidade disponível ainda.
      </p>
    );
  }

  if (isLoading) {
    return <p className="text-pedon-text/70">Carregando configuração da unidade…</p>;
  }

  if (isError) {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        Não foi possível carregar a configuração: {(error as Error).message}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm font-semibold uppercase tracking-wider text-pedon-orange">
        Configurações
      </p>
      <h2 className="mt-1 text-2xl font-bold text-pedon-navy">{selectedUnit.name}</h2>
      <p className="mt-1 text-sm text-pedon-text/70">
        Defina como a unidade opera: modalidades, valores, horários e formas de pagamento.
      </p>
      {normalized?.configured === false && (
        <p
          role="status"
          className="mt-3 rounded-md bg-pedon-surface px-3 py-2 text-sm text-pedon-text"
        >
          Esta unidade ainda não tem configuração salva. Enquanto isso, ela fica com{' '}
          <span className="font-medium">pedidos desligados</span>. Salve a configuração para começar
          a receber pedidos.
        </p>
      )}

      <form className="mt-6 space-y-6" onSubmit={handleSubmit(onSubmit)} noValidate>
        <section
          aria-label="Modalidades de atendimento"
          className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
        >
          <h3 className="font-semibold text-pedon-navy">Modalidades de atendimento</h3>
          <div className="mt-3 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-pedon-text">
              <input type="checkbox" className="size-4" {...register('pickup_enabled')} />
              Retirada no local (pickup)
            </label>
            <label className="flex items-center gap-2 text-sm text-pedon-text">
              <input type="checkbox" className="size-4" {...register('delivery_enabled')} />
              Entrega (delivery)
            </label>
          </div>
          {errors.pickup_enabled?.message !== undefined && (
            <p className="mt-2 text-sm text-red-700">{errors.pickup_enabled.message}</p>
          )}
        </section>

        <section
          aria-label="Valores"
          className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
        >
          <h3 className="font-semibold text-pedon-navy">Valores</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="delivery_fee" className="block text-sm font-medium text-pedon-text">
                Taxa de entrega (R$)
              </label>
              <input
                id="delivery_fee"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30"
                aria-invalid={errors.delivery_fee !== undefined}
                {...register('delivery_fee')}
              />
              {errors.delivery_fee !== undefined && (
                <p className="mt-1 text-sm text-red-700">{errors.delivery_fee.message}</p>
              )}
            </div>
            <div>
              <label
                htmlFor="min_order_value"
                className="block text-sm font-medium text-pedon-text"
              >
                Pedido mínimo (R$)
              </label>
              <input
                id="min_order_value"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30"
                aria-invalid={errors.min_order_value !== undefined}
                {...register('min_order_value')}
              />
              {errors.min_order_value !== undefined && (
                <p className="mt-1 text-sm text-red-700">{errors.min_order_value.message}</p>
              )}
            </div>
          </div>
        </section>

        <section
          aria-label="Tempo de preparo"
          className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
        >
          <h3 className="font-semibold text-pedon-navy">Tempo de preparo estimado (minutos)</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="estimated_pickup_minutes"
                className="block text-sm font-medium text-pedon-text"
              >
                Retirada
              </label>
              <input
                id="estimated_pickup_minutes"
                type="number"
                min={0}
                max={1440}
                step={1}
                placeholder="—"
                disabled={!pickupEnabled}
                className="mt-1 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30 disabled:cursor-not-allowed disabled:bg-pedon-surface disabled:opacity-60"
                {...register('estimated_pickup_minutes')}
              />
              {errors.estimated_pickup_minutes !== undefined && (
                <p className="mt-1 text-sm text-red-700">
                  {errors.estimated_pickup_minutes.message}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="estimated_delivery_minutes"
                className="block text-sm font-medium text-pedon-text"
              >
                Entrega
              </label>
              <input
                id="estimated_delivery_minutes"
                type="number"
                min={0}
                max={1440}
                step={1}
                placeholder="—"
                disabled={!deliveryEnabled}
                className="mt-1 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30 disabled:cursor-not-allowed disabled:bg-pedon-surface disabled:opacity-60"
                {...register('estimated_delivery_minutes')}
              />
              {errors.estimated_delivery_minutes !== undefined && (
                <p className="mt-1 text-sm text-red-700">
                  {errors.estimated_delivery_minutes.message}
                </p>
              )}
            </div>
          </div>
        </section>

        <section
          aria-label="Fuso horário"
          className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
        >
          <h3 className="font-semibold text-pedon-navy">Fuso horário</h3>
          <div className="mt-3 max-w-sm">
            <label htmlFor="timezone" className="block text-sm font-medium text-pedon-text">
              Zona IANA
            </label>
            <select
              id="timezone"
              className="mt-1 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30"
              {...register('timezone')}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section
          aria-label="Horários de funcionamento"
          className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
        >
          <h3 className="font-semibold text-pedon-navy">Horários de funcionamento</h3>
          <ul className="mt-3 space-y-3">
            {watchedHours.map((hour, index) => {
              const isOpen = hour.is_open;
              const is24h = hour.is_24h;
              const needsTimes = isOpen && !is24h;
              return (
                <li
                  key={hour.weekday}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-pedon-navy/10 p-3"
                >
                  <label className="flex items-center gap-2 text-sm font-medium text-pedon-text">
                    <input
                      type="checkbox"
                      className="size-4"
                      {...register(`business_hours.${index}.is_open`)}
                    />
                    {WEEKDAY_LABELS[hour.weekday]}
                  </label>

                  <label className="flex items-center gap-2 text-sm text-pedon-text/80">
                    <input
                      type="checkbox"
                      disabled={!isOpen}
                      className="size-4 disabled:cursor-not-allowed disabled:opacity-50"
                      {...register(`business_hours.${index}.is_24h`)}
                    />
                    24h
                  </label>

                  <label className="flex items-center gap-2 text-sm text-pedon-text/80">
                    <span>Das</span>
                    <input
                      type="time"
                      disabled={!needsTimes}
                      className="rounded-md border border-pedon-navy/20 bg-white px-2 py-1 text-sm text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30 disabled:cursor-not-allowed disabled:opacity-50"
                      {...register(`business_hours.${index}.open_time`)}
                    />
                    <span>às</span>
                    <input
                      type="time"
                      disabled={!needsTimes}
                      className="rounded-md border border-pedon-navy/20 bg-white px-2 py-1 text-sm text-pedon-text focus:border-pedon-orange focus:outline-none focus:ring-2 focus:ring-pedon-orange/30 disabled:cursor-not-allowed disabled:opacity-50"
                      {...register(`business_hours.${index}.close_time`)}
                    />
                  </label>

                  {errors.business_hours?.[index]?.open_time?.message !== undefined && (
                    <p className="w-full text-sm text-red-700">
                      {errors.business_hours[index].open_time.message}
                    </p>
                  )}
                  {errors.business_hours?.[index]?.close_time?.message !== undefined && (
                    <p className="w-full text-sm text-red-700">
                      {errors.business_hours[index].close_time.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section
          aria-label="Formas de pagamento"
          className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
        >
          <h3 className="font-semibold text-pedon-navy">Formas de pagamento aceitas</h3>
          <ul className="mt-3 space-y-2">
            {watchedPayments.map((payment, index) => (
              <li key={payment.method}>
                <label className="flex items-center gap-2 text-sm text-pedon-text">
                  <input
                    type="checkbox"
                    className="size-4"
                    {...register(`payment_methods.${index}.is_enabled`)}
                  />
                  {PAYMENT_METHOD_LABELS[payment.method]}
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-label="Aceite de pedidos"
          className="rounded-lg border border-pedon-navy/15 bg-white p-4 shadow-sm"
        >
          <label className="flex items-center gap-3">
            <input type="checkbox" className="size-4" {...register('accepting_orders')} />
            <span className="text-sm text-pedon-text">
              <span className="font-medium">Aceitando pedidos</span> — quando desligado, a unidade
              para de receber pedidos.
            </span>
          </label>
        </section>

        {errors.business_hours?.root !== undefined && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {errors.business_hours.root.message}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-pedon-navy px-4 py-2.5 font-medium text-white transition hover:bg-pedon-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Salvando…' : 'Salvar configuração'}
          </button>
          {!isDirty && (
            <span className="text-sm text-pedon-text/60">Tudo salvo até o momento.</span>
          )}
        </div>
      </form>
    </div>
  );
}
