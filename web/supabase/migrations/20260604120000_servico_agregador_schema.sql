-- ─────────────────────────────────────────────────────────────────────────
-- Servico-agregador: 1 serviço pode agregar N CPUs com fator de conversão
-- ─────────────────────────────────────────────────────────────────────────
-- Modelo novo: um servico (catálogo) pode vincular N CPUs (geralmente de
-- outros servicos folha) com um fator de conversão de unidade. O custo
-- unitário do servico-agregador é a soma de (cpu.custo_unit_calc / fator)
-- sobre os vínculos.
--
-- Fator = quantas unidades-da-CPU equivalem a 1 unidade-do-servico.
-- Exemplo: servico "Aplicação CBUQ" em toneladas; CPU "Produção CBUQ" em m³.
-- 1 m³ de CBUQ pesa 2.4 ton → fator = 2.4 (porque 1m³ da CPU gera 2.4 ton
-- do servico). Custo por tonelada = custo_por_m³ ÷ 2.4.
--
-- Default fator = 1.0 (unidades já batem). Produção diária pode ser herdada
-- da 1ª CPU vinculada ou setada manualmente.
--
-- A CPU "dona" (cpu.servico_id) continua funcionando como hoje — vincular
-- num servico-agregador é só um link adicional, não move a CPU.
--
-- Quando o servico-agregador é usado num item_orcamentario, o snapshot
-- captura todos os vínculos + fatores + custos no momento (snapshot rico
-- em cpu_snapshot.payload). Custo unitário do snapshot = soma agregada.

-- ─── servico: adiciona campo de produção diária opcional ────────────────
alter table public.servico
  add column if not exists producao_diaria_qtde numeric(14,4),
  add column if not exists producao_diaria_unidade text;

comment on column public.servico.producao_diaria_qtde is
  'Produção diária do servico-agregador. NULL = herda da 1ª CPU vinculada.';

-- ─── servico_cpu_link ───────────────────────────────────────────────────
create table if not exists public.servico_cpu_link (
  id              uuid          primary key default gen_random_uuid(),
  servico_id      uuid          not null references public.servico(id) on delete cascade,
  cpu_id          uuid          not null references public.cpu(id)     on delete cascade,
  fator           numeric(14,6) not null default 1.0,
  ordem           int           not null default 0,
  observacao      text,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),
  unique (servico_id, cpu_id)
);

create index if not exists idx_servico_cpu_link_servico on public.servico_cpu_link(servico_id, ordem);
create index if not exists idx_servico_cpu_link_cpu     on public.servico_cpu_link(cpu_id);

comment on table public.servico_cpu_link is
  'Vínculo N:N entre servico-agregador e CPUs. fator é divisor: custo_servico_unit = cpu.custo_unit / fator (fator = qtd unidades-CPU em 1 unidade-servico).';

comment on column public.servico_cpu_link.fator is
  'Divisor de conversão de unidade. Custo no servico = cpu.custo_unit / fator. Ex: CPU em m³, servico em ton, densidade 2.4 → fator = 2.4 (custo/m³ ÷ 2.4 = custo/ton). Default 1.0 quando unidades batem.';

-- ─── Trigger: touch updated_at ──────────────────────────────────────────
drop trigger if exists trg_servico_cpu_link_touch on public.servico_cpu_link;
create trigger trg_servico_cpu_link_touch
  before update on public.servico_cpu_link
  for each row execute function public.fn_touch_updated_at();

-- ─── Trigger: bloqueia vincular CPU de outra obra ───────────────────────
create or replace function public.fn_servico_cpu_link_mesma_obra()
returns trigger
language plpgsql
as $$
declare
  servico_obra uuid;
  cpu_obra     uuid;
begin
  select obra_id into servico_obra from public.servico where id = new.servico_id;
  select obra_id into cpu_obra     from public.cpu     where id = new.cpu_id;
  if servico_obra is null or cpu_obra is null then
    raise exception 'servico ou cpu inexistente';
  end if;
  if servico_obra <> cpu_obra then
    raise exception 'Servico e CPU devem pertencer à mesma obra (servico: %, cpu: %)',
      servico_obra, cpu_obra;
  end if;
  return new;
end
$$;

drop trigger if exists trg_servico_cpu_link_mesma_obra on public.servico_cpu_link;
create trigger trg_servico_cpu_link_mesma_obra
  before insert or update of servico_id, cpu_id on public.servico_cpu_link
  for each row execute function public.fn_servico_cpu_link_mesma_obra();

-- ─── RLS ────────────────────────────────────────────────────────────────
alter table public.servico_cpu_link enable row level security;

-- Helper SECURITY DEFINER (igual padrão de cpu_obra/servico_obra)
create or replace function public.servico_cpu_link_obra(_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select s.obra_id
    from public.servico_cpu_link l
    join public.servico s on s.id = l.servico_id
   where l.id = _id;
$$;
alter function public.servico_cpu_link_obra(uuid) owner to postgres;
revoke all on function public.servico_cpu_link_obra(uuid) from public;
grant execute on function public.servico_cpu_link_obra(uuid) to authenticated;

drop policy if exists servico_cpu_link_god_all on public.servico_cpu_link;
create policy servico_cpu_link_god_all on public.servico_cpu_link
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists servico_cpu_link_adm_all on public.servico_cpu_link;
create policy servico_cpu_link_adm_all on public.servico_cpu_link
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(public.servico_obra(servico_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(public.servico_obra(servico_id)) = public.auth_empresa_id());

drop policy if exists servico_cpu_link_eng_all on public.servico_cpu_link;
create policy servico_cpu_link_eng_all on public.servico_cpu_link
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.servico_obra(servico_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.servico_obra(servico_id), auth.uid()));

drop policy if exists servico_cpu_link_apoio_select on public.servico_cpu_link;
create policy servico_cpu_link_apoio_select on public.servico_cpu_link
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(public.servico_obra(servico_id), public.auth_engenheiro_id()));
