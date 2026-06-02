-- InfraWork — Trechos por obra (BR-060 km 0-50, BR-452 km 0-120, etc.)
--
-- Obras frequentemente tem multiplos trechos com estaqueamento/km independentes.
-- Cada trecho carrega sua propria unidade de display (km|m|estaca). Tarefas
-- referenciam um trecho via planejamento_tarefa.trecho_id (em migration sibling).
--
-- Schema minimo: id, obra_id, nome, ordem, unidade_espaco_padrao. Sem inicio/fim
-- por enquanto — adiciona quando precisar validar overlap.

create table if not exists public.obra_trecho (
  id                     uuid primary key default gen_random_uuid(),
  obra_id                uuid not null references public.obras(id) on delete cascade,
  nome                   text not null,
  ordem                  integer not null default 0,
  unidade_espaco_padrao  text not null default 'km',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

do $$ begin
  alter table public.obra_trecho add constraint chk_obra_trecho_nome_nao_vazio
    check (length(trim(nome)) > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.obra_trecho add constraint chk_obra_trecho_unidade
    check (unidade_espaco_padrao in ('km','m','estaca'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.obra_trecho add constraint uq_obra_trecho_obra_nome
    unique (obra_id, nome);
exception when duplicate_object then null; end $$;

create index if not exists idx_obra_trecho_obra_ordem
  on public.obra_trecho (obra_id, ordem);

-- Touch trigger pra updated_at
drop trigger if exists trg_obra_trecho_updated_at on public.obra_trecho;
create trigger trg_obra_trecho_updated_at
  before update on public.obra_trecho
  for each row execute function public.fn_touch_updated_at();

-- ─── Helper SECURITY DEFINER ────────────────────────────────────────────
create or replace function public.trecho_obra(_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$ select obra_id from public.obra_trecho where id = _id $$;

alter function public.trecho_obra(uuid) owner to postgres;
revoke all on function public.trecho_obra(uuid) from public;
grant execute on function public.trecho_obra(uuid) to authenticated;

-- ─── RLS ────────────────────────────────────────────────────────────────
alter table public.obra_trecho enable row level security;

drop policy if exists obra_trecho_god_all on public.obra_trecho;
create policy obra_trecho_god_all on public.obra_trecho
  for all to authenticated
  using (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists obra_trecho_adm_all on public.obra_trecho;
create policy obra_trecho_adm_all on public.obra_trecho
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists obra_trecho_eng_all on public.obra_trecho;
create policy obra_trecho_eng_all on public.obra_trecho
  for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists obra_trecho_apoio_select on public.obra_trecho;
create policy obra_trecho_apoio_select on public.obra_trecho
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

grant select, insert, update, delete on public.obra_trecho to authenticated;
