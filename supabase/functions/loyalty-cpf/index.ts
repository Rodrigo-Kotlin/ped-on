import { createClient } from 'npm:@supabase/supabase-js@2';

export const CONSENT_VERSION = 'pedon-clube-v1';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 4096;
const RATE_WINDOW_SECONDS = 60;

type DbError = { code?: string; message?: string };
type RpcResult = { data: unknown; error: DbError | null };

export type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

export type HandlerDependencies = {
  getEnv(name: string): string | undefined;
  createClient(url: string, serviceRoleKey: string): RpcClient;
  now(): number;
};

type LoyaltyMode = 'lookup' | 'enroll';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function json(
  body: unknown,
  status = 200,
  responseHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...responseHeaders,
    },
  });
}

function apiError(
  code: string,
  message: string,
  status: number,
  responseHeaders: Record<string, string> = {},
): Response {
  return json({ error: { code, message } }, status, responseHeaders);
}

function identityNotConfirmed(): Response {
  return apiError('IDENTITY_NOT_CONFIRMED', 'Não foi possível confirmar os dados informados.', 422);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const keyData = /^[0-9a-f]{64}$/i.test(secret)
    ? hexToBytes(secret)
    : new TextEncoder().encode(secret);
  const keyBuffer = keyData.buffer.slice(
    keyData.byteOffset,
    keyData.byteOffset + keyData.byteLength,
  ) as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(signature));
}

export function randomTokenHex(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToHex(buffer);
}

export function normalizeCpf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return /^\d{11}$/.test(digits) ? digits : null;
}

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += Number(digits[index]) * (10 - index);
  let rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  if (rest !== Number(digits[9])) return false;

  sum = 0;
  for (let index = 0; index < 10; index += 1) sum += Number(digits[index]) * (11 - index);
  rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === Number(digits[10]);
}

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return /^\d{10,11}$/.test(digits) ? digits : null;
}

export function getClientIp(request: Request): string {
  const cloudflareIp = request.headers.get('cf-connecting-ip')?.trim();
  return cloudflareIp || 'unknown';
}

export function createCpfFingerprint(
  secret: string,
  organizationId: string,
  cpfDigits: string,
): Promise<string> {
  return hmacSha256Hex(secret, `pedon:cpf:v1:${organizationId}:${cpfDigits}`);
}

export function createPhoneFingerprint(
  secret: string,
  organizationId: string,
  phoneDigits: string,
): Promise<string> {
  return hmacSha256Hex(secret, `pedon:phone:v1:${organizationId}:${phoneDigits}`);
}

export function createRateLimitScopeHash(
  secret: string,
  clientIp: string,
  publicSlug: string,
  mode: LoyaltyMode,
): Promise<string> {
  return hmacSha256Hex(secret, `pedon:rate:v1:${clientIp}:${publicSlug}:${mode}`);
}

function isSafePlainText(value: string): boolean {
  if (/[<>]/.test(value)) return false;
  return Array.from(value, (character) => character.charCodeAt(0)).every(
    (code) => code > 31 && code !== 127,
  );
}

export function mapDbError(error: DbError, phase: string): Response {
  const code = error.code ?? '';
  if (code === 'PED51' || code === 'LOYALTY_UNAVAILABLE') {
    return apiError('LOYALTY_UNAVAILABLE', 'Clube indisponivel para este cardapio', 403);
  }
  if (code === 'PED43' || code === 'INVALID_NAME') {
    return apiError('INVALID_NAME', 'Dados de cadastro invalidos', 422);
  }
  if (code === 'INVALID_PHONE') {
    return apiError('INVALID_PHONE', 'Telefone invalido', 422);
  }
  if (code === 'CONSENT_REQUIRED') {
    return apiError('CONSENT_REQUIRED', 'Consentimento obrigatorio', 422);
  }
  if (code === 'IDENTITY_NOT_CONFIRMED') return identityNotConfirmed();
  if (code === 'RATE_LIMITED') {
    return apiError('RATE_LIMITED', 'Muitas tentativas. Tente novamente mais tarde.', 429);
  }
  if (code === 'PED53' || code === 'LOYALTY_INTEGRITY') {
    return apiError('LOYALTY_INTEGRITY', 'Inconsistencia interna de fidelidade', 500);
  }

  // Log only operational metadata; upstream messages can echo submitted values.
  console.error(`loyalty-cpf:${phase}`, code || 'UNKNOWN');
  return apiError('UPSTREAM_ERROR', 'Falha interna ao processar', 500);
}

function parseRetryAfter(data: unknown): number {
  if (!isRecord(data)) return RATE_WINDOW_SECONDS;
  const value = data.retry_after_seconds ?? data.retry_after;
  const seconds = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : RATE_WINDOW_SECONDS;
}

const defaultDependencies: HandlerDependencies = {
  getEnv: (name) => Deno.env.get(name),
  createClient: (url, serviceRoleKey) =>
    createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as RpcClient,
  now: () => Date.now(),
};

export function createHandler(
  dependencies: HandlerDependencies = defaultDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' },
      });
    }
    if (request.method !== 'POST') {
      return apiError('METHOD_NOT_ALLOWED', 'Somente POST e aceito', 405);
    }

    let body: Record<string, unknown>;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
        return apiError('PAYLOAD_TOO_LARGE', 'Payload excede 4 KB', 413);
      }
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) return apiError('INVALID_JSON', 'Corpo invalido', 400);
      body = parsed;
    } catch {
      return apiError('INVALID_JSON', 'Corpo invalido', 400);
    }

    const mode = typeof body.mode === 'string' ? body.mode : '';
    if (mode !== 'lookup' && mode !== 'enroll') {
      return apiError('INVALID_MODE', 'mode deve ser lookup ou enroll', 400);
    }

    const publicSlug =
      typeof body.public_slug === 'string' ? body.public_slug.trim().toLowerCase() : '';
    if (!/^[a-f0-9]{24}$/.test(publicSlug)) {
      return apiError('INVALID_SLUG', 'Cardapio nao encontrado', 404);
    }

    const cpfDigits = normalizeCpf(body.cpf);
    if (!cpfDigits || !isValidCpf(cpfDigits)) {
      return apiError('INVALID_CPF', 'CPF invalido', 422);
    }

    const phoneDigits = normalizePhone(body.phone);
    if (!phoneDigits) return apiError('INVALID_PHONE', 'Telefone invalido', 422);

    if (mode === 'enroll' && body.consent !== true) {
      return apiError('CONSENT_REQUIRED', 'Consentimento obrigatorio', 422);
    }

    let name: string | null = null;
    if (mode === 'enroll') {
      name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name.length < 2 || name.length > 120 || !isSafePlainText(name)) {
        return apiError('INVALID_NAME', 'Nome entre 2 e 120 caracteres', 422);
      }
    }

    const secret = dependencies.getEnv('LOYALTY_CPF_HMAC_KEY');
    const supabaseUrl = dependencies.getEnv('SUPABASE_URL');
    const serviceRoleKey = dependencies.getEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (!secret || !supabaseUrl || !serviceRoleKey) {
      return apiError('SERVER_CONFIG', 'Configuracao de servidor ausente', 500);
    }

    const client = dependencies.createClient(supabaseUrl, serviceRoleKey);
    const { data: contextValue, error: contextError } = await client.rpc(
      'get_loyalty_public_context_internal',
      { p_public_slug: publicSlug },
    );
    if (contextError) return mapDbError(contextError, 'context');
    const contextFound = isRecord(contextValue) && contextValue.found === true;
    const scopeHash = await createRateLimitScopeHash(
      secret,
      getClientIp(request),
      contextFound ? publicSlug : 'invalid',
      mode,
    );
    const { data: rateLimit, error: rateLimitError } = await client.rpc(
      'consume_loyalty_rate_limit_internal',
      {
        p_scope_hash: scopeHash,
        p_window_seconds: RATE_WINDOW_SECONDS,
        p_max_attempts: mode === 'lookup' ? 10 : 5,
      },
    );
    if (rateLimitError) return mapDbError(rateLimitError, 'rate-limit');
    if (!isRecord(rateLimit) || rateLimit.allowed !== true) {
      return apiError('RATE_LIMITED', 'Muitas tentativas. Tente novamente mais tarde.', 429, {
        'Retry-After': String(parseRetryAfter(rateLimit)),
      });
    }

    if (!contextFound) {
      return apiError('INVALID_SLUG', 'Cardapio nao encontrado', 404);
    }
    const program = contextValue.program;
    if (!isRecord(program) || program.exists !== true || program.enabled !== true) {
      return apiError('LOYALTY_UNAVAILABLE', 'Clube indisponivel para este cardapio', 403);
    }
    if (typeof contextValue.organization_id !== 'string') {
      return apiError('LOYALTY_INTEGRITY', 'Inconsistencia interna de fidelidade', 500);
    }

    const organizationId = contextValue.organization_id;
    const [cpfFingerprint, phoneFingerprint] = await Promise.all([
      createCpfFingerprint(secret, organizationId, cpfDigits),
      createPhoneFingerprint(secret, organizationId, phoneDigits),
    ]);
    const accessToken = randomTokenHex();
    const tokenHash = await sha256Hex(accessToken);
    const expiresAt = new Date(dependencies.now() + TOKEN_TTL_MS).toISOString();

    const { data: identityValue, error: identityError } = await client.rpc(
      'resolve_loyalty_identity_internal_v2',
      {
        p_organization_id: organizationId,
        p_cpf_fingerprint: cpfFingerprint,
        p_cpf_last2: cpfDigits.slice(-2),
        p_phone_fingerprint: phoneFingerprint,
        p_mode: mode,
        p_name: name,
        p_consent_version: mode === 'enroll' ? CONSENT_VERSION : null,
        p_token_hash: tokenHash,
        p_token_expires_at: expiresAt,
      },
    );
    if (identityError) return mapDbError(identityError, 'identity');
    if (!isRecord(identityValue) || identityValue.found !== true) return identityNotConfirmed();

    const { data: accountValue, error: accountError } = await client.rpc(
      'get_public_loyalty_account',
      { p_access_token: accessToken },
    );
    if (accountError) return mapDbError(accountError, 'account');
    if (!isRecord(accountValue) || accountValue.found !== true) {
      return apiError('LOYALTY_INTEGRITY', 'Inconsistencia interna de fidelidade', 500);
    }

    const token = isRecord(identityValue.token) ? identityValue.token : null;
    return json({
      found: true,
      membership_id: identityValue.membership_id,
      customer: accountValue.customer,
      account: accountValue.account,
      statement: Array.isArray(accountValue.statement) ? accountValue.statement : [],
      token: {
        access_token: accessToken,
        expires_at: token && typeof token.expires_at === 'string' ? token.expires_at : expiresAt,
      },
    });
  };
}

export const handler = createHandler();

if (import.meta.main) Deno.serve(handler);
