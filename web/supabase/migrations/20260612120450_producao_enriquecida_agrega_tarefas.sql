-- InfraWork — vw_acompanhamento_producao_enriquecida: para de duplicar
-- lançamentos quando um item_orcamentario está dividido em várias tarefas
-- da baseline.
--
-- Antes: LEFT JOIN direto em planejamento_tarefa por (planejamento_id,
-- item_orcamentario_id) gerava 1 linha por tarefa. Como o mesmo item pode
-- aparecer em N tarefas da baseline, cada lançamento de produção era
-- multiplicado por N (na prod: 98 lançamentos viravam 132 linhas).
--
-- Agora: agregamos as tarefas por (planejamento_id, item_orcamentario_id) —
-- MIN(data_inicio) / MAX(data_fim), mesmo padrão usado no previsto x
-- realizado — devolvendo 1 linha por lançamento. tarefa_baseline_id passa a
-- ser a tarefa representativa (a de início mais cedo) para manter o
-- indicador "tem tarefa baseline? Sim/Não".
--
-- create or replace: colunas (nome/ordem/tipo) idênticas à versão anterior,
-- então preserva dependências sem precisar de drop cascade.

create or replace view public.vw_acompanhamento_producao_enriquecida
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
  pta.tarefa_id                                                   as tarefa_baseline_id,
  pta.data_inicio                                                 as tarefa_data_inicio,
  pta.data_fim                                                    as tarefa_data_fim,
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
-- Agrega as tarefas da baseline por item (1 linha por item, não por tarefa)
left join (
  select
    pt.planejamento_id,
    pt.item_orcamentario_id,
    min(pt.data_inicio)                                            as data_inicio,
    max(pt.data_fim)                                               as data_fim,
    (array_agg(pt.id order by pt.data_inicio asc nulls last))[1]   as tarefa_id
  from public.planejamento_tarefa pt
  where pt.item_orcamentario_id is not null
  group by pt.planejamento_id, pt.item_orcamentario_id
) pta
       on pta.planejamento_id = pl.id and pta.item_orcamentario_id = sm.item_orcamentario_id;

grant select on public.vw_acompanhamento_producao_enriquecida to authenticated;
