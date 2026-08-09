create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  onboarding_status text not null default 'pending'
    check (onboarding_status in ('pending', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.organization_members enable row level security;

create table public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.units enable row level security;

create index organization_members_user_id_idx on public.organization_members (user_id);
create index units_organization_id_idx on public.units (organization_id);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create trigger set_units_updated_at
before update on public.units
for each row execute function public.set_updated_at();

create function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;

create policy "profiles_select_own" on public.profiles
for select to authenticated using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "organizations_select_member" on public.organizations
for select to authenticated using (public.is_org_member(id));

create policy "organization_members_select_same_org" on public.organization_members
for select to authenticated using (public.is_org_member(organization_id));

create policy "units_select_member" on public.units
for select to authenticated using (public.is_org_member(organization_id));

create function public.complete_onboarding(p_organization_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_name text := nullif(btrim(p_organization_name), '');
begin
  if v_user_id is null then
    raise exception 'Usuário não autenticado';
  end if;
  if v_name is null then
    raise exception 'Nome da organização é obrigatório';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));

  if exists (
    select 1 from public.organization_members om
    where om.user_id = v_user_id
  ) then
    raise exception 'Usuário já possui uma organização';
  end if;

  insert into public.organizations (name)
  values (v_name)
  returning id into v_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org_id, v_user_id, 'owner');

  insert into public.units (organization_id, name)
  values (v_org_id, 'Unidade principal');

  update public.profiles
  set onboarding_status = 'completed', updated_at = now()
  where id = v_user_id;

  return v_org_id;
end;
$$;

revoke all on function public.complete_onboarding(text) from public;
grant execute on function public.complete_onboarding(text) to authenticated;

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant select on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant select on public.units to authenticated;
