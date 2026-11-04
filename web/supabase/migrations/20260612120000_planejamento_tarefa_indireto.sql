-- InfraWork — Planejamento: tabela `planejamento_tarefa_indireto`.
--
-- Tarefas que apontam pra item_orcamentario com indireto_id (vs servico_id) têm
-- semântica fundamentalmente diferente:
--   * Custo recorrente (R$/dia, R$/mês, R$/ano) ao invés de quantidade × CPU.
--   * Duração dinâmica: cobre todo o período do cronograma + offsets pré/pós.
--   * Receita: pode acompanhar a mesma lógica do custo OU ser % do faturamento
--     das tarefas diretas no período da indireta.
--   * Pode aplicar taxas (encargos_sociais_regime) sobre receita como custo.
--   * Receita pode ser capada em item_orcamentario.venda_total_calc quando o
--     planejador estica o prazo da indireta além do que o orçamento contempla.
--
-- Esta tabela é 1:1 com planejamento_tarefa (PK = tarefa_id, FK CASCADE).
-- Cache de valores derivados (custo_total_calc, receita_total_calc, ...) é
-- preenchido pelo motor calcular-cronograma após forward/backward pass.

create table if not exists public.planejamento_tarefa_indireto (
  tarefa_id            uuid          primary key references public.planejamento_tarefa(id) on delete cascade,
  custo_periodicidade  text          not null,
  custo_unitario       numeric(18,4) not null default 0,
  receita_modo         text          not null,
  receita_unitaria     numeric(18,4),
  receita_percentual   numeric(7,4),
  offset_dias_antes    int           not null default 0,
  offset_dias_depois   int           not null default 0,
  -- Quando true (default), receita acompanha o período integral mesmo que
  -- ultrapasse item_orcamentario.venda_total_calc. Quando false, receita é
  -- capada — útil quando o planejador estica o prazo além do que a planilha paga.
  receita_extrapola    boolean       not null default true,
  aplica_taxas         boolean       not null default false,
  taxa_regime_id       uuid          references public.encargos_sociais_regime(id) on delete restrict,
  -- Valores derivados pelo motor (cache pós-recalc)
  custo_total_calc     numeric(18,4),
  receita_total_calc   numeric(18,4),
  custo_taxas_calc     numeric(18,4),
  periodos_calc        numeric(12,4),
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now()
);

-- Check constraints

do $$ begin
  alter table public.planejamento_tarefa_indireto
    add constraint chk_pti_custo_periodicidade
    check (custo_periodicidade in ('dia','mes','ano'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.planejamento_tarefa_indireto
    add constraint chk_pti_custo_unitario_nonneg
    check (custo_unitario >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.planejamento_tarefa_indireto
    add constraint chk_pti_receita_modo
    check (receita_modo in ('mesma_logica_custo','percentual_dos_servicos'));
exception when duplicate_object then null; end $$;

-- Coerência: cada modo de receita usa exatamente um dos dois campos.
do $$ begin
  alter table public.planejamento_tarefa_indireto
    add constraint chk_pti_receita_coerencia
    check (
      (receita_modo = 'mesma_logica_custo'
        and receita_unitaria is not null and receita_unitaria >= 0
        and receita_percentual is null)
      or
      (receita_modo = 'percentual_dos_servicos'
        and receita_percentual is not null
        and receita_percentual >= 0 and receita_percentual <= 100
        and receita_unitaria is null)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.planejamento_tarefa_indireto
    add constraint chk_pti_offsets_nonneg
    check (offset_dias_antes >= 0 and offset_dias_depois >= 0);
exception when duplicate_object then null; end $$;

-- Taxas: se aplica_taxas=true, taxa_regime_id obrigatório; senão deve ser NULL.
do $$ begin
  alter table public.planejamento_tarefa_indireto
    add constraint chk_pti_taxas_coerencia
    check (
      (aplica_taxas = true  and taxa_regime_id is not null)
      or
      (aplica_taxas = false and taxa_regime_id is null)
    );
exception when duplicate_object then null; end $$;

create index if not exists idx_pti_taxa_regime on public.planejamento_tarefa_indireto(taxa_regime_id);

-- Trigger updated_at
create or replace function public.fn_pti_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_pti_touch on public.planejamento_tarefa_indireto;
create trigger trg_pti_touch
  before update on public.planejamento_tarefa_indireto
  for each row execute function public.fn_pti_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — herda da tarefa via tarefa_obra(tarefa_id), mesmo padrão dos
-- demais filhos de planejamento_tarefa.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.planejamento_tarefa_indireto enable row level security;

drop policy if exists pti_god_all on public.planejamento_tarefa_indireto;
create policy pti_god_all on public.planejamento_tarefa_indireto
  for all to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists pti_adm_all on public.planejamento_tarefa_indireto;
create policy pti_adm_all on public.planejamento_tarefa_indireto
  for all to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(public.tarefa_obra(tarefa_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(public.tarefa_obra(tarefa_id)) = public.auth_empresa_id());

drop policy if exists pti_eng_all on public.planejamento_tarefa_indireto;
create policy pti_eng_all on public.planejamento_tarefa_indireto
  for all to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.tarefa_obra(tarefa_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.tarefa_obra(tarefa_id), auth.uid()));

drop policy if exists pti_apoio_select on public.planejamento_tarefa_indireto;
create policy pti_apoio_select on public.planejamento_tarefa_indireto
  for select to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(public.tarefa_obra(tarefa_id), public.auth_engenheiro_id()));

comment on table public.planejamento_tarefa_indireto is
  'Config 1:1 com planejamento_tarefa pra tarefas que apontam pra item_orcamentario.indireto_id. Custo recorrente, receita modo direto ou percentual, taxas opcionais, cobre dinâmicamente o cronograma.';
