// =============================================================
// PED-ON - Prompt 09 - Edge Function loyalty-cpf.
//
// Unica porta de resolucao/inscricao do Clube Ped-On. O CPF bruto
// so existe nesta funcao (memoria de request); nada e persistido,
// logado ou retornado. O banco recebe apenas:
//   - cpf_fingerprint: HMAC-SHA-256 keyed por tenant
//   - cpf_last2: dois ultimos digitos para exibicao mascarada
//   - token_hash: SHA-256 de um access token opaco efemero (2h)
//
// Contrato HTTP (POST /functions/v1/loyalty-cpf):
//   { public_slug, mode: "lookup" | "enroll", cpf, name? }
// 200  { found: true, membership_id, customer, account, token }
// 200  { found: false }                       (lookup sem cadastro)
// 400  INVALID_MODE / INVALID_JSON / METHOD_NOT_ALLOWED
// 404  INVALID_SLUG
// 403  LOYALTY_UNAVAILABLE                    (PED51)
// 422  INVALID_CPF / INVALID_NAME             (PED43)
// 500  SERVER_CONFIG / LOYALTY_INTEGRITY      (PED53) / UPSTREAM_ERROR
//
// JWT: verificacao da plataforma (anon key) ligada no deploy.
// =============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 4096;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function apiError(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const keyData = /^[0-9a-f]{64}$/i.test(secret)
    ? hexToBytes(secret)
    : new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(signature));
}

function randomTokenHex(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToHex(buffer);
}

function normalizeCpf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits)) return null;
  return digits;
}

function isValidCpf(digits: string): boolean {
  if (/^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  if (rest !== Number(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(digits[i]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === Number(digits[10]);
}

function isSafePlainText(value: string): boolean {
  return !/[<>]|[\u0000-\u001f\u007f]/.test(value);
}

function mapDbError(error: { code?: string; message?: string }, phase: string): Response {
  const code = error?.code ?? '';
  if (code === 'PED51') {
    return apiError('LOYALTY_UNAVAILABLE', 'Clube indisponivel para este cardapio', 403);
  }
  if (code === 'PED43') {
    return apiError('INVALID_NAME', 'Dados de cadastro invalidos', 422);
  }
  if (code === 'PED53') {
    return apiError('LOYALTY_INTEGRITY', 'Inconsistencia interna de fidelidade', 500);
  }
  console.error(`loyalty-cpf:${phase}`, error?.message ?? error);
  return apiError('UPSTREAM_ERROR', 'Falha interna ao processar', 500);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return apiError('METHOD_NOT_ALLOWED', 'Somente POST e aceito', 405);
  }

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return apiError('PAYLOAD_TOO_LARGE', 'Payload excede 4 KB', 413);
    }
    body = JSON.parse(text) as Record<string, unknown>;
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

  let name: string | null = null;
  if (mode === 'enroll') {
    name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > 120 || !isSafePlainText(name)) {
      return apiError('INVALID_NAME', 'Nome entre 2 e 120 caracteres', 422);
    }
  }

  const secret = Deno.env.get('LOYALTY_CPF_HMAC_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !supabaseUrl || !serviceRoleKey) {
    return apiError('SERVER_CONFIG', 'Configuracao de servidor ausente', 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: context, error: contextError } = await supabase.rpc(
    'get_loyalty_public_context_internal',
    { p_public_slug: publicSlug },
  );
  if (contextError) return mapDbError(contextError, 'context');
  if (!context?.found) return apiError('INVALID_SLUG', 'Cardapio nao encontrado', 404);
  if (!context.program?.exists || !context.program.enabled) {
    return apiError('LOYALTY_UNAVAILABLE', 'Clube indisponivel para este cardapio', 403);
  }

  const organizationId = context.organization_id as string;
  const fingerprint = await hmacSha256Hex(secret, `pedon:cpf:v1:${organizationId}:${cpfDigits}`);
  const last2 = cpfDigits.slice(9);
  const accessToken = randomTokenHex();
  const tokenHash = await sha256Hex(accessToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const { data, error } = await supabase.rpc('resolve_loyalty_identity_internal', {
    p_organization_id: organizationId,
    p_cpf_fingerprint: fingerprint,
    p_cpf_last2: last2,
    p_mode: mode,
    p_name: name,
    p_token_hash: tokenHash,
    p_token_expires_at: expiresAt,
  });
  if (error) return mapDbError(error, 'identity');
  if (!data?.found) return json({ found: false });

  return json({
    found: true,
    membership_id: data.membership_id,
    customer: data.customer,
    account: data.account,
    token: {
      access_token: accessToken,
      expires_at: data.token?.expires_at ?? expiresAt,
    },
  });
});
