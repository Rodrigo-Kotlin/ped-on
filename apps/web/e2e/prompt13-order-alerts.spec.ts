import { expect, test } from '@playwright/test';
import type { Page, WebSocketRoute } from '@playwright/test';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_1_ID = '33333333-3333-4333-8333-333333333331';
const UNIT_2_ID = '33333333-3333-4333-8333-333333333332';
const ORDER_1_ID = '44444444-4444-4444-8444-444444444441';
const ORDER_2_ID = '44444444-4444-4444-8444-444444444442';
const ORDER_3_ID = '44444444-4444-4444-8444-444444444443';
const CREATED_AT = '2026-08-10T14:05:00.000Z';

type AdminRole = 'owner' | 'manager' | 'operator';

interface AdminUnit {
  id: string;
  name: string;
  is_active: boolean;
}

interface KdsOrder {
  id: string;
  order_number: number;
  status: string;
  service_mode: string;
  created_at: string;
  status_updated_at: string;
  estimated_minutes: number;
  expected_at: string;
  customer_name?: string;
  customer_phone?: string;
  delivery_address?: string;
  total?: string;
  loyalty?: string;
  items: { product_name: string; quantity: number; note: string | null; options: unknown[] }[];
}

function kdsOrder(
  id: string,
  orderNumber: number,
  withPii = false,
  status: string = 'new',
): KdsOrder {
  return {
    id,
    order_number: orderNumber,
    status,
    service_mode: 'pickup',
    created_at: CREATED_AT,
    status_updated_at: CREATED_AT,
    estimated_minutes: 20,
    expected_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    ...(withPii
      ? {
          customer_name: 'Cliente Secreto',
          customer_phone: '11988887777',
          delivery_address: 'Rua Secreta 123',
          total: '40.00',
          loyalty: 'CPF 123.456.789-00',
        }
      : {}),
    items: [{ product_name: 'Prato E2E', quantity: 1, note: 'Sem cebola', options: [] }],
  };
}

interface PostgresChangesFilter {
  id: string | undefined;
  event: string | undefined;
  schema: string | undefined;
  table: string | undefined;
  filter: string | undefined;
}

interface RealtimeHarness {
  sockets: WebSocketRoute[];
  joined: Set<WebSocketRoute>;
  connections: number;
  replies: number;
  emit: (unitId: string, orderId: string) => void;
  waitForJoined: (timeoutMs?: number) => Promise<void>;
}

async function mockRealtime(page: Page, keepOpen: boolean): Promise<RealtimeHarness> {
  const sockets: WebSocketRoute[] = [];
  const joined = new Set<WebSocketRoute>();
  const filtersByTopic = new Map<string, PostgresChangesFilter[]>();
  let connections = 0;
  let replies = 0;

  await page.routeWebSocket('**/realtime/v1/**', (webSocket) => {
    connections += 1;
    sockets.push(webSocket);
    webSocket.onClose(() => {
      joined.delete(webSocket);
    });
    webSocket.onMessage((message) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(message));
      } catch {
        return;
      }
      if (!Array.isArray(parsed) || parsed.length < 5) return;
      const [joinRef, ref, topic, event, payload] = parsed as [
        string,
        string,
        string,
        string,
        unknown,
      ];
      if (event === 'heartbeat') {
        webSocket.send(
          JSON.stringify([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]),
        );
        return;
      }
      if (event !== 'phx_join') return;
      replies += 1;
      const clientFilters =
        (payload as { config?: { postgres_changes?: PostgresChangesFilter[] } })?.config
          ?.postgres_changes ?? [];
      const echoed = clientFilters.map((filter, index) => ({
        id: `pc-binding-${index}`,
        event: filter.event,
        schema: filter.schema,
        table: filter.table,
        filter: filter.filter,
      }));
      filtersByTopic.set(topic, echoed);
      webSocket.send(
        JSON.stringify([
          joinRef,
          ref,
          topic,
          'phx_reply',
          { status: 'ok', response: { postgres_changes: echoed } },
        ]),
      );
      joined.add(webSocket);
    });
    if (!keepOpen) webSocket.close();
  });

  return {
    sockets,
    joined,
    get connections() {
      return connections;
    },
    get replies() {
      return replies;
    },
    emit(unitId, orderId) {
      const topic = `realtime:unit-orders:${unitId}`;
      const insertIds = (filtersByTopic.get(topic) ?? [])
        .filter((filter) => filter.event === 'INSERT')
        .map((filter) => filter.id)
        .filter((id): id is string => id !== undefined);
      const payload = {
        ids: insertIds,
        data: {
          schema: 'public',
          table: 'orders',
          commit_timestamp: new Date().toISOString(),
          type: 'INSERT',
          errors: null,
          columns: [{ name: 'id', data_type: 'uuid' }],
          record: { id: orderId },
          old_record: null,
        },
      };
      for (const webSocket of joined) {
        try {
          webSocket.send(JSON.stringify([null, null, topic, 'postgres_changes', payload]));
        } catch {
          joined.delete(webSocket);
        }
      }
    },
    async waitForJoined(timeoutMs = 8000) {
      const deadline = Date.now() + timeoutMs;
      while (joined.size === 0) {
        if (Date.now() > deadline) throw new Error('Realtime socket nunca finalizou o join');
        await page.waitForTimeout(100);
      }
    },
  };
}

interface AppMockOptions {
  role?: AdminRole;
  units?: AdminUnit[];
  orders?: Record<string, KdsOrder[]>;
  keepRealtimeOpen?: boolean;
  audioStub?: boolean;
}

interface AppMock {
  kdsCalls: number;
  setOrders: (unitId: string, newOrders: KdsOrder[]) => void;
  realtime: RealtimeHarness;
}

async function mockApp(page: Page, options: AppMockOptions = {}): Promise<AppMock> {
  const {
    role = 'owner',
    units = [{ id: UNIT_1_ID, name: 'Loja Centro', is_active: true }],
    orders = { [UNIT_1_ID]: [] },
    keepRealtimeOpen = true,
    audioStub = false,
  } = options;

  let kdsCalls = 0;
  const realtime = await mockRealtime(page, keepRealtimeOpen);

  await page.addInitScript(
    ({ userId, selectedUnitId, stubAudio }) => {
      const session = {
        access_token: 'e2e-access-token',
        refresh_token: 'e2e-refresh-token',
        expires_in: 3600,
        expires_at: 4_102_444_800,
        token_type: 'bearer',
        user: {
          id: userId,
          email: 'alerts@pedon.invalid',
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
          created_at: '2026-01-01T00:00:00.000Z',
        },
      };
      for (const key of ['sb-zmuxkztnilnzjyyojbbr-auth-token', 'sb-placeholder-auth-token']) {
        window.localStorage.setItem(key, JSON.stringify(session));
      }
      window.localStorage.setItem('pedon:selectedUnitId', selectedUnitId);
      if (stubAudio) {
        (window as unknown as Record<string, unknown>).__pedonChimeOscillators = 0;
        class FakeOscillator {
          type = 'sine';
          frequency = { setValueAtTime() {} };
          connect() {}
          start() {}
          stop() {}
        }
        class FakeGain {
          gain = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
          connect() {}
        }
        class FakeAudioContext {
          state = 'running';
          currentTime = 0;
          destination = {};
          createOscillator() {
            const counters = window as unknown as { __pedonChimeOscillators: number };
            counters.__pedonChimeOscillators += 1;
            return new FakeOscillator();
          }
          createGain() {
            return new FakeGain();
          }
          resume() {
            return Promise.resolve();
          }
          close() {
            return Promise.resolve();
          }
        }
        window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
      }
    },
    { userId: USER_ID, selectedUnitId: UNIT_1_ID, stubAudio: audioStub },
  );

  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers':
        'authorization,apikey,content-type,content-profile,accept-profile,x-client-info',
      'content-type': 'application/json',
    };

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (pathname === '/rest/v1/profiles') {
      await route.fulfill({
        status: 200,
        headers,
        json: [
          {
            id: USER_ID,
            email: 'alerts@pedon.invalid',
            full_name: 'Equipe E2E',
            onboarding_status: 'completed',
            created_at: CREATED_AT,
            updated_at: CREATED_AT,
          },
        ],
      });
      return;
    }
    if (pathname === '/rest/v1/rpc/get_my_admin_context') {
      await route.fulfill({
        status: 200,
        headers,
        json: {
          profile: { id: USER_ID, email: 'alerts@pedon.invalid', full_name: 'Equipe E2E' },
          organization: { id: ORGANIZATION_ID, name: 'Cantina E2E' },
          role,
          units,
        },
      });
      return;
    }
    if (pathname === '/rest/v1/rpc/get_kds_orders_minimal') {
      kdsCalls += 1;
      const body = request.postDataJSON() as { p_unit_id?: string };
      const unitId = body.p_unit_id ?? UNIT_1_ID;
      const unitName = units.find((unit) => unit.id === unitId)?.name ?? 'Loja Centro';
      await route.fulfill({
        status: 200,
        headers,
        json: {
          unit: { id: unitId, name: unitName },
          truncated: false,
          orders: orders[unitId] ?? [],
        },
      });
      return;
    }
    if (pathname === '/rest/v1/rpc/get_unit_orders_admin_v2') {
      await route.fulfill({
        status: 200,
        headers,
        json: {
          unit: { id: UNIT_1_ID, name: 'Loja Centro' },
          view: 'active',
          filters: {
            view: 'active',
            statuses: ['new'],
            service_mode: null,
            payment_status: null,
            limit: 50,
          },
          snapshot_at: CREATED_AT,
          total_count: 0,
          orders: [],
          page_info: { has_more: false, next_cursor: null },
        },
      });
      return;
    }

    await route.fulfill({ status: 404, headers, json: { message: 'E2E route not mocked' } });
  });

  return {
    get kdsCalls() {
      return kdsCalls;
    },
    setOrders(unitId: string, newOrders: KdsOrder[]) {
      orders[unitId] = newOrders;
    },
    realtime,
  };
}

test.use({ serviceWorkers: 'block' });

test('A: hidratação inicial marca novos no badge sem alerta sonoro nem banner', async ({
  page,
}) => {
  await mockApp(page, { orders: { [UNIT_1_ID]: [kdsOrder(ORDER_1_ID, 81)] } });
  await page.goto('/app/pedidos');

  await expect(page.locator('[aria-label="1 pedido novo"]')).toHaveCount(2);
  await expect(page.getByText(/Novo pedido #/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ativar som' })).toBeVisible();
});

test('B: novo pedido via realtime incrementa o badge e mostra o banner', async ({ page }) => {
  const app = await mockApp(page, { orders: { [UNIT_1_ID]: [kdsOrder(ORDER_1_ID, 81)] } });
  await page.goto('/app/pedidos');
  await expect(page.locator('[aria-label="1 pedido novo"]')).toHaveCount(2);

  app.setOrders(UNIT_1_ID, [kdsOrder(ORDER_1_ID, 81), kdsOrder(ORDER_2_ID, 82)]);
  app.realtime.emit(UNIT_1_ID, ORDER_2_ID);
  await page.getByRole('status').getByText('Novo pedido #82 recebido.').waitFor();
  await expect(page.locator('[aria-label="2 pedidos novos"]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Fechar alerta' }).click();
  await expect(page.getByText(/Novo pedido #82/)).toHaveCount(0);
});

test('C: dedup — mesmo pedido em refetch/realtime não gera segundo alerta', async ({ page }) => {
  const app = await mockApp(page, { orders: { [UNIT_1_ID]: [kdsOrder(ORDER_1_ID, 81)] } });
  await page.goto('/app/pedidos');
  await expect(page.locator('[aria-label="1 pedido novo"]')).toHaveCount(2);

  app.setOrders(UNIT_1_ID, [kdsOrder(ORDER_1_ID, 81), kdsOrder(ORDER_2_ID, 82)]);
  app.realtime.emit(UNIT_1_ID, ORDER_2_ID);
  await page.getByRole('status').getByText('Novo pedido #82 recebido.').waitFor();
  await page.getByRole('button', { name: 'Fechar alerta' }).click();
  const callsAfterFirstAlert = app.kdsCalls;

  app.realtime.emit(UNIT_1_ID, ORDER_2_ID);
  await expect.poll(() => app.kdsCalls).toBeGreaterThan(callsAfterFirstAlert);
  await expect(page.locator('[aria-label="2 pedidos novos"]')).toHaveCount(2);
  await expect(page.getByText(/Novo pedido #82/)).toHaveCount(0);
});

test('D: som opt-in com stub, um chime por lote e sessão-only no reload', async ({ page }) => {
  const app = await mockApp(page, {
    orders: { [UNIT_1_ID]: [kdsOrder(ORDER_1_ID, 81)] },
    audioStub: true,
  });
  await page.goto('/app/pedidos');
  await expect(page.locator('[aria-label="1 pedido novo"]')).toHaveCount(2);

  const toggle = page.getByRole('button', { name: 'Ativar som' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Silenciar som' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  app.setOrders(UNIT_1_ID, [kdsOrder(ORDER_1_ID, 81), kdsOrder(ORDER_2_ID, 82)]);
  app.realtime.emit(UNIT_1_ID, ORDER_2_ID);
  await page.getByRole('status').getByText('Novo pedido #82 recebido.').waitFor();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __pedonChimeOscillators: number }).__pedonChimeOscillators,
      ),
    )
    .toBe(2);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Ativar som' })).toBeVisible();
  await expect(page.locator('[aria-label="2 pedidos novos"]')).toHaveCount(2);
  await expect(page.getByText(/Novo pedido #/)).toHaveCount(0);
});

test('E: operator vê o badge sem acesso ao Clube', async ({ page }) => {
  await mockApp(page, {
    role: 'operator',
    orders: { [UNIT_1_ID]: [kdsOrder(ORDER_1_ID, 81)] },
  });
  await page.goto('/app/pedidos');

  await expect(page.locator('[aria-label="1 pedido novo"]')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Clube Ped-On' })).toHaveCount(0);
});

test('F: troca de unidade faz baseline conservador sem alerta em lote', async ({ page }) => {
  await mockApp(page, {
    orders: {
      [UNIT_1_ID]: [kdsOrder(ORDER_1_ID, 81)],
      [UNIT_2_ID]: [kdsOrder(ORDER_3_ID, 90), kdsOrder(ORDER_2_ID, 91)],
    },
    units: [
      { id: UNIT_1_ID, name: 'Loja Centro', is_active: true },
      { id: UNIT_2_ID, name: 'Filial Sul', is_active: true },
    ],
  });
  await page.goto('/app/pedidos');
  await expect(page.locator('[aria-label="1 pedido novo"]')).toHaveCount(2);

  await page.getByLabel('Selecionar unidade').selectOption(UNIT_2_ID);

  await expect(page.locator('[aria-label="2 pedidos novos"]')).toHaveCount(2);
  await expect(page.locator('[aria-label="1 pedido novo"]')).toHaveCount(0);
  await expect(page.getByText(/Novo pedido #/)).toHaveCount(0);
});

test('G: privacy — banner e badge nunca expõem PII', async ({ page }) => {
  const app = await mockApp(page, { orders: { [UNIT_1_ID]: [kdsOrder(ORDER_1_ID, 81)] } });
  await page.goto('/app/pedidos');
  await expect(page.locator('[aria-label="1 pedido novo"]')).toHaveCount(2);

  app.setOrders(UNIT_1_ID, [kdsOrder(ORDER_1_ID, 81), kdsOrder(ORDER_2_ID, 82, true)]);
  app.realtime.emit(UNIT_1_ID, ORDER_2_ID);
  const banner = page.getByRole('status').getByText('Novo pedido #82 recebido.');
  await banner.waitFor();

  const status = page.getByRole('status');
  await expect(status).toHaveCount(1);
  await expect(status).not.toContainText('Cliente Secreto');
  await expect(status).not.toContainText('11988887777');
  await expect(status).not.toContainText('Rua Secreta');
  await expect(status).not.toContainText('40.00');
  await expect(status).not.toContainText('CPF');
  await expect(status).not.toContainText('Sem cebola');
  await expect(page.locator('[aria-label="2 pedidos novos"]')).toHaveCount(2);
});

test('H: realtime degradado mostra aviso e polling mantém o badge', async ({ page }) => {
  await mockApp(page, {
    orders: { [UNIT_1_ID]: [kdsOrder(ORDER_1_ID, 81)] },
    keepRealtimeOpen: false,
  });
  await page.goto('/app/pedidos');

  await expect(page.getByText(/Tempo real indisponível/)).toBeVisible();
  await expect(page.locator('[aria-label="1 pedido novo"]')).toHaveCount(2);
});

test('I: navegação entre rotas não duplica a subscription realtime', async ({ page }) => {
  const app = await mockApp(page, { orders: { [UNIT_1_ID]: [kdsOrder(ORDER_1_ID, 81)] } });
  await page.goto('/app/pedidos');
  await expect(page.locator('[aria-label="1 pedido novo"]')).toHaveCount(2);
  await app.realtime.waitForJoined();

  await page.getByRole('link', { name: 'Cozinha' }).click();
  await expect(page.getByRole('heading', { name: 'Cozinha' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Pedido #81' })).toBeVisible();

  await page.getByRole('link', { name: 'Pedidos' }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();

  await expect.poll(() => app.realtime.connections).toBe(1);
  await expect(page.getByText(/Tempo real indisponível/)).toHaveCount(0);
});

test('J: offline→online faz resync sem alerta em lote do que ocorreu offline', async ({ page }) => {
  const app = await mockApp(page, { orders: { [UNIT_1_ID]: [kdsOrder(ORDER_1_ID, 81)] } });
  await page.goto('/app/pedidos');
  await expect(page.locator('[aria-label="1 pedido novo"]')).toHaveCount(2);
  await app.realtime.waitForJoined();

  await page.context().setOffline(true);
  await expect(page.getByText(/Sem conexão com a internet/)).toBeVisible();

  app.setOrders(UNIT_1_ID, [kdsOrder(ORDER_1_ID, 81), kdsOrder(ORDER_2_ID, 82)]);
  await page.context().setOffline(false);
  await app.realtime.waitForJoined();
  app.realtime.emit(UNIT_1_ID, ORDER_2_ID);

  await expect.poll(() => app.kdsCalls).toBeGreaterThan(1);
  await expect(page.locator('[aria-label="2 pedidos novos"]')).toHaveCount(2);
  await expect(page.getByText(/Novo pedido #82/)).toHaveCount(0);
});
