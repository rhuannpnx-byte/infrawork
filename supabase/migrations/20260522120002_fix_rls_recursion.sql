-- InfraWork — Fix de recursão de RLS entre obras ↔ obra_permissoes
--
-- Problema:
--   As policies `obras_engenheiro_select` / `obras_apoio_select` faziam
--   EXISTS direto em obra_permissoes, e `obra_perm_adm_all` fazia EXISTS
--   direto em obras. Como cada SELECT aciona RLS da outra tabela, o
--   Postgres detecta o ciclo no planner e aborta com
--   "infinite recursion detected in policy for relation".
--
-- Correção:
--   Mover as consultas cruzadas para funções SECURITY DEFINER de owner=postgres
--   (BYPASSRLS). Dentro delas a RLS não é aplicada → não há ciclo. Mesma
--   técnica usada em `auth_role()` / `auth_empresa_id()` / `auth_engenheiro_id()`.

-- ─── helpers cross-table sem RLS ─────────────────────────────────────────

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

alter function public.obra_empresa(uuid)               owner to postgres;
alter function public.has_obra_permissao(uuid, uuid)   owner to postgres;

revoke all on function public.obra_empresa(uuid)             from public;
revoke all on function public.has_obra_permissao(uuid, uuid) from public;
grant execute on function public.obra_empresa(uuid)             to authenticated;
grant execute on function public.has_obra_permissao(uuid, uuid) to authenticated;

-- ─── obras: recria policies do engenheiro e do apoio ────────────────────

drop policy if exists obras_engenheiro_select on public.obras;
create policy obras_engenheiro_select on public.obras
  for select
  to authenticated
  using (
    public.auth_role() = 'engenheiro'
    and public.has_obra_permissao(obras.id, auth.uid())
  );

drop policy if exists obras_apoio_select on public.obras;
create policy obras_apoio_select on public.obras
  for select
  to authenticated
  using (
    public.auth_role() = 'apoio'
    and public.has_obra_permissao(obras.id, public.auth_engenheiro_id())
  );

-- ─── obra_permissoes: recria policy do adm sem EXISTS direto ────────────

drop policy if exists obra_perm_adm_all on public.obra_permissoes;
create policy obra_perm_adm_all on public.obra_permissoes
  for all
  to authenticated
  using (
    public.auth_role() = 'adm'
    and public.obra_empresa(obra_permissoes.obra_id) = public.auth_empresa_id()
  )
  with check (
    public.auth_role() = 'adm'
    and public.obra_empresa(obra_permissoes.obra_id) = public.auth_empresa_id()
  );
