-- =============================================================
-- PED-ON — PILOT FINDING P1 — MEMBER ONBOARDING (HOTFIX)
-- Fluxo mínimo e seguro de convite para manager/operator.
-- Preserva o contrato ONE USER → AT MOST ONE ORGANIZATION e o
-- get_my_admin_context (uma única organização por usuário).
-- Convite vinculado ao e-mail autenticado do usuário (modelo
-- VERIFIED-EMAIL): nenhum token secreto; nenhuma Edge Function.
-- Owner convida → convidado se autentica com o mesmo e-mail →
-- aceita → membership criada → owner atribui unidade via RPCs
-- existentes (assign_unit_to_member). Sem unit assignment automático.
-- Migration versionada aplicada pelo mecanismo oficial do projeto.
-- =============================================================

-- Códigos de erro estáveis (SQLSTATE próprio), continuando a série:
-- PED80 NOT_AUTHENTICATED | PED81 FORBIDDEN | PED82 EMAIL_REQUIRED
-- PED83 INVALID_ROLE | PED84 ALREADY_MEMBER | PED85 ALREADY_IN_ORGANIZATION
-- PED86 INVITE_NOT_FOUND | PED87 INVITE_EXPIRED | PED88 INVITE_REVOKED
-- PED89 INVITE_ALREADY_ACCEPTED | PED90 EMAIL_MISMATCH

-- Prazo conservador de validade do convite (7 dias). Sem cron job:
-- a expiração é resolvida dinamicamente por expires_at.
create table public.organization_member_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (char_length(btrim(email)) > 0),
  role text not null check (role in ('manager', 'operator')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete cascade,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete cascade
);

alter table public.organization_member_invites enable row level security;

create index organization_member_invites_organization_id_idx
  on public.organization_member_invites (organization_id);

create index organization_member_invites_email_idx
  on public.organization_member_invites (email);

-- Idempotência: no máximo UM convite pendente por (organização, e-mail).
-- Aceitos/revogados não bloqueiam novos convites para o mesmo e-mail.
create unique index organization_member_invites_org_email_pending_key
  on public.organization_member_invites (organization_id, email)
  where status = 'pending';

-- RLS: sem INSERT/UPDATE/DELETE diretos (escrita exclusiva via RPCs).
-- SELECT somente owner da organização; o convidado resolve os próprios
-- convites via RPC get_my_pending_member_invites (sem enumeração).
create policy "organization_member_invites_select_owner"
  on public.organization_member_invites
  for select to authenticated
  using (public.is_org_owner(organization_id));

grant select on public.organization_member_invites to authenticated;

-- 1) CONVIDAR MEMBRO (owner-only). Organização derivada do owner
--    autenticado; nenhuma confiança em organization_id do browser.
create or replace function public.invite_org_member(p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_email text := lower(btrim(nullif(p_email, '')));
  v_role text := nullif(btrim(p_role), '');
  v_invite public.organization_member_invites;
  v_renewed boolean := false;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED80';
  end if;
  if v_email is null or v_email = '' or char_length(v_email) > 254 then
    raise exception 'EMAIL_REQUIRED' using errcode = 'PED82';
  end if;
  if v_role is null or v_role not in ('manager', 'operator') then
    raise exception 'INVALID_ROLE' using errcode = 'PED83';
  end if;

  select om.organization_id into v_org_id
  from public.organization_members om
  where om.user_id = v_user_id
    and om.role = 'owner'
  order by om.created_at asc, om.organization_id asc
  limit 1;

  if v_org_id is null then
    raise exception 'FORBIDDEN' using errcode = 'PED81';
  end if;

  -- Serializa convites concorrentes por (organização, e-mail).
  perform pg_advisory_xact_lock(hashtext('pedon:invite:' || v_org_id::text || ':' || v_email));

  -- Não reconvidar membro já existente da organização.
  if exists (
    select 1
    from public.organization_members om
    join public.profiles p on p.id = om.user_id
    where om.organization_id = v_org_id
      and lower(btrim(p.email)) = v_email
  ) then
    raise exception 'ALREADY_MEMBER' using errcode = 'PED84';
  end if;

  -- Idempotente: convite pendente existente é retornado; se expirado,
  -- é renovado com um novo prazo (owner pode renovar com segurança).
  select * into v_invite
  from public.organization_member_invites i
  where i.organization_id = v_org_id
    and i.email = v_email
    and i.status = 'pending'
  limit 1;

  if v_invite is not null then
    if v_invite.expires_at <= now() then
      update public.organization_member_invites
      set expires_at = now() + interval '7 days'
      where id = v_invite.id
      returning * into v_invite;
      v_renewed := true;
    end if;

    return jsonb_build_object(
      'id', v_invite.id,
      'organization_id', v_invite.organization_id,
      'email', v_invite.email,
      'role', v_invite.role,
      'created_at', v_invite.created_at,
      'expires_at', v_invite.expires_at,
      'status', v_invite.status,
      'created', false,
      'renewed', v_renewed
    );
  end if;

  insert into public.organization_member_invites
    (organization_id, email, role, invited_by, expires_at)
  values (v_org_id, v_email, v_role, v_user_id, now() + interval '7 days')
  returning * into v_invite;

  return jsonb_build_object(
    'id', v_invite.id,
    'organization_id', v_invite.organization_id,
    'email', v_invite.email,
    'role', v_invite.role,
    'created_at', v_invite.created_at,
    'expires_at', v_invite.expires_at,
    'status', v_invite.status,
    'created', true,
    'renewed', false
  );
end;
$$;

revoke all on function public.invite_org_member(text, text) from public, anon;
grant execute on function public.invite_org_member(text, text) to authenticated;

-- 2) REVOGAR CONVITE (owner-only, idempotente). Não remove membro
--    já aceito e não afeta outro tenant.
create or replace function public.revoke_org_member_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_invite public.organization_member_invites;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED80';
  end if;
  if p_invite_id is null then
    raise exception 'INVITE_NOT_FOUND' using errcode = 'PED86';
  end if;

  select * into v_invite
  from public.organization_member_invites i
  where i.id = p_invite_id;

  if v_invite is null then
    raise exception 'INVITE_NOT_FOUND' using errcode = 'PED86';
  end if;

  if not public.is_org_owner(v_invite.organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED81';
  end if;

  if v_invite.status = 'accepted' then
    raise exception 'INVITE_ALREADY_ACCEPTED' using errcode = 'PED89';
  end if;

  -- Idempotente: convite já revogado permanece revogado.
  if v_invite.status = 'revoked' then
    return jsonb_build_object(
      'id', v_invite.id,
      'organization_id', v_invite.organization_id,
      'email', v_invite.email,
      'role', v_invite.role,
      'status', v_invite.status,
      'revoked_at', v_invite.revoked_at,
      'revoked', false
    );
  end if;

  update public.organization_member_invites
  set status = 'revoked', revoked_at = now(), revoked_by = v_user_id
  where id = p_invite_id
    and status = 'pending'
  returning * into v_invite;

  return jsonb_build_object(
    'id', v_invite.id,
    'organization_id', v_invite.organization_id,
    'email', v_invite.email,
    'role', v_invite.role,
    'status', v_invite.status,
    'revoked_at', v_invite.revoked_at,
    'revoked', true
  );
end;
$$;

revoke all on function public.revoke_org_member_invite(uuid) from public, anon;
grant execute on function public.revoke_org_member_invite(uuid) to authenticated;

-- 3) LISTAR convites da organização (owner-only). Nunca expõe token
--    (não existe token neste modelo) nem dados de outro tenant.
create or replace function public.get_org_member_invites(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED80';
  end if;
  if p_organization_id is null or not public.is_org_owner(p_organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'PED81';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'email', i.email,
          'role', i.role,
          'status', i.status,
          'created_at', i.created_at,
          'expires_at', i.expires_at,
          'accepted_at', i.accepted_at,
          'revoked_at', i.revoked_at
        )
        order by i.created_at desc
      ),
      '[]'::jsonb
    )
    from public.organization_member_invites i
    where i.organization_id = p_organization_id
  );
end;
$$;

revoke all on function public.get_org_member_invites(uuid) from public, anon;
grant execute on function public.get_org_member_invites(uuid) to authenticated;

-- 4) Convites pendentes do usuário autenticado. A identidade vem do
--    usuário autenticado (auth.uid() + e-mail do perfil), nunca de
--    input arbitrário — sem enumeração de e-mails.
create or replace function public.get_my_pending_member_invites()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED80';
  end if;

  select lower(btrim(p.email)) into v_email
  from public.profiles p
  where p.id = v_user_id;

  if v_email is null then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'organization_id', i.organization_id,
          'organization_name', o.name,
          'role', i.role,
          'created_at', i.created_at,
          'expires_at', i.expires_at
        )
        order by i.created_at asc
      ),
      '[]'::jsonb
    )
    from public.organization_member_invites i
    join public.organizations o on o.id = i.organization_id
    where i.email = v_email
      and i.status = 'pending'
      and i.expires_at > now()
  );
end;
$$;

revoke all on function public.get_my_pending_member_invites() from public, anon;
grant execute on function public.get_my_pending_member_invites() to authenticated;

-- 5) ACEITAR CONVITE (contrato crítico, transacional e fail-closed).
  -- Locks: usuário primeiro (mesma chave de complete_onboarding, para
  -- serializar contra criação concorrente de organização), depois convite
  -- (impede duplo aceite/reuso). Nenhuma membership_units criada
  -- automaticamente — owner atribui unidade depois.
create or replace function public.accept_org_member_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_invite public.organization_member_invites;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'PED80';
  end if;
  if p_invite_id is null then
    raise exception 'INVITE_NOT_FOUND' using errcode = 'PED86';
  end if;

  select lower(btrim(p.email)) into v_email
  from public.profiles p
  where p.id = v_user_id;

  if v_email is null then
    raise exception 'EMAIL_MISMATCH' using errcode = 'PED90';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));
  perform pg_advisory_xact_lock(hashtext('pedon:invite:' || p_invite_id::text));

  select * into v_invite
  from public.organization_member_invites i
  where i.id = p_invite_id
  for update;

  if v_invite is null then
    raise exception 'INVITE_NOT_FOUND' using errcode = 'PED86';
  end if;

  if v_invite.status = 'revoked' then
    raise exception 'INVITE_REVOKED' using errcode = 'PED88';
  end if;
  if v_invite.status = 'accepted' then
    raise exception 'INVITE_ALREADY_ACCEPTED' using errcode = 'PED89';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'INVITE_EXPIRED' using errcode = 'PED87';
  end if;
  if v_invite.email <> v_email then
    raise exception 'EMAIL_MISMATCH' using errcode = 'PED90';
  end if;

  -- ONE USER → AT MOST ONE ORGANIZATION.
  if exists (
    select 1
    from public.organization_members om
    where om.user_id = v_user_id
  ) then
    raise exception 'ALREADY_IN_ORGANIZATION' using errcode = 'PED85';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_invite.organization_id, v_user_id, v_invite.role);

  update public.organization_member_invites
  set status = 'accepted', accepted_at = now(), accepted_by = v_user_id
  where id = p_invite_id;

  update public.profiles
  set onboarding_status = 'completed', updated_at = now()
  where id = v_user_id;

  return jsonb_build_object(
    'organization_id', v_invite.organization_id,
    'role', v_invite.role,
    'accepted', true
  );
end;
$$;

revoke all on function public.accept_org_member_invite(uuid) from public, anon;
grant execute on function public.accept_org_member_invite(uuid) to authenticated;
