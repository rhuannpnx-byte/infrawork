-- InfraWork — Acompanhamento (Fase B): motor de alertas
--
-- Tabela `acompanhamento_alerta` armazena desvios calculados periodicamente
-- pela Edge Function `acompanhamento-alertas-recalcular`. Cada alerta tem:
--   - tipo (categoriza o problema)
--   - severidade (info / warn / critical)
--   - contexto jsonb (qualquer dado relevante: tarefa_id, equipe_id, ...)
--   - contexto_hash gerado (md5 do tipo + contexto) -> evita duplicatas
--   - status (aberto / silenciado / resolvido)
--
-- Anti-spam: UNIQUE parcial (obra_id, contexto_hash) WHERE status='aberto'.
-- Re-execução do recalculo: usa INSERT ... ON CONFLICT DO NOTHING. Alertas
-- abertos cujo contexto_hash sumiu na re-execução são marcados como
-- 'resolvido' automaticamente (lógica vive na Edge Function).
--
-- Engenheiros podem mudar apenas o status (silenciar/resolver). A trigger
-- `fn_alerta_eng_whitelist` impede que mudem tipo/contexto/severidade.

-- ─────────────────────────────────────────────────────────────────────────
-- Tabela alerta
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.acompanhamento_alerta (
  id                          uuid          primary key default gen_random_uuid(),
  obra_id                     uuid          not null references public.obras(id) on delete cascade,
  tipo                        text          not null,
  severidade                  text          not null default 'warn',
  titulo                      text          not null,
  descricao                   text,
  contexto                    jsonb         not null default '{}'::jsonb,
  contexto_hash               text          generated always as (
                                              md5(tipo || '|' || coalesce(contexto::text, '{}'))
                                            ) stored,
  status                      text          not null default 'aberto',
  silenciado_ate              timestamptz,
  silenciado_por              uuid          references public.profiles(id) on delete set null,
  resolvido_em                timestamptz,
  resolvido_automaticamente   boolean       not null default false,
  criado_em                   timestamptz   not null default now(),
  updated_at                  timestamptz   not null default now()
);

do $$ begin
  alter table public.acompanhamento_alerta
    add constraint chk_acomp_alerta_tipo
    check (tipo in (
      'producao_zero_dias',
      'desvio_quantidade',
      'desvio_prazo',
      'sem_foto_periodo',
      'equipe_nao_vinculada',
      'encarregado_nao_vinculado',
      'servico_nao_vinculado',
      'produtividade_baixa',
      'sync_falhou'
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.acompanhamento_alerta
    add constraint chk_acomp_alerta_severidade
    check (severidade in ('info', 'warn', 'critical'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.acompanhamento_alerta
    add constraint chk_acomp_alerta_status
    check (status in ('aberto', 'silenciado', 'resolvido'));
exception when duplicate_object then null; end $$;

-- Dedupe: só pode existir 1 alerta ABERTO por (obra, contexto_hash)
create unique index if not exists idx_acomp_alerta_dedupe_aberto
  on public.acompanhamento_alerta(obra_id, contexto_hash)
  where status = 'aberto';

create index if not exists idx_acomp_alerta_obra_status
  on public.acompanhamento_alerta(obra_id, status, severidade);
create index if not exists idx_acomp_alerta_obra_tipo
  on public.acompanhamento_alerta(obra_id, tipo);
create index if not exists idx_acomp_alerta_criado
  on public.acompanhamento_alerta(obra_id, criado_em desc);

-- ─────────────────────────────────────────────────────────────────────────
-- Helper SECURITY DEFINER (lookup obra_id pelo id)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.acomp_alerta_obra(_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select obra_id from public.acompanhamento_alerta where id = _id
$$;

alter function public.acomp_alerta_obra(uuid) owner to postgres;
revoke all on function public.acomp_alerta_obra(uuid) from public;
grant execute on function public.acomp_alerta_obra(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger: engenheiro só pode mudar status/silenciado_*, não tipo/contexto
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_alerta_eng_whitelist()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.auth_role();
begin
  if v_role in ('god', 'adm') then
    return new;
  end if;
  -- engenheiro/apoio: bloqueia mudança em campos críticos
  if new.tipo        <> old.tipo        then raise exception 'eng não pode mudar tipo do alerta';        end if;
  if new.severidade  <> old.severidade  then raise exception 'eng não pode mudar severidade do alerta';  end if;
  if new.contexto    <> old.contexto    then raise exception 'eng não pode mudar contexto do alerta';    end if;
  if new.titulo      <> old.titulo      then raise exception 'eng não pode mudar título do alerta';      end if;
  if new.obra_id     <> old.obra_id     then raise exception 'eng não pode mudar obra do alerta';        end if;
  new.updated_at := now();
  return new;
end $$;

alter function public.fn_alerta_eng_whitelist() owner to postgres;

drop trigger if exists trg_alerta_eng_whitelist on public.acompanhamento_alerta;
create trigger trg_alerta_eng_whitelist
  before update on public.acompanhamento_alerta
  for each row execute function public.fn_alerta_eng_whitelist();

-- ─────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────
alter table public.acompanhamento_alerta enable row level security;

-- god: SELECT + UPDATE (silenciar/resolver) — escrita full via service_role
drop policy if exists acomp_alerta_god_select on public.acompanhamento_alerta;
create policy acomp_alerta_god_select on public.acompanhamento_alerta
  for select to authenticated
  using (public.auth_role() = 'god');

drop policy if exists acomp_alerta_god_update on public.acompanhamento_alerta;
create policy acomp_alerta_god_update on public.acompanhamento_alerta
  for update to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

-- adm: SELECT + UPDATE empresa
drop policy if exists acomp_alerta_adm_select on public.acompanhamento_alerta;
create policy acomp_alerta_adm_select on public.acompanhamento_alerta
  for select to authenticated
  using (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

drop policy if exists acomp_alerta_adm_update on public.acompanhamento_alerta;
create policy acomp_alerta_adm_update on public.acompanhamento_alerta
  for update to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

-- engenheiro: SELECT + UPDATE (whitelist via trigger)
drop policy if exists acomp_alerta_eng_select on public.acompanhamento_alerta;
create policy acomp_alerta_eng_select on public.acompanhamento_alerta
  for select to authenticated
  using (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

drop policy if exists acomp_alerta_eng_update on public.acompanhamento_alerta;
create policy acomp_alerta_eng_update on public.acompanhamento_alerta
  for update to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(obra_id, auth.uid()));

-- apoio: SELECT only
drop policy if exists acomp_alerta_apoio_select on public.acompanhamento_alerta;
create policy acomp_alerta_apoio_select on public.acompanhamento_alerta
  for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));
