-- InfraWork — Planejamento: vw_planejamento_tarefa_completa v3 (com trecho)
--
-- v3 muda em relacao a v2:
--   + JOIN obra_trecho tr ON tr.id = t.trecho_id  (INNER — trecho_id NOT NULL)
--   + Expoe trecho_id, trecho_nome, trecho_ordem
--   - Remove join com obras pra unidade_espaco_efetiva (fonte vira o trecho)
--   * unidade_espaco_efetiva = COALESCE(t.unidade_espaco_display, tr.unidade_espaco_padrao)
--
-- A coluna obras.unidade_espaco_padrao e dropada na proxima migration (120500).

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

  i.codigo                      as servico_grupo_codigo,
  i.descricao                   as servico_grupo_descricao,
  i.quantidade_referencia       as quantidade_referencia,
  i.servico_id                  as servico_id,
  s.codigo                      as servico_codigo,
  s.nome                        as servico_nome,
  s.unidade                     as unidade_servico,
  i.cpu_snapshot_id             as cpu_snapshot_id,
  snap.cpu_id_origem            as cpu_id_origem,
  snap.producao_diaria_qtde     as producao_diaria_qtde,
  snap.producao_diaria_unidade  as producao_diaria_unidade,
  snap.custo_unit               as custo_unit_snapshot,
  case
    when snap.custo_unit is not null and i.quantidade_referencia is not null
      then (snap.custo_unit * i.quantidade_referencia)::numeric(14, 2)
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
  -- Perfil semanal agregado (ordenado por semana_segunda asc)
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
join public.obra_trecho tr           on tr.id = t.trecho_id
join public.item_orcamentario i      on i.id = t.item_orcamentario_id
left join public.servico s           on s.id = i.servico_id
left join public.cpu_snapshot snap   on snap.id = i.cpu_snapshot_id;

grant select on public.vw_planejamento_tarefa_completa to authenticated;
