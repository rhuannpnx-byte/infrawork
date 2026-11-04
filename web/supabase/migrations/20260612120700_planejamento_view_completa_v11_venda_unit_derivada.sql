-- InfraWork — Planejamento: vw_planejamento_tarefa_completa v11.
--
-- Diferença pra v10: deriva `venda_unitaria_item` para tipo=servico_grupo
-- (que tem `i.venda_unitaria = NULL` na coluna física — só tipo=receita tem
-- valor lá). Sem isso, as tarefas diretas (que apontam pra servico_grupo)
-- ficam com receita zero na Curva-S — bug crítico descoberto em 2026-06-02
-- ao validar a Curva-S contra o orçamento consolidado da obra TecPav.
--
-- Regra:
--   tipo='receita':       venda_unitaria_item = i.venda_unitaria      (campo físico)
--   tipo='servico_grupo': venda_unitaria_item = venda_total_calc / qtd_referencia
--   demais:               NULL
--
-- Outros campos: idênticos à v10.

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
  -- EAP / multi-tarefa
  t.tipo_no                     as tipo_no,
  t.parent_id                   as parent_id,
  t.nivel                       as nivel,
  t.codigo_eap                  as codigo_eap,
  t.nome_custom                 as nome_custom,
  t.quantidade_alocada          as quantidade_alocada,
  t.qtd_link                    as qtd_link,
  -- CPM
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
  -- Eixo espacial
  t.posicao_inicio_m            as posicao_inicio_m,
  t.posicao_fim_m               as posicao_fim_m,
  t.unidade_espaco_display      as unidade_espaco_display,
  coalesce(t.unidade_espaco_display, tr.unidade_espaco_padrao)
                                as unidade_espaco_efetiva,
  -- Trecho
  t.trecho_id                   as trecho_id,
  tr.nome                       as trecho_nome,
  tr.ordem                      as trecho_ordem,
  -- Perfil
  t.perfil_default              as perfil_default,
  t.usa_perfil_customizado      as usa_perfil_customizado,

  p.obra_id                     as obra_id,
  p.is_baseline                 as is_baseline,
  p.status                      as planejamento_status,
  p.data_date                   as planejamento_data_date,

  -- Item orçamentário
  i.codigo                      as servico_grupo_codigo,
  i.descricao                   as servico_grupo_descricao,
  i.quantidade_referencia       as quantidade_referencia,
  i.servico_id                  as servico_id,
  i.indireto_id                 as indireto_id,
  i.unidade_referencia          as unidade_referencia_item,
  i.custo_unitario_calc         as custo_unitario_item,
  -- venda_unitaria DERIVADA: tipo=receita usa campo físico; servico_grupo
  -- deriva via venda_total / qtd_referencia (campo físico é NULL pra
  -- agrupador). Pra demais tipos, NULL.
  case
    when i.tipo = 'receita' then i.venda_unitaria
    when i.tipo = 'servico_grupo' and i.quantidade_referencia > 0 then
      (i.venda_total_calc / i.quantidade_referencia)::numeric(18,4)
    else null
  end                           as venda_unitaria_item,
  i.venda_total_calc            as venda_total_item,
  s.codigo                      as servico_codigo,
  s.nome                        as servico_nome,
  s.unidade                     as unidade_servico,
  i.cpu_snapshot_id             as cpu_snapshot_id,
  snap.cpu_id_origem            as cpu_id_origem,
  snap.producao_diaria_qtde     as producao_diaria_qtde,
  snap.producao_diaria_unidade  as producao_diaria_unidade,
  snap.custo_unit               as custo_unit_snapshot,

  -- ─── Indiretos ────────────────────────────────────────────────────────
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

  -- Custo unificado: indireta usa cache, direta calcula custo × qtd
  case
    when i.indireto_id is not null then coalesce(pti.custo_total_calc, 0)::numeric(18,2)
    when snap.custo_unit is not null and t.quantidade_alocada is not null then
      (snap.custo_unit * t.quantidade_alocada)::numeric(18,2)
    else 0::numeric(18,2)
  end                           as custo_total_calc,

  -- Receita unificada: indireta usa cache, direta calcula via venda_unit
  -- derivada × quantidade_alocada (mesma fórmula que a Curva-S no front).
  case
    when i.indireto_id is not null then coalesce(pti.receita_total_calc, 0)::numeric(18,2)
    when i.tipo = 'servico_grupo' and i.quantidade_referencia > 0
         and t.quantidade_alocada is not null then
      ((i.venda_total_calc / i.quantidade_referencia) * t.quantidade_alocada)::numeric(18,2)
    when i.tipo = 'receita' and i.venda_unitaria is not null
         and t.quantidade_alocada is not null then
      (i.venda_unitaria * t.quantidade_alocada)::numeric(18,2)
    else 0::numeric(18,2)
  end                           as receita_total_calc,

  -- Custo de taxas (só indireta tem; direta retorna NULL)
  case
    when i.indireto_id is not null then pti.custo_taxas_calc
    else null
  end                           as custo_taxas_calc,

  -- Legado: custo_total_tarefa (mantido pra compat. retroativa, sempre direto)
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
