-- Dry-run: gera as rows que seriam inseridas em planejamento_tarefa_perfil_semana
-- pra cada tarefa do planejamento baseline atual. Não escreve nada.
--
-- Distribuição: uniforme. Quantidade_planejada = quantidade_referencia / num_semanas.
-- Soma das semanas == quantidade_referencia exato (uniform divide).
-- semana_segunda = date_trunc('week', data_inicio + n*7) — pega segunda ISO.

with dados as (
  select pt.id                                              as tarefa_id,
         pt.data_inicio,
         pt.data_fim,
         io.descricao,
         io.quantidade_referencia                           as qtd_ref,
         greatest(
           1,
           ((date_trunc('week', pt.data_fim)::date - date_trunc('week', pt.data_inicio)::date) / 7 + 1)::int
         )                                                  as num_semanas
    from planejamento_tarefa pt
    join planejamento p   on p.id = pt.planejamento_id
    join item_orcamentario io on io.id = pt.item_orcamentario_id
   where pt.data_inicio is not null
     and pt.data_fim is not null
     and io.quantidade_referencia is not null
     and io.quantidade_referencia > 0
     and pt.id not in (select tarefa_id from planejamento_tarefa_perfil_semana)
)
select tarefa_id,
       substring(descricao, 1, 40) as servico,
       data_inicio,
       data_fim,
       num_semanas,
       qtd_ref,
       round((qtd_ref / num_semanas)::numeric, 4) as qtd_por_semana,
       round((qtd_ref / num_semanas * num_semanas)::numeric, 4) as soma_calculada
  from dados
 order by tarefa_id;
