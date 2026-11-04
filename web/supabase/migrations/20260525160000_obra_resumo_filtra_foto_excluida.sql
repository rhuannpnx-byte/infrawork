-- InfraWork — vw_acompanhamento_obra_resumo passa a filtrar fotos
-- excluida_em IS NULL nas 3 metricas: fotos_total, fotos_com_geo e
-- cobertura_fotografica_pct (dias_foto interno). Sem isso, fotos
-- soft-deletadas pelo god/adm continuam inflando a contagem do dashboard.

-- DROP porque a versao anterior tinha ordem de colunas diferente
-- (avanco_pct vinha antes); CREATE OR REPLACE nao permite reorder.
drop view if exists public.vw_acompanhamento_obra_resumo cascade;

create view public.vw_acompanhamento_obra_resumo
with (security_invoker = true)
as
select
  l.obra_id,
  l.siga_projeto_id,
  -- Avanço físico ponderado por custo (média ponderada de pct_avanco)
  (select round(
    coalesce(
      sum(coalesce(pr.qtd_real,0) * coalesce(io.venda_unitaria,0))
      / nullif(sum(coalesce(pr.qtd_plan,0) * coalesce(io.venda_unitaria,0)), 0),
      0
    )::numeric, 4)
   from public.vw_acompanhamento_previsto_x_realizado pr
   left join public.item_orcamentario io on io.id = pr.item_orcamentario_id
   where pr.obra_id = l.obra_id) as avanco_pct,
  -- Produção últimos 30 dias
  (select coalesce(sum(p.qtd), 0)
     from public.acompanhamento_producao p
    where p.obra_id = l.obra_id and p.data >= current_date - interval '30 days')      as producao_30d_qtd,
  (select count(*)
     from public.acompanhamento_producao p
    where p.obra_id = l.obra_id and p.data >= current_date - interval '30 days')      as producao_30d_registros,
  (select count(distinct data)
     from public.acompanhamento_producao p
    where p.obra_id = l.obra_id and p.data >= current_date - interval '30 days')      as dias_com_apontamento,
  -- Equipes na semana
  (select count(distinct equipe_nome)
     from public.acompanhamento_producao p
    where p.obra_id = l.obra_id and p.data = current_date)        as equipes_ativas_hoje,
  -- Equipes na última semana
  (select count(distinct equipe_nome)
     from public.acompanhamento_producao p
    where p.obra_id = l.obra_id and p.data >= current_date - interval '7 days') as equipes_ativas_semana,
  -- Fotos (somente nao excluidas)
  (select count(*) from public.acompanhamento_foto f
    where f.obra_id = l.obra_id and f.excluida_em is null) as fotos_total,
  (select count(*) from public.acompanhamento_foto f
    where f.obra_id = l.obra_id and f.lat is not null and f.excluida_em is null) as fotos_com_geo,
  -- Cobertura fotográfica últimos 30 dias (dias com >=1 foto / dias com apontamento)
  (with dias_prod as (
     select distinct data from public.acompanhamento_producao
      where obra_id = l.obra_id and data >= current_date - interval '30 days'),
   dias_foto as (
     select distinct (captured_at at time zone 'America/Sao_Paulo')::date as d
       from public.acompanhamento_foto
      where obra_id = l.obra_id
        and captured_at >= now() - interval '30 days'
        and excluida_em is null)
   select case when (select count(*) from dias_prod) = 0 then null
               else round(((select count(*) from dias_foto)::numeric
                           / (select count(*) from dias_prod))::numeric, 4)
          end)                                                    as cobertura_fotografica_pct,
  -- Alertas
  (select count(*) from public.acompanhamento_alerta a
    where a.obra_id = l.obra_id and a.status = 'aberto' and a.severidade = 'critical') as alertas_criticos,
  (select count(*) from public.acompanhamento_alerta a
    where a.obra_id = l.obra_id and a.status = 'aberto') as alertas_abertos_total,
  -- Sync
  l.ultimo_sync_em,
  l.ultimo_sync_status,
  l.siga_projeto_codigo,
  l.siga_projeto_nome
from public.obra_acompanhamento_link l
where l.ativo = true;

grant select on public.vw_acompanhamento_obra_resumo to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- vw_acompanhamento_producao_enriquecida: subquery fotos_count tambem
-- precisa ignorar fotos excluida_em IS NOT NULL.
-- ─────────────────────────────────────────────────────────────────────────
drop view if exists public.vw_acompanhamento_producao_enriquecida cascade;

create view public.vw_acompanhamento_producao_enriquecida
with (security_invoker = true)
as
select
  p.id                                                            as id,
  p.obra_id                                                       as obra_id,
  p.siga_producao_id                                              as siga_producao_id,
  p.data                                                          as data,
  p.servico_id                                                    as siga_servico_id,
  p.servico_nome                                                  as siga_servico_nome,
  p.encarregado_id                                                as siga_encarregado_id,
  p.encarregado_nome                                              as siga_encarregado_nome,
  p.equipe_id                                                     as siga_equipe_id,
  p.equipe_nome                                                   as siga_equipe_nome,
  p.qtd                                                           as qtd,
  p.qtd * coalesce(sm.fator_conversao, 1)                         as qtd_convertida,
  coalesce(sm.fator_conversao, 1)                                 as fator_conversao,
  p.siga_unidade_nome                                             as siga_unidade_nome,
  p.trecho                                                        as trecho,
  p.estaca_inicial                                                as estaca_inicial,
  p.estaca_final                                                  as estaca_final,
  p.obs                                                           as obs,
  p.frente                                                        as frente,
  p.siga_created_at                                               as siga_created_at,
  p.siga_updated_at                                               as siga_updated_at,
  p.sincronizado_em                                               as sincronizado_em,
  em.id                                                           as equipe_match_id,
  em.equipe_id                                                    as equipe_planejamento_id,
  coalesce(e.nome, p.equipe_nome)                                 as equipe_display_nome,
  coalesce(e.cor, '#94a3b8')                                      as equipe_display_cor,
  em.origem                                                       as equipe_match_origem,
  e.tipo                                                          as equipe_tipo,
  enm.id                                                          as encarregado_match_id,
  coalesce(enm.apelido_canonico, p.encarregado_nome)              as encarregado_display_nome,
  enm.origem                                                      as encarregado_match_origem,
  sm.id                                                           as servico_match_id,
  sm.servico_id                                                   as servico_planejamento_id,
  sm.item_orcamentario_id                                         as item_orcamentario_id,
  s.codigo                                                        as servico_codigo,
  s.nome                                                          as servico_display_nome,
  s.unidade                                                       as servico_unidade,
  coalesce(s.unidade, io.unidade_referencia)                      as unidade_plano,
  io.codigo                                                       as servico_grupo_codigo,
  io.descricao                                                    as servico_grupo_descricao,
  pt.id                                                           as tarefa_baseline_id,
  pt.data_inicio                                                  as tarefa_data_inicio,
  pt.data_fim                                                     as tarefa_data_fim,
  (select count(*) from public.acompanhamento_foto f
     where f.obra_id = p.obra_id
       and f.excluida_em is null
       and (f.producao_siga_id = p.siga_producao_id
            or (f.servico_executado_id = p.servico_id
                and f.captured_at::date between p.data - interval '1 day' and p.data + interval '1 day')))
                                                                  as fotos_count
from public.acompanhamento_producao p
left join public.acompanhamento_equipe_match em
       on em.obra_id = p.obra_id and em.siga_equipe_nome = p.equipe_nome
left join public.equipe e
       on e.id = em.equipe_id
left join public.acompanhamento_encarregado_match enm
       on enm.obra_id = p.obra_id and enm.siga_encarregado_nome = p.encarregado_nome
left join public.acompanhamento_servico_match sm
       on sm.obra_id = p.obra_id and sm.siga_servico_executado_id = p.servico_id
left join public.servico s
       on s.id = sm.servico_id
left join public.item_orcamentario io
       on io.id = sm.item_orcamentario_id
left join public.planejamento pl
       on pl.obra_id = p.obra_id and pl.is_baseline = true
left join public.planejamento_tarefa pt
       on pt.planejamento_id = pl.id and pt.item_orcamentario_id = sm.item_orcamentario_id;

grant select on public.vw_acompanhamento_producao_enriquecida to authenticated;
