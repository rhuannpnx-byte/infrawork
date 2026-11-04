-- InfraWork — Initial schema (RBAC core)
-- Creates: role enum, empresas, profiles, obras, obra_permissoes
-- Plus auth helper functions (auth_role, auth_empresa_id, auth_engenheiro_id)
-- that bypass RLS via SECURITY DEFINER + postgres ownership, so policies
-- can safely consult the caller's profile without recursing through RLS.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────
-- Enum: role
-- ─────────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.role_enum as enum ('god', 'adm', 'engenheiro', 'apoio');
exception when duplicate_object then null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- empresas
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.empresas (
  id          uuid        primary key default gen_random_uuid(),
  nome        text        not null,
  cnpj        text        unique,
  ativo       boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- profiles (FK 1:1 com auth.users)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id             uuid        primary key references auth.users(id) on delete cascade,
  email          text        not null unique,
  nome           text        not null,
  role           public.role_enum not null,
  empresa_id     uuid        references public.empresas(id) on delete restrict,
  engenheiro_id  uuid        references public.profiles(id)  on delete set null,
  ativo          boolean     not null default true,
  created_at     timestamptz not null default now(),

  -- God é o único papel sem empresa; demais são obrigatórios
  constraint chk_god_no_empresa check (
    (role  = 'god' and empresa_id is null) or
    (role <> 'god' and empresa_id is not null)
  ),
  -- engenheiro_id só faz sentido para role='apoio' (e é obrigatório lá)
  constraint chk_apoio_has_engenheiro check (
    (role  = 'apoio' and engenheiro_id is not null) or
    (role <> 'apoio' and engenheiro_id is null)
  )
);

create index if not exists idx_profiles_empresa    on public.profiles(empresa_id);
create index if not exists idx_profiles_engenheiro on public.profiles(engenheiro_id);
create index if not exists idx_profiles_role       on public.profiles(role);

-- ─────────────────────────────────────────────────────────────────────────
-- obras
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.obras (
  id          uuid        primary key default gen_random_uuid(),
  empresa_id  uuid        not null references public.empresas(id) on delete restrict,
  nome        text        not null,
  codigo      text        not null,
  status      text        not null default 'em_andamento',
  created_at  timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create index if not exists idx_obras_empresa on public.obras(empresa_id);

-- ─────────────────────────────────────────────────────────────────────────
-- obra_permissoes
--   Vincula um ENGENHEIRO a uma OBRA. Apoios herdam por JOIN via engenheiro_id.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.obra_permissoes (
  id             uuid        primary key default gen_random_uuid(),
  obra_id        uuid        not null references public.obras(id)    on delete cascade,
  user_id        uuid        not null references public.profiles(id) on delete cascade,
  concedido_por  uuid        not null references public.profiles(id) on delete restrict,
  created_at     timestamptz not null default now(),
  unique (obra_id, user_id)
);

create index if not exists idx_obra_perm_obra on public.obra_permissoes(obra_id);
create index if not exists idx_obra_perm_user on public.obra_permissoes(user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Auth helpers
-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER + owner = postgres (BYPASSRLS) é proposital: estas funções
-- consultam profiles para resolver o papel do chamador, e precisam bypassar a
-- RLS de profiles para evitar recursão na própria policy.

create or replace function public.auth_role()
returns public.role_enum
language sql
stable
security definer
set search_path = public
as $$
  select role
    from public.profiles
   where id = auth.uid()
$$;

create or replace function public.auth_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select empresa_id
    from public.profiles
   where id = auth.uid()
$$;

create or replace function public.auth_engenheiro_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select engenheiro_id
    from public.profiles
   where id = auth.uid()
$$;

-- Cross-table helpers (usados nas policies de obras/obra_permissoes para evitar
-- recursão de RLS — ver migration 0001).

create or replace function public.obra_empresa(_obra_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select empresa_id from public.obras where id = _obra_id
$$;

create or replace function public.has_obra_permissao(_obra_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.obra_permissoes
     where obra_id = _obra_id
       and user_id = _user_id
  )
$$;

-- Definir postgres como owner explicitamente para garantir BYPASSRLS
alter function public.auth_role()                      owner to postgres;
alter function public.auth_empresa_id()                owner to postgres;
alter function public.auth_engenheiro_id()             owner to postgres;
alter function public.obra_empresa(uuid)               owner to postgres;
alter function public.has_obra_permissao(uuid, uuid)   owner to postgres;

-- Quem pode chamar
revoke all on function public.auth_role()                      from public;
revoke all on function public.auth_empresa_id()                from public;
revoke all on function public.auth_engenheiro_id()             from public;
revoke all on function public.obra_empresa(uuid)               from public;
revoke all on function public.has_obra_permissao(uuid, uuid)   from public;
grant execute on function public.auth_role()                      to authenticated, anon;
grant execute on function public.auth_empresa_id()                to authenticated, anon;
grant execute on function public.auth_engenheiro_id()             to authenticated, anon;
grant execute on function public.obra_empresa(uuid)               to authenticated;
grant execute on function public.has_obra_permissao(uuid, uuid)   to authenticated;
