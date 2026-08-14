import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { useCart } from '../lib/cart/cart-context';
import { cartSubtotalCents, isCartStale } from '../lib/cart/cart';
import { addCents, centsToDecimal, decimalToCents, formatBRL } from '../lib/money';
import { publicMenuQueryKey, publicMenuQueryOptions } from '../lib/menu/public-menu-query';
import { assertOnline } from '../lib/offline/useOnline';
import { useCriticalOperation } from '../lib/pwa/critical-operation';
import {
  createPublicOrder,
  getPublicOrderByAttempt,
  PAYMENT_METHOD_LABELS,
  PublicOrderError,
  SERVICE_MODE_LABELS,
} from '../lib/orders/orders';
import type {
  CreatePublicOrderPayload,
  PaymentMethodCode,
  PublicOrderErrorCode,
  PublicOrderItemInput,
  ServiceMode,
} from '../lib/orders/orders';
import type { PublicMenuData } from '../lib/menu/menu';
import { isPlainText } from '../lib/plain-text';
import {
  cpfSchema,
  isLoyaltyToken,
  loyaltyNameSchema,
  LoyaltyError,
  maskCpf,
  resolveLoyaltyIdentity,
} from '../lib/loyalty/loyalty';
import type { LoyaltyResolveFound } from '../lib/loyalty/loyalty';
import {
  clearPendingOrderAttempt,
  createAttemptRecoveryHash,
  fingerprintOrderPayload,
  loadPendingOrderAttempt,
  savePendingOrderAttempt,
} from '../lib/orders/pending-order';
import type { PendingOrderAttempt } from '../lib/orders/pending-order';

const plainText = (minimum: number, maximum: number, requiredMessage: string) =>
  z
    .string()
    .trim()
    .min(minimum, requiredMessage)
    .max(maximum, `Use no máximo ${maximum} caracteres`)
    .refine(isPlainText, 'Use apenas texto simples');

const optionalPlainText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum, `Use no máximo ${maximum} caracteres`)
    .refine(isPlainText, 'Use apenas texto simples');

const checkoutSchema = z
  .object({
    name: plainText(2, 120, 'Informe seu nome'),
    phone: z
      .string()
      .trim()
      .regex(
        /^([0-9]{10,11}|\([0-9]{2}\) ?[0-9]{4,5}-[0-9]{4}|[0-9]{2} ?[0-9]{4,5}-[0-9]{4})$/,
        'Informe um telefone com DDD',
      ),
    service_mode: z.enum(['pickup', 'delivery']),
    payment_method: z.enum(['cash', 'pix', 'credit_card', 'debit_card']),
    cash_change_for: z
      .string()
      .trim()
      .refine(
        (value) => value === '' || /^(0|[1-9]\d{0,9})(?:[.,]\d{1,2})?$/.test(value),
        'Informe um valor válido para troco',
      ),
    notes: optionalPlainText(500),
    street: optionalPlainText(120),
    number: optionalPlainText(20),
    complement: optionalPlainText(120),
    neighborhood: optionalPlainText(80),
    city: optionalPlainText(80),
    state: z.string().trim().max(2, 'Use a sigla com 2 letras'),
    postal_code: z
      .string()
      .trim()
      .refine((value) => value === '' || /^[0-9]{5}-?[0-9]{3}$/.test(value), 'CEP inválido'),
    reference: optionalPlainText(160),
  })
  .superRefine((values, context) => {
    if (values.service_mode === 'delivery') {
      const requiredAddress: Array<[keyof typeof values, string, number]> = [
        ['street', 'Informe a rua', 2],
        ['number', 'Informe o número', 1],
        ['neighborhood', 'Informe o bairro', 2],
        ['city', 'Informe a cidade', 2],
      ];
      requiredAddress.forEach(([field, message, minimum]) => {
        if (String(values[field]).length < minimum) {
          context.addIssue({ code: 'custom', path: [field], message });
        }
      });
      if (!/^[A-Za-z]{2}$/.test(values.state)) {
        context.addIssue({ code: 'custom', path: ['state'], message: 'Informe a UF com 2 letras' });
      }
    }
  });

type CheckoutFormValues = z.infer<typeof checkoutSchema>;
type SubmitError = { code: PublicOrderErrorCode | null; message: string };

const clubEnrollCheckoutSchema = z.object({
  name: loyaltyNameSchema,
  consent: z
    .boolean()
    .refine((value) => value, 'É necessário aceitar os termos para entrar no Clube.'),
});

const inputClass =
  'mt-1 min-h-11 w-full rounded-md border border-pedon-navy/20 bg-white px-3 py-2 text-base text-pedon-text';

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p id={id} className="mt-1 text-sm text-red-700">
      {message}
    </p>
  );
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function CheckoutPage() {
  const { runCriticalOperation } = useCriticalOperation();
  const { publicSlug = '' } = useParams<{ publicSlug: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { cart, clearCart } = useCart();
  const finishRecoveredAttempt = useEffectEvent((trackingToken: string) => {
    clearCart();
    clearPendingOrderAttempt(publicSlug);
    navigate(`/pedido/${trackingToken}`, { replace: true });
  });
  const menuQuery = useQuery(publicMenuQueryOptions(publicSlug));
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [attempt, setAttempt] = useState<PendingOrderAttempt | null>(() =>
    loadPendingOrderAttempt(publicSlug),
  );
  const [attemptPayloadFingerprint, setAttemptPayloadFingerprint] = useState<string | null>(null);
  const [recoveringAttempt, setRecoveringAttempt] = useState(attempt !== null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [club, setClub] = useState<{ found: LoyaltyResolveFound; optIn: boolean } | null>(null);
  const [clubOpen, setClubOpen] = useState(false);
  const [clubCpf, setClubCpf] = useState('');
  const [clubName, setClubName] = useState('');
  const [clubConsent, setClubConsent] = useState(false);
  const [clubStatus, setClubStatus] = useState<'idle' | 'enroll' | 'checking'>('idle');
  const [clubCpfError, setClubCpfError] = useState<string | null>(null);
  const [clubEnrollError, setClubEnrollError] = useState<string | null>(null);
  const [clubError, setClubError] = useState<string | null>(null);
  const clubChecking = clubStatus === 'checking';

  const {
    register,
    handleSubmit,
    control,
    getValues,
    trigger,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      name: '',
      phone: '',
      service_mode: 'pickup',
      payment_method: 'pix',
      cash_change_for: '',
      notes: '',
      street: '',
      number: '',
      complement: '',
      neighborhood: '',
      city: '',
      state: '',
      postal_code: '',
      reference: '',
    },
  });

  const serviceMode = useWatch({ control, name: 'service_mode' });
  const paymentMethod = useWatch({ control, name: 'payment_method' });
  const menuResult = menuQuery.data;
  const menu: PublicMenuData | null = menuResult?.found === true ? menuResult : null;
  const enabledModes: ServiceMode[] =
    menu === null
      ? []
      : ([
          menu.operation.pickup_enabled && 'pickup',
          menu.operation.delivery_enabled && 'delivery',
        ].filter(Boolean) as ServiceMode[]);
  const enabledPayments: PaymentMethodCode[] =
    menu?.operation.payment_methods
      .filter((method) => method.is_enabled)
      .map((method) => method.method) ?? [];

  useEffect(() => {
    if (menu === null) return;
    const availableModes = [
      menu.operation.pickup_enabled && 'pickup',
      menu.operation.delivery_enabled && 'delivery',
    ].filter(Boolean) as ServiceMode[];
    const availablePayments = menu.operation.payment_methods
      .filter((method) => method.is_enabled)
      .map((method) => method.method);
    if (availableModes.length > 0 && !availableModes.includes(getValues('service_mode'))) {
      setValue('service_mode', availableModes[0]!);
    }
    if (availablePayments.length > 0 && !availablePayments.includes(getValues('payment_method'))) {
      setValue('payment_method', availablePayments[0]!);
    }
  }, [getValues, menu, setValue]);

  useEffect(() => {
    const savedAttempt = loadPendingOrderAttempt(publicSlug);
    if (savedAttempt === null) return;
    let active = true;
    void getPublicOrderByAttempt(
      publicSlug,
      savedAttempt.idempotency_key,
      savedAttempt.request_fingerprint,
    )
      .then((result) => {
        if (!active) return;
        if (result.found) {
          finishRecoveredAttempt(result.tracking_token);
          return;
        }
        clearPendingOrderAttempt(publicSlug);
        setAttempt(null);
        setAttemptPayloadFingerprint(null);
      })
      .catch(() => {
        // Ambiguous recovery: keep the credential and block a blind resubmit with an unknown payload.
        if (active) setRecoveryBlocked(true);
      })
      .finally(() => {
        if (active) setRecoveringAttempt(false);
      });
    return () => {
      active = false;
    };
  }, [publicSlug]);

  function retryRecovery() {
    const savedAttempt = attempt;
    if (savedAttempt === null) {
      setRecoveryBlocked(false);
      setRecoveringAttempt(false);
      return;
    }
    setRecoveringAttempt(true);
    setRecoveryBlocked(false);
    void getPublicOrderByAttempt(
      publicSlug,
      savedAttempt.idempotency_key,
      savedAttempt.request_fingerprint,
    )
      .then((result) => {
        if (result.found) {
          clearCart();
          clearPendingOrderAttempt(publicSlug);
          navigate(`/pedido/${result.tracking_token}`, { replace: true });
          return;
        }
        clearPendingOrderAttempt(publicSlug);
        setAttempt(null);
        setAttemptPayloadFingerprint(null);
      })
      .catch(() => {
        setRecoveryBlocked(true);
      })
      .finally(() => {
        setRecoveringAttempt(false);
      });
  }

  const stale = menu !== null && isCartStale(cart, menu.menu.version_id);
  const subtotal = cartSubtotalCents(cart);
  const deliveryFee =
    menu !== null && serviceMode === 'delivery' ? decimalToCents(menu.operation.delivery_fee) : 0n;
  const estimatedTotal = addCents(subtotal, deliveryFee);

  function confirmClearCart() {
    if (window.confirm('Limpar o carrinho antigo e começar novamente com este cardápio?')) {
      clearPendingOrderAttempt(publicSlug);
      setAttempt(null);
      setAttemptPayloadFingerprint(null);
      clearCart();
      navigate(`/menu/${publicSlug}`);
    }
  }

  async function submitClubCpf() {
    const phoneValid = await trigger('phone', { shouldFocus: true });
    if (!phoneValid) {
      setClubError('Informe um telefone válido com DDD para confirmar sua identidade.');
      return;
    }
    const parsed = cpfSchema.safeParse(clubCpf);
    if (!parsed.success) {
      setClubCpfError(parsed.error.issues[0]?.message ?? 'CPF inválido.');
      return;
    }
    setClubCpfError(null);
    setClubError(null);
    setClubStatus('checking');
    try {
      const result = await resolveLoyaltyIdentity({
        publicSlug,
        mode: 'lookup',
        cpf: parsed.data,
        phone: getValues('phone'),
      });
      if (result.found === true) {
        setClub({ found: result, optIn: true });
        setClubOpen(true);
        setClubStatus('idle');
      } else {
        setClubStatus('enroll');
      }
    } catch (error) {
      if (error instanceof LoyaltyError && error.code === 'IDENTITY_NOT_CONFIRMED') {
        setClubStatus('enroll');
      } else {
        setClubStatus('idle');
      }
      setClubError(
        error instanceof LoyaltyError ? error.message : 'Não foi possível processar a solicitação.',
      );
    }
  }

  async function submitClubEnroll() {
    const phoneValid = await trigger('phone', { shouldFocus: true });
    if (!phoneValid) {
      setClubError('Informe um telefone válido com DDD para confirmar sua identidade.');
      return;
    }
    const parsed = clubEnrollCheckoutSchema.safeParse({ name: clubName, consent: clubConsent });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Revise os dados do cadastro.';
      setClubEnrollError(message);
      return;
    }
    setClubEnrollError(null);
    setClubError(null);
    setClubStatus('checking');
    try {
      const result = await resolveLoyaltyIdentity({
        publicSlug,
        mode: 'enroll',
        cpf: clubCpf,
        phone: getValues('phone'),
        name: parsed.data.name,
        consent: true,
      });
      if (result.found === true) {
        setClub({ found: result, optIn: true });
        setClubOpen(true);
        setClubStatus('idle');
      }
    } catch (error) {
      setClubError(
        error instanceof LoyaltyError ? error.message : 'Não foi possível processar a solicitação.',
      );
      setClubStatus('enroll');
    }
  }

  function unlinkClub() {
    setClub(null);
    setClubOpen(false);
    setClubStatus('idle');
    setClubCpf('');
    setClubName('');
    setClubConsent(false);
    setClubCpfError(null);
    setClubEnrollError(null);
    setClubError(null);
  }

  async function onSubmit(values: CheckoutFormValues) {
    if (
      menu === null ||
      menu.operation.revision === null ||
      !menu.operation.can_order_now ||
      cart.items.length === 0 ||
      stale ||
      !enabledModes.includes(values.service_mode) ||
      !enabledPayments.includes(values.payment_method)
    )
      return;

    const normalizedCash = values.cash_change_for.replace(',', '.');
    if (
      values.payment_method === 'cash' &&
      normalizedCash !== '' &&
      decimalToCents(normalizedCash) < estimatedTotal
    ) {
      setError(
        'cash_change_for',
        { message: 'O valor para troco deve cobrir o total estimado' },
        { shouldFocus: true },
      );
      return;
    }

    const payloadItems: PublicOrderItemInput[] = cart.items.map((item) => {
      const note = optional(item.note);
      const options = item.options.map((option) => option.menu_option_id).sort();
      return {
        menu_item_id: item.menu_item_id,
        quantity: item.quantity,
        ...(note === undefined ? {} : { note }),
        ...(options.length === 0 ? {} : { options }),
      };
    });
    const payload: CreatePublicOrderPayload = {
      menu_version_id: menu.menu.version_id,
      operation_revision: menu.operation.revision,
      service_mode: values.service_mode,
      payment_method: values.payment_method,
      customer: { name: values.name.trim(), phone: values.phone.trim() },
      items: payloadItems,
    };
    const notes = optional(values.notes);
    if (notes !== undefined) payload.notes = notes;
    if (values.payment_method === 'cash' && normalizedCash !== '') {
      payload.cash_change_for = centsToDecimal(decimalToCents(normalizedCash));
    }
    if (values.service_mode === 'delivery') {
      const address: NonNullable<CreatePublicOrderPayload['delivery_address']> = {
        street: values.street.trim(),
        number: values.number.trim(),
        neighborhood: values.neighborhood.trim(),
        city: values.city.trim(),
        state: values.state.trim().toUpperCase(),
      };
      const complement = optional(values.complement);
      const postalCode = optional(values.postal_code);
      const reference = optional(values.reference);
      if (complement !== undefined) address.complement = complement;
      if (postalCode !== undefined) address.postal_code = postalCode;
      if (reference !== undefined) address.reference = reference;
      payload.delivery_address = address;
    }

    if (
      club !== null &&
      club.optIn &&
      isLoyaltyToken(club.found.token.access_token) &&
      menu.loyalty.enabled
    ) {
      payload.loyalty_token = club.found.token.access_token;
    }

    let onlineMessage: string | null = null;
    try {
      assertOnline();
    } catch (error) {
      onlineMessage =
        error instanceof Error
          ? error.message
          : 'Você está offline. Operações que exigem conexão estão pausadas.';
    }
    if (onlineMessage !== null) {
      setSubmitError({ code: null, message: onlineMessage });
      return;
    }

    const payloadFingerprint = await fingerprintOrderPayload(payload);
    const pendingAttempt: PendingOrderAttempt =
      attempt !== null && attemptPayloadFingerprint === payloadFingerprint
        ? attempt
        : {
            idempotency_key: crypto.randomUUID(),
            request_fingerprint: createAttemptRecoveryHash(),
            public_slug: publicSlug,
            created_at: new Date().toISOString(),
          };
    if (attempt !== pendingAttempt) setAttempt(pendingAttempt);
    setAttemptPayloadFingerprint(payloadFingerprint);

    if (!savePendingOrderAttempt(pendingAttempt)) {
      setSubmitError({
        code: null,
        message:
          'Não foi possível preparar este pedido com segurança neste navegador. Tente novamente após liberar o armazenamento do site.',
      });
      return;
    }
    setSubmitError(null);

    try {
      const result = await runCriticalOperation(() =>
        createPublicOrder(
          publicSlug,
          pendingAttempt.idempotency_key,
          pendingAttempt.request_fingerprint,
          payload,
        ),
      );
      clearPendingOrderAttempt(publicSlug);
      clearCart();
      navigate(`/pedido/${result.tracking_token}`);
    } catch (error) {
      const orderError =
        error instanceof PublicOrderError
          ? error
          : new PublicOrderError(
              error instanceof Error && error.message.startsWith('Você está offline.')
                ? error.message
                : 'Não foi possível processar o pedido. Tente novamente.',
              null,
            );
      setSubmitError({
        code: orderError.code,
        message:
          orderError.code === 'PED41'
            ? `${orderError.message} Mínimo: ${formatBRL(menu.operation.minimum_order_amount)}.`
            : orderError.message,
      });
      if (
        orderError.code === 'PED35' ||
        orderError.code === 'PED36' ||
        orderError.code === 'PED38' ||
        (orderError.code !== null && /^PED7[2-8]$/.test(orderError.code))
      ) {
        await queryClient.invalidateQueries({
          queryKey: publicMenuQueryKey(publicSlug),
          refetchType: 'none',
        });
        await menuQuery.refetch();
      }
      if (orderError.code === 'PED52') {
        unlinkClub();
      }
      if (
        orderError.code === 'PED35' ||
        orderError.code === 'PED36' ||
        orderError.code === 'PED38' ||
        orderError.code === 'PED41' ||
        (orderError.code !== null && /^PED7[2-8]$/.test(orderError.code))
      ) {
        clearPendingOrderAttempt(publicSlug);
        setAttempt(null);
        setAttemptPayloadFingerprint(null);
      }
    }
  }

  if (menuQuery.isLoading)
    return (
      <p role="status" className="p-6 text-center">
        Carregando checkout…
      </p>
    );
  if (menuQuery.isError || menu === null) {
    return (
      <p role="alert" className="p-6 text-center text-red-700">
        Não foi possível carregar o checkout.
      </p>
    );
  }
  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center">
        <h1 className="text-2xl font-bold text-pedon-navy">Carrinho vazio</h1>
        <Link
          to={`/menu/${publicSlug}`}
          className="mt-5 inline-flex min-h-11 items-center rounded-md bg-pedon-orange px-4 font-semibold text-white"
        >
          Voltar ao cardápio
        </Link>
      </div>
    );
  }
  if (stale || submitError?.code === 'PED35') {
    return (
      <div className="mx-auto max-w-lg p-6">
        <h1 className="text-2xl font-bold text-pedon-navy">Revise seu carrinho</h1>
        <p role="alert" className="mt-4 rounded-md bg-amber-50 p-3 text-amber-900">
          {submitError?.message ?? 'O cardápio mudou. Seu carrinho antigo foi preservado.'}
        </p>
        <button
          type="button"
          onClick={confirmClearCart}
          className="mt-4 min-h-11 rounded-md bg-pedon-navy px-4 font-semibold text-white"
        >
          Limpar e refazer carrinho
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-pedon-surface px-4 py-5">
      <div className="mx-auto w-full max-w-lg">
        <Link
          to={`/menu/${publicSlug}/carrinho`}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-pedon-navy"
        >
          ← Voltar ao carrinho
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-pedon-navy">Finalizar pedido</h1>
        <p className="mt-2 text-sm text-pedon-text/70">
          O pagamento é feito diretamente ao estabelecimento. O Ped-On não processa pagamentos.
        </p>

        {submitError !== null && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            <p role="alert" aria-live="assertive">
              {submitError.message}
            </p>
            {submitError.code !== null && /^PED7[2-8]$/.test(submitError.code) && (
              <Link
                to={`/menu/${publicSlug}/carrinho`}
                className="mt-3 inline-flex min-h-11 items-center rounded-md border border-red-300 px-3 font-semibold"
              >
                Revisar carrinho
              </Link>
            )}
          </div>
        )}

        {recoveryBlocked && (
          <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            <p role="alert" className="font-medium">
              Não foi possível confirmar se um pedido anterior foi concluído neste navegador.
            </p>
            <p className="mt-1 text-amber-900/80">
              Verifique novamente antes de enviar um novo pedido. O rascunho de recuperação foi
              preservado.
            </p>
            <button
              type="button"
              onClick={retryRecovery}
              className="mt-3 min-h-11 rounded-md border border-amber-800 px-4 font-semibold text-amber-900"
            >
              Tentar recuperar pedido anterior
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-5 space-y-5">
          <section aria-labelledby="customer-title" className="rounded-lg bg-white p-4 shadow-sm">
            <h2 id="customer-title" className="font-bold text-pedon-navy">
              Seus dados
            </h2>
            <label htmlFor="name" className="mt-4 block text-sm font-medium">
              Nome
            </label>
            <input
              id="name"
              autoComplete="name"
              aria-invalid={errors.name !== undefined}
              aria-describedby={errors.name ? 'name-error' : undefined}
              className={inputClass}
              {...register('name')}
            />
            <FieldError id="name-error" message={errors.name?.message} />
            <label htmlFor="phone" className="mt-4 block text-sm font-medium">
              Telefone com DDD
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              aria-invalid={errors.phone !== undefined}
              aria-describedby={errors.phone ? 'phone-error' : undefined}
              className={inputClass}
              {...register('phone')}
            />
            <FieldError id="phone-error" message={errors.phone?.message} />
          </section>

          {menu.loyalty.enabled && (
            <section
              aria-labelledby="club-checkout-title"
              className="rounded-lg bg-white p-4 shadow-sm"
            >
              <h2 id="club-checkout-title" className="font-bold text-pedon-navy">
                Clube Ped-On
              </h2>
              {club === null ? (
                <>
                  <p className="mt-2 text-sm text-pedon-text/70">
                    Vincule seu Clube a esta compra para acumular pontos nela.
                  </p>
                  {!clubOpen && (
                    <button
                      type="button"
                      onClick={() => setClubOpen(true)}
                      className="mt-3 min-h-11 rounded-md border border-pedon-orange px-4 font-semibold text-pedon-orange"
                    >
                      Quero ganhar pontos
                    </button>
                  )}
                  {clubOpen && (
                    <div className="mt-3 space-y-4">
                      <div>
                        <label htmlFor="club-checkout-cpf" className="block text-sm font-medium">
                          CPF
                        </label>
                        <input
                          id="club-checkout-cpf"
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="000.000.000-00"
                          value={clubCpf}
                          onChange={(event) => setClubCpf(event.target.value)}
                          disabled={clubChecking}
                          aria-invalid={clubCpfError !== null}
                          aria-describedby={
                            clubCpfError !== null ? 'club-checkout-cpf-error' : undefined
                          }
                          className={inputClass}
                        />
                        <FieldError
                          id="club-checkout-cpf-error"
                          message={clubCpfError ?? undefined}
                        />
                      </div>

                      {clubStatus === 'enroll' && (
                        <div className="space-y-4 rounded-md bg-pedon-surface p-3">
                          <p role="status" className="text-sm text-pedon-text">
                            Não foi possível confirmar um cadastro com os dados informados. Complete
                            seu cadastro para entrar no Clube:
                          </p>
                          <div>
                            <label
                              htmlFor="club-checkout-name"
                              className="block text-sm font-medium"
                            >
                              Nome
                            </label>
                            <input
                              id="club-checkout-name"
                              autoComplete="name"
                              value={clubName}
                              onChange={(event) => setClubName(event.target.value)}
                              disabled={clubChecking}
                              aria-invalid={clubEnrollError !== null}
                              aria-describedby={
                                clubEnrollError !== null ? 'club-checkout-enroll-error' : undefined
                              }
                              className={inputClass}
                            />
                          </div>
                          <label className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={clubConsent}
                              onChange={(event) => setClubConsent(event.target.checked)}
                              disabled={clubChecking}
                              className="mt-1 size-4"
                            />
                            <span className="text-sm text-pedon-text">
                              Aceito participar do Clube Ped-On e concordo com o uso dos meus dados
                              para o programa de fidelidade. O Ped-On não armazena o CPF: guarda
                              apenas uma identificação segura para a pontuação.
                            </span>
                          </label>
                          <FieldError
                            id="club-checkout-enroll-error"
                            message={clubEnrollError ?? undefined}
                          />
                        </div>
                      )}

                      {clubError !== null && (
                        <p
                          role="alert"
                          aria-live="assertive"
                          className="rounded-md bg-red-50 p-3 text-sm text-red-700"
                        >
                          {clubError}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-3">
                        {clubStatus === 'enroll' ? (
                          <button
                            type="button"
                            onClick={() => void submitClubEnroll()}
                            disabled={clubChecking}
                            className="min-h-11 rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-45"
                          >
                            {clubChecking ? 'Cadastrando…' : 'Cadastrar e vincular'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void submitClubCpf()}
                            disabled={clubChecking}
                            className="min-h-11 rounded-md bg-pedon-orange px-4 font-semibold text-white disabled:opacity-45"
                          >
                            {clubChecking ? 'Consultando…' : 'Vincular CPF'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setClubOpen(false);
                            setClubStatus('idle');
                            setClubCpfError(null);
                            setClubEnrollError(null);
                            setClubError(null);
                          }}
                          className="min-h-11 rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm text-pedon-text/70">
                    Vinculado:{' '}
                    <span className="font-medium">
                      {club.found.customer.name ?? 'cliente'} ·{' '}
                      {maskCpf(club.found.customer.cpf_last2)}
                    </span>
                  </p>
                  <label className="mt-3 flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={club.optIn}
                      onChange={(event) => setClub({ ...club, optIn: event.target.checked })}
                      className="mt-1 size-4"
                    />
                    <span className="text-sm text-pedon-text">Acumular pontos nesta compra</span>
                  </label>
                  <button
                    type="button"
                    onClick={unlinkClub}
                    className="mt-3 min-h-11 rounded-md border border-pedon-navy/25 px-4 font-semibold text-pedon-navy"
                  >
                    Desvincular
                  </button>
                </>
              )}
            </section>
          )}

          <fieldset className="rounded-lg bg-white p-4 shadow-sm">
            <legend className="font-bold text-pedon-navy">Como deseja receber?</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {enabledModes.map((mode) => (
                <label
                  key={mode}
                  className="flex min-h-11 items-center gap-3 rounded-md border border-pedon-navy/15 px-3"
                >
                  <input type="radio" value={mode} {...register('service_mode')} />
                  {SERVICE_MODE_LABELS[mode]}
                </label>
              ))}
            </div>
          </fieldset>

          {serviceMode === 'delivery' && (
            <fieldset className="rounded-lg bg-white p-4 shadow-sm">
              <legend className="font-bold text-pedon-navy">Endereço de entrega</legend>
              <p className="mt-2 text-sm text-pedon-text/70">
                A entrega está sujeita à área atendida pelo estabelecimento.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['street', 'Rua', 'address-line1'],
                    ['number', 'Número', 'address-line2'],
                    ['neighborhood', 'Bairro', 'address-level3'],
                    ['city', 'Cidade', 'address-level2'],
                    ['state', 'UF', 'address-level1'],
                    ['postal_code', 'CEP (opcional)', 'postal-code'],
                    ['complement', 'Complemento (opcional)', 'address-line3'],
                    ['reference', 'Referência (opcional)', 'off'],
                  ] as const
                ).map(([field, label, autoComplete]) => (
                  <div
                    key={field}
                    className={field === 'street' || field === 'reference' ? 'sm:col-span-2' : ''}
                  >
                    <label htmlFor={field} className="block text-sm font-medium">
                      {label}
                    </label>
                    <input
                      id={field}
                      autoComplete={autoComplete}
                      aria-invalid={errors[field] !== undefined}
                      aria-describedby={errors[field] ? `${field}-error` : undefined}
                      className={inputClass}
                      {...register(field)}
                    />
                    <FieldError id={`${field}-error`} message={errors[field]?.message} />
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="rounded-lg bg-white p-4 shadow-sm">
            <legend className="font-bold text-pedon-navy">Forma de pagamento</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {enabledPayments.map((method) => (
                <label
                  key={method}
                  className="flex min-h-11 items-center gap-3 rounded-md border border-pedon-navy/15 px-3"
                >
                  <input type="radio" value={method} {...register('payment_method')} />
                  {PAYMENT_METHOD_LABELS[method]}
                </label>
              ))}
            </div>
            {paymentMethod === 'cash' && (
              <div className="mt-4">
                <label htmlFor="cash_change_for" className="block text-sm font-medium">
                  Troco para quanto? (opcional)
                </label>
                <input
                  id="cash_change_for"
                  inputMode="decimal"
                  placeholder="Ex.: 50,00"
                  aria-invalid={errors.cash_change_for !== undefined}
                  aria-describedby={errors.cash_change_for ? 'cash-error' : undefined}
                  className={inputClass}
                  {...register('cash_change_for')}
                />
                <FieldError id="cash-error" message={errors.cash_change_for?.message} />
              </div>
            )}
          </fieldset>

          <section aria-labelledby="notes-title" className="rounded-lg bg-white p-4 shadow-sm">
            <h2 id="notes-title" className="font-bold text-pedon-navy">
              Observações do pedido
            </h2>
            <label htmlFor="notes" className="sr-only">
              Observações do pedido (opcional)
            </label>
            <textarea
              id="notes"
              rows={3}
              maxLength={500}
              aria-invalid={errors.notes !== undefined}
              aria-describedby={errors.notes ? 'notes-error' : undefined}
              className={`${inputClass} resize-y`}
              {...register('notes')}
            />
            <FieldError id="notes-error" message={errors.notes?.message} />
          </section>

          <section aria-labelledby="total-title" className="rounded-lg bg-white p-4 shadow-sm">
            <h2 id="total-title" className="font-bold text-pedon-navy">
              Resumo estimado
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd>{formatBRL(subtotal)}</dd>
              </div>
              {serviceMode === 'delivery' && (
                <div className="flex justify-between">
                  <dt>Taxa de entrega</dt>
                  <dd>{formatBRL(deliveryFee)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-pedon-navy/10 pt-2 text-base font-bold">
                <dt>Total estimado</dt>
                <dd>{formatBRL(estimatedTotal)}</dd>
              </div>
            </dl>
            {decimalToCents(menu.operation.minimum_order_amount) > 0n && (
              <p className="mt-2 text-xs text-pedon-text/65">
                Pedido mínimo: {formatBRL(menu.operation.minimum_order_amount)}
              </p>
            )}
            <p className="mt-2 text-xs text-pedon-text/65">
              O valor final será confirmado no envio do pedido.
            </p>
          </section>

          <button
            type="submit"
            disabled={
              isSubmitting ||
              recoveringAttempt ||
              recoveryBlocked ||
              !menu.operation.can_order_now ||
              menu.operation.revision === null ||
              enabledModes.length === 0 ||
              enabledPayments.length === 0
            }
            className="min-h-12 w-full rounded-md bg-pedon-orange px-4 py-3 font-bold text-white disabled:opacity-45"
          >
            {recoveringAttempt
              ? 'Verificando pedido anterior…'
              : isSubmitting
                ? 'Enviando pedido…'
                : 'Enviar pedido'}
          </button>
        </form>
      </div>
    </div>
  );
}
