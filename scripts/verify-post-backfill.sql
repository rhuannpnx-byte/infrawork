-- Verifica estado pós-backfill:
--   1) Planejamento volta a ser baseline.
--   2) 8 tarefas têm perfil agregado.
--   3) Soma das semanas == quantidade_referencia pra cada (dentro tolerância).

select 'planejamento' as o, id, nome, is_baseline, status
  from planejamento;

select 'tarefa' as o,
       pt.id,
       substring(io.descricao, 1, 40) as servico,
       io.quantidade_referencia                            as qtd_ref,
       count(ps.semana_segunda)                            as n_semanas,
       coalesce(sum(ps.quantidade_planejada), 0)           as soma_perfil,
       round(
         coalesce(sum(ps.quantidade_planejada), 0) - io.quantidade_referencia,
         4
       )                                                   as delta,
       pt.usa_perfil_customizado,
       pt.perfil_default
  from planejamento_tarefa pt
  left join planejamento_tarefa_perfil_semana ps on ps.tarefa_id = pt.id
  join item_orcamentario io on io.id = pt.item_orcamentario_id
 group by pt.id, io.descricao, io.quantidade_referencia,
          pt.usa_perfil_customizado, pt.perfil_default
 order by pt.id;
