-- InfraWork — Planejamento: indireto-tarefa herda custo/receita do item orçado.
--
-- Mudança: `custo_unitario` e `receita_unitaria` na tabela
-- `planejamento_tarefa_indireto` viram NULLABLE. Quando NULL, o motor lê:
--   custo_unit:  item_orcamentario.custo_unitario_calc  (vem do indireto_item.valor_total)
--   receita_unit: item_orcamentario.venda_total_calc / quantidade_referencia
--                 (receita "por período" orçada — derivada do rollup do orçamento)
--
-- Justificativa: o item orçamentário JÁ contém custo e receita do agrupador
-- indireto. Pedir novamente no form do cronograma cria duplicidade e
-- divergência entre orçamento e planejamento. Mantemos a coluna nullable
-- como "override opcional" — quando preenchida, sobrescreve o valor do item;
-- quando NULL (default), reflete sempre o orçamento atual.
--
-- Também atualiza a view v10 pra expor `custo_unitario_calc` do item, que o
-- edge function precisa pra fallback.

-- ─── Schema ──────────────────────────────────────────────────────────────

alter table public.planejamento_tarefa_indireto
  alter column custo_unitario drop not null;

alter table public.planejamento_tarefa_indireto
  alter column custo_unitario drop default;

alter table public.planejamento_tarefa_indireto
  drop constraint if exists chk_pti_custo_unitario_nonneg;

do $$ begin
  alter table public.planejamento_tarefa_indireto
    add constraint chk_pti_custo_unitario_nonneg
    check (custo_unitario is null or custo_unitario >= 0);
exception when duplicate_object then null; end $$;

-- Relaxar check de receita: aceita NULL quando modo='mesma_logica_custo'
-- (significa "usar venda_total/qtd_referencia do item").
alter table public.planejamento_tarefa_indireto
  drop constraint if exists chk_pti_receita_coerencia;

do $$ begin
  alter table public.planejamento_tarefa_indireto
    add constraint chk_pti_receita_coerencia
    check (
      (receita_modo = 'mesma_logica_custo'
        and receita_percentual is null
        and (receita_unitaria is null or receita_unitaria >= 0))
      or
      (receita_modo = 'percentual_dos_servicos'
        and receita_unitaria is null
        and receita_percentual is not null
        and receita_percentual >= 0
        and receita_percentual <= 100)
    );
exception when duplicate_object then null; end $$;

comment on column public.planejamento_tarefa_indireto.custo_unitario is
  'Override opcional do custo por período. NULL = usa item.custo_unitario_calc do orçamento (derivado de indireto_item.valor_total).';

comment on column public.planejamento_tarefa_indireto.receita_unitaria is
  'Override opcional da receita por período (modo mesma_logica_custo). NULL = usa item.venda_total_calc / quantidade_referencia.';

-- ─── View v10 (recreate) ─────────────────────────────────────────────────
-- Adiciona custo_unitario_item (= item.custo_unitario_calc) e mantém
-- venda_total_item e quantidade_referencia, que o frontend e o edge usam
-- pra inferir receita unitária por período.

drop view if exists public.vw_planejamento_tarefa_completa cascade;

create view public.vw_planejamento_tarefa_completa
with (security_invoker = true)
as
select
  t.id                          as id,
  t.planejamento_id             as planejamento_id,
  t.item_orcamentario_id        as item_orcamentario_id,
  t.data_inicio                 as data_inicio,
  t.data_fim                    as data_fim,
  t.duracao_dias_uteis_calc     as duracao_dias_uteis_calc,
  t.data_inicio_manual          as data_inicio_manual,
  t.notas                       as notas,
  t.ordem                       as ordem,
  t.created_at                  as created_at,
  t.updated_at                  as updated_at,
  t.tipo_no                     as tipo_no,
  t.parent_id                   as parent_id,
  t.nivel                       as nivel,
  t.codigo_eap                  as codigo_eap,
  t.nome_custom                 as nome_custom,
  t.quantidade_alocada          as quantidade_alocada,
  t.qtd_link                    as qtd_link,
  t.early_start                 as early_start,
  t.early_finish                as early_finish,
  t.late_start                  as late_start,
  t.late_finish                 as late_finish,
  t.total_float                 as total_float,
  t.free_float                  as free_float,
  t.is_critico                  as is_critico,
  t.schedule_mode               as schedule_mode,
  t.constraint_type             as constraint_type,
  t.constraint_date             as constraint_date,
  t.posicao_inicio_m            as posicao_inicio_m,
  t.posicao_fim_m               as posicao_fim_m,
  t.unidade_espaco_display      as unidade_espaco_display,
  coalesce(t.unidade_espaco_display, tr.unidade_espaco_padrao)
                                as unidade_espaco_efetiva,
  t.trecho_id                   as trecho_id,
  tr.nome                       as trecho_nome,
  tr.ordem                      as trecho_ordem,
  t.perfil_default              as perfil_default,
  t.usa_perfil_customizado      as usa_perfil_customizado,

  p.obra_id                     as obra_id,
  p.is_baseline                 as is_baseline,
  p.status                      as planejamento_status,
  p.data_date                   as planejamento_data_date,

  i.codigo                      as servico_grupo_codigo,
  i.descricao                   as servico_grupo_descricao,
  i.quantidade_referencia       as quantidade_referencia,
  i.servico_id                  as servico_id,
  i.indireto_id                 as indireto_id,
  i.unidade_referencia          as unidade_referencia_item,
  i.custo_unitario_calc         as custo_unitario_item,
  i.venda_unitaria              as venda_unitaria_item,
  i.venda_total_calc            as venda_total_item,
  s.codigo                      as servico_codigo,
  s.nome                        as servico_nome,
  s.unidade                     as unidade_servico,
  i.cpu_snapshot_id             as cpu_snapshot_id,
  snap.cpu_id_origem            as cpu_id_origem,
  snap.producao_diaria_qtde     as producao_diaria_qtde,
  snap.producao_diaria_unidade  as producao_diaria_unidade,
  snap.custo_unit               as custo_unit_snapshot,

  (i.indireto_id is not null)   as is_indireto,
  case
    when i.indireto_id is not null and pti.tarefa_id is not null then
      jsonb_build_object(
        'custo_periodicidade', pti.custo_periodicidade,
        'custo_unitario',      pti.custo_unitario,
        'receita_modo',        pti.receita_modo,
        'receita_unitaria',    pti.receita_unitaria,
        'receita_percentual',  pti.receita_percentual,
        'offset_dias_antes',   pti.offset_dias_antes,
        'offset_dias_depois',  pti.offset_dias_depois,
        'receita_extrapola',   pti.receita_extrapola,
        'aplica_taxas',        pti.aplica_taxas,
        'taxa_regime_id',      pti.taxa_regime_id,
        'periodos_calc',       pti.periodos_calc
      )
    else null
  end                           as indireto_config,

  -- Custo unificado: indireta usa cache (cobre custo_total_calc da config),
  -- direta usa custo_unit_snapshot × quantidade_alocada.
  case
    when i.indireto_id is not null then coalesce(pti.custo_total_calc, 0)::numeric(18,2)
    when snap.custo_unit is not null and t.quantidade_alocada is not null then
      (snap.custo_unit * t.quantidade_alocada)::numeric(18,2)
    else 0::numeric(18,2)
  end                           as custo_total_calc,

  case
    when i.indireto_id is not null then coalesce(pti.receita_total_calc, 0)::numeric(18,2)
    when i.venda_unitaria is not null and t.quantidade_alocada is not null then
      (i.venda_unitaria * t.quantidade_alocada)::numeric(18,2)
    else 0::numeric(18,2)
  end                           as receita_total_calc,

  case
    when i.indireto_id is not null then pti.custo_taxas_calc
    else null
  end                           as custo_taxas_calc,

  case
    when snap.custo_unit is not null and t.quantidade_alocada is not null
      then (snap.custo_unit * t.quantidade_alocada)::numeric(14, 2)
    else 0::numeric(14, 2)
  end                           as custo_total_tarefa,

  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'id',          e.id,
              'nome',        e.nome,
              'cor',         e.cor,
              'tipo',        e.tipo,
              'qtd_equipes', pte.qtd_equipes
            ) order by e.nome)
       from public.planejamento_tarefa_equipe pte
       join public.equipe e on e.id = pte.equipe_id
      where pte.tarefa_id = t.id),
    '[]'::jsonb
  )                             as equipes,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'id',              d.id,
              'predecessora_id', d.predecessora_id,
              'tipo',            d.tipo,
              'lag_dias',        d.lag_dias
            ))
       from public.planejamento_dependencia d
      where d.sucessora_id = t.id),
    '[]'::jsonb
  )                             as predecessoras,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'id',           d.id,
              'sucessora_id', d.sucessora_id,
              'tipo',         d.tipo,
              'lag_dias',     d.lag_dias
            ))
       from public.planejamento_dependencia d
      where d.predecessora_id = t.id),
    '[]'::jsonb
  )                             as sucessoras,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
              'semana_segunda',       ps.semana_segunda,
              'quantidade_planejada', ps.quantidade_planejada
            ) order by ps.semana_segunda)
       from public.planejamento_tarefa_perfil_semana ps
      where ps.tarefa_id = t.id),
    '[]'::jsonb
  )                             as perfil_semanas
from public.planejamento_tarefa t
join public.planejamento p           on p.id = t.planejamento_id
left join public.obra_trecho tr      on tr.id = t.trecho_id
left join public.item_orcamentario i on i.id = t.item_orcamentario_id
left join public.servico s           on s.id = i.servico_id
left join public.cpu_snapshot snap   on snap.id = i.cpu_snapshot_id
left join public.planejamento_tarefa_indireto pti on pti.tarefa_id = t.id;

grant select on public.vw_planejamento_tarefa_completa to authenticated;

-- ─── RPC criar_tarefa_indireta: aceita custo_unitario/receita_unitaria NULL ──
-- (Re-cria a função pra usar default 0 em vez de erro quando custo_unitario
-- está ausente — herda do item depois via edge.)

create or replace function public.criar_tarefa_indireta(
  p_planejamento_id      uuid,
  p_item_orcamentario_id uuid,
  p_indireto_config      jsonb,
  p_parent_id            uuid    default null,
  p_nome_custom          text    default null,
  p_ordem                int     default 0,
  p_notas                text    default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tarefa_id   uuid;
  v_indireto_id uuid;
begin
  select indireto_id into v_indireto_id
  from public.item_orcamentario
  where id = p_item_orcamentario_id;
  if v_indireto_id is null then
    raise exception 'Item % não é indireto (não tem indireto_id)', p_item_orcamentario_id
      using errcode = '22023';
  end if;

  if p_indireto_config is null
     or p_indireto_config->>'custo_periodicidade' is null
     or p_indireto_config->>'receita_modo' is null then
    raise exception 'indireto_config deve conter custo_periodicidade e receita_modo'
      using errcode = '22023';
  end if;

  insert into public.planejamento_tarefa (
    planejamento_id,
    item_orcamentario_id,
    tipo_no,
    parent_id,
    nome_custom,
    ordem,
    notas,
    nivel,
    perfil_default
  ) values (
    p_planejamento_id,
    p_item_orcamentario_id,
    'tarefa',
    p_parent_id,
    p_nome_custom,
    coalesce(p_ordem, 0),
    p_notas,
    1,
    'uniforme'
  )
  returning id into v_tarefa_id;

  insert into public.planejamento_tarefa_indireto (
    tarefa_id,
    custo_periodicidade,
    custo_unitario,
    receita_modo,
    receita_unitaria,
    receita_percentual,
    offset_dias_antes,
    offset_dias_depois,
    receita_extrapola,
    aplica_taxas,
    taxa_regime_id
  ) values (
    v_tarefa_id,
    p_indireto_config->>'custo_periodicidade',
    nullif(p_indireto_config->>'custo_unitario','')::numeric,
    p_indireto_config->>'receita_modo',
    nullif(p_indireto_config->>'receita_unitaria','')::numeric,
    nullif(p_indireto_config->>'receita_percentual','')::numeric,
    coalesce((p_indireto_config->>'offset_dias_antes')::int, 0),
    coalesce((p_indireto_config->>'offset_dias_depois')::int, 0),
    coalesce((p_indireto_config->>'receita_extrapola')::boolean, true),
    coalesce((p_indireto_config->>'aplica_taxas')::boolean, false),
    nullif(p_indireto_config->>'taxa_regime_id','')::uuid
  );

  return v_tarefa_id;
end;
$$;
