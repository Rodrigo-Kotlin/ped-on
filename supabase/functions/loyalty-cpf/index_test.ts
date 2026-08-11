import {
  CONSENT_VERSION,
  createCpfFingerprint,
  createHandler,
  createPhoneFingerprint,
  hmacSha256Hex,
  isValidCpf,
  mapDbError,
  normalizeCpf,
  normalizePhone,
  randomTokenHex,
  type HandlerDependencies,
  type RpcClient,
} from './index.ts';

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message = 'Values differ'): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, received ${actualJson}`);
  }
}

async function responseJson(response: Response): Promise<unknown> {
  return await response.json();
}

type MockResult = { data: unknown; error: { code?: string; message?: string } | null };
type RpcCall = { name: string; args: Record<string, unknown> };

function mockDependencies(results: MockResult[]): {
  dependencies: HandlerDependencies;
  calls: RpcCall[];
} {
  const calls: RpcCall[] = [];
  const client: RpcClient = {
    rpc(name, args) {
      calls.push({ name, args });
      const result = results.shift();
      if (!result) throw new Error(`Unexpected RPC: ${name}`);
      return Promise.resolve(result);
    },
  };
  return {
    calls,
    dependencies: {
      getEnv(name) {
        return {
          LOYALTY_CPF_HMAC_KEY: 'unit-test-secret',
          SUPABASE_URL: 'https://example.invalid',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-value',
        }[name];
      },
      createClient: () => client,
      now: () => Date.UTC(2026, 7, 11, 12, 0, 0),
    },
  };
}

function requestBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    public_slug: '0123456789abcdef01234567',
    mode: 'lookup',
    cpf: '529.982.247-25',
    phone: '(11) 98765-4321',
    ...overrides,
  };
}

function post(body: unknown, headers: HeadersInit = {}): Request {
  return new Request('https://example.invalid/functions/v1/loyalty-cpf', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

Deno.test('CPF normalization and checksum reject invalid and repeated values', () => {
  assertEquals(normalizeCpf('529.982.247-25'), '52998224725');
  assert(isValidCpf('52998224725'));
  assert(!isValidCpf('52998224724'));
  assert(!isValidCpf('11111111111'));
  assert(!isValidCpf('5299822472'));
});

Deno.test('phone normalization accepts only 10 or 11 digits', () => {
  assertEquals(normalizePhone('(11) 98765-4321'), '11987654321');
  assertEquals(normalizePhone('(11) 3456-7890'), '1134567890');
  assertEquals(normalizePhone('11 9876-543'), null);
  assertEquals(normalizePhone('5511987654321'), null);
  assertEquals(normalizePhone(undefined), null);
});

Deno.test('identity HMAC is deterministic and tenant-scoped', async () => {
  const first = await createCpfFingerprint('secret', 'tenant-a', '52998224725');
  const same = await createCpfFingerprint('secret', 'tenant-a', '52998224725');
  const otherTenant = await createCpfFingerprint('secret', 'tenant-b', '52998224725');
  const phone = await createPhoneFingerprint('secret', 'tenant-a', '11987654321');
  assertEquals(first, same);
  assert(first !== otherTenant);
  assert(first !== phone);
  assertEquals(first.length, 64);
  assert(/^[a-f0-9]{64}$/.test(first));
});

Deno.test('HMAC accepts a hexadecimal key and generated token is 64 hex characters', async () => {
  const digest = await hmacSha256Hex('ab'.repeat(32), 'scope');
  assert(/^[a-f0-9]{64}$/.test(digest));
  assert(/^[a-f0-9]{64}$/.test(randomTokenHex()));
});

Deno.test('invalid JSON is rejected', async () => {
  const mock = mockDependencies([]);
  const response = await createHandler(mock.dependencies)(post('{'));
  assertEquals(response.status, 400);
  assertEquals(await responseJson(response), {
    error: { code: 'INVALID_JSON', message: 'Corpo invalido' },
  });
  assertEquals(mock.calls.length, 0);
});

Deno.test('body over 4 KB is rejected', async () => {
  const mock = mockDependencies([]);
  const response = await createHandler(mock.dependencies)(post('x'.repeat(4097)));
  assertEquals(response.status, 413);
  assertEquals(await responseJson(response), {
    error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload excede 4 KB' },
  });
});

Deno.test('invalid slug is rejected before an RPC', async () => {
  const mock = mockDependencies([]);
  const response = await createHandler(mock.dependencies)(
    post(requestBody({ public_slug: 'not-a-slug' })),
  );
  assertEquals(response.status, 404);
  assertEquals(
    ((await responseJson(response)) as { error: { code: string } }).error.code,
    'INVALID_SLUG',
  );
  assertEquals(mock.calls.length, 0);
});

Deno.test('missing phone is rejected without identity lookup', async () => {
  const mock = mockDependencies([]);
  const body = requestBody();
  delete body.phone;
  const response = await createHandler(mock.dependencies)(post(body));
  assertEquals(response.status, 422);
  assertEquals(
    ((await responseJson(response)) as { error: { code: string } }).error.code,
    'INVALID_PHONE',
  );
  assertEquals(mock.calls.length, 0);
});

Deno.test('enroll requires explicit true consent before an identity RPC', async () => {
  for (const consent of [undefined, false]) {
    const mock = mockDependencies([]);
    const response = await createHandler(mock.dependencies)(
      post(requestBody({ mode: 'enroll', name: 'Cliente Teste', consent })),
    );
    assertEquals(response.status, 422);
    assertEquals(
      ((await responseJson(response)) as { error: { code: string } }).error.code,
      'CONSENT_REQUIRED',
    );
    assertEquals(mock.calls.length, 0);
  }
  assertEquals(CONSENT_VERSION, 'pedon-clube-v1');
});

Deno.test('enroll sends the server consent version and uses the lower rate limit', async () => {
  const mock = mockDependencies([
    {
      data: {
        found: true,
        organization_id: '11111111-1111-1111-1111-111111111111',
        program: { exists: true, enabled: true },
      },
      error: null,
    },
    { data: { allowed: true }, error: null },
    {
      data: {
        found: true,
        membership_id: '22222222-2222-2222-2222-222222222222',
        customer: { name: 'Cliente Teste', cpf_last2: '25' },
        account: { points_balance: 0, recovery_points: 0 },
      },
      error: null,
    },
    {
      data: {
        found: true,
        customer: { name: 'Cliente Teste', cpf_last2: '25' },
        account: { points_balance: 0, recovery_points: 0, updated_at: '2026-08-11T12:00:00Z' },
        statement: [],
      },
      error: null,
    },
  ]);
  const response = await createHandler(mock.dependencies)(
    post(requestBody({ mode: 'enroll', name: 'Cliente Teste', consent: true })),
  );
  assertEquals(response.status, 200);
  assertEquals(mock.calls[1].args.p_max_attempts, 5);
  assertEquals(mock.calls[2].args.p_consent_version, CONSENT_VERSION);
  assertEquals(mock.calls[3].name, 'get_public_loyalty_account');
  assertEquals(((await responseJson(response)) as { statement: unknown[] }).statement, []);
});

async function mismatchResponse(phone: string): Promise<{
  response: Response;
  body: unknown;
  calls: RpcCall[];
}> {
  const mock = mockDependencies([
    {
      data: {
        found: true,
        organization_id: '11111111-1111-1111-1111-111111111111',
        program: { exists: true, enabled: true },
      },
      error: null,
    },
    { data: { allowed: true }, error: null },
    { data: { found: false }, error: null },
  ]);
  const response = await createHandler(mock.dependencies)(post(requestBody({ phone })));
  return { response, body: await responseJson(response), calls: mock.calls };
}

Deno.test('missing identity and wrong phone have a uniform response', async () => {
  const missing = await mismatchResponse('(11) 98765-4321');
  const wrongPhone = await mismatchResponse('(21) 98765-4321');
  const expected = {
    error: {
      code: 'IDENTITY_NOT_CONFIRMED',
      message: 'Não foi possível confirmar os dados informados.',
    },
  };
  assertEquals(missing.response.status, 422);
  assertEquals(wrongPhone.response.status, 422);
  assertEquals(missing.body, expected);
  assertEquals(wrongPhone.body, expected);
  assertEquals(missing.response.headers.get('cache-control'), 'no-store');
  assertEquals(missing.response.headers.get('access-control-allow-origin'), '*');
  assertEquals(
    missing.calls.map((call) => call.name),
    [
      'get_loyalty_public_context_internal',
      'consume_loyalty_rate_limit_internal',
      'resolve_loyalty_identity_internal_v2',
    ],
  );

  const identityArgs = missing.calls[2].args;
  assert(/^[a-f0-9]{64}$/.test(String(identityArgs.p_cpf_fingerprint)));
  assert(/^[a-f0-9]{64}$/.test(String(identityArgs.p_phone_fingerprint)));
  assertEquals(identityArgs.p_consent_version, null);
});

Deno.test('database rate limit returns 429 and an integer Retry-After', async () => {
  const mock = mockDependencies([
    {
      data: {
        found: true,
        organization_id: '11111111-1111-1111-1111-111111111111',
        program: { exists: true, enabled: true },
      },
      error: null,
    },
    { data: { allowed: false, retry_after_seconds: 12.2 }, error: null },
  ]);
  const response = await createHandler(mock.dependencies)(
    post(requestBody(), {
      'cf-connecting-ip': '203.0.113.10',
      'x-forwarded-for': '198.51.100.2, 198.51.100.3',
    }),
  );
  assertEquals(response.status, 429);
  assertEquals(response.headers.get('retry-after'), '13');
  assertEquals(
    ((await responseJson(response)) as { error: { code: string } }).error.code,
    'RATE_LIMITED',
  );
  assertEquals(mock.calls.length, 2);
  assertEquals(mock.calls[1].name, 'consume_loyalty_rate_limit_internal');
  assert(/^[a-f0-9]{64}$/.test(String(mock.calls[1].args.p_scope_hash)));
  assertEquals(mock.calls[1].args.p_window_seconds, 60);
  assertEquals(mock.calls[1].args.p_max_attempts, 10);
});

Deno.test('database error codes map to public errors', async () => {
  const phone = mapDbError({ code: 'INVALID_PHONE' }, 'test');
  const consent = mapDbError({ code: 'CONSENT_REQUIRED' }, 'test');
  const integrity = mapDbError({ code: 'PED53' }, 'test');
  assertEquals(phone.status, 422);
  assertEquals(
    ((await responseJson(phone)) as { error: { code: string } }).error.code,
    'INVALID_PHONE',
  );
  assertEquals(consent.status, 422);
  assertEquals(
    ((await responseJson(consent)) as { error: { code: string } }).error.code,
    'CONSENT_REQUIRED',
  );
  assertEquals(integrity.status, 500);
  assertEquals(
    ((await responseJson(integrity)) as { error: { code: string } }).error.code,
    'LOYALTY_INTEGRITY',
  );
});

Deno.test('OPTIONS returns 204 with null body and CORS headers', async () => {
  const mock = mockDependencies([]);
  const response = await createHandler(mock.dependencies)(
    new Request('https://example.invalid/functions/v1/loyalty-cpf', { method: 'OPTIONS' }),
  );
  assertEquals(response.status, 204);
  assertEquals(response.body, null);
  assertEquals(response.headers.get('access-control-allow-origin'), '*');
  assertEquals(response.headers.get('cache-control'), 'no-store');
  assertEquals(mock.calls.length, 0);
});
