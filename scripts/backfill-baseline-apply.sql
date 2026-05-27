-- BACKFILL ad-hoc das 8 tarefas do planejamento baseline em prod.
--
-- Estratégia: flip temporário is_baseline true→false em UMA transação,
-- INSERT perfis uniformes, flip back true. Triggers normais aceitam o INSERT
-- (vêem is_baseline=false). Constraint trigger DEFERRED valida soma no commit.
--
-- Como é uniforme exato (qtd_ref / num_semanas pra todas as semanas), soma bate.

begin;

-- Step 1: flip baseline → false. Trigger fn_planejamento_baseline_unica só
-- dispara em false→true (não vai mexer em outras). updated_at touch é OK.
update planejamento
   set is_baseline = false
 where id = '0696a809-c6cc-4526-b106-94a6839ba81b'
   and is_baseline = true;

-- Step 2: INSERT perfis uniformes pras tarefas sem perfil ainda.
with dados as (
  select pt.id                                              as tarefa_id,
         pt.data_inicio,
         io.quantidade_referencia                           as qtd_ref,
         greatest(
           1,
           ((date_trunc('week', pt.data_fim)::date - date_trunc('week', pt.data_inicio)::date) / 7 + 1)::int
         )                                                  as num_semanas
    from planejamento_tarefa pt
    join planejamento p   on p.id = pt.planejamento_id
    join item_orcamentario io on io.id = pt.item_orcamentario_id
   where p.id = '0696a809-c6cc-4526-b106-94a6839ba81b'
     and pt.data_inicio is not null
     and pt.data_fim is not null
     and io.quantidade_referencia is not null
     and io.quantidade_referencia > 0
     and pt.id not in (select tarefa_id from planejamento_tarefa_perfil_semana)
)
insert into planejamento_tarefa_perfil_semana (tarefa_id, semana_segunda, quantidade_planejada)
select d.tarefa_id,
       (date_trunc('week', d.data_inicio)::date + (n * 7))::date as semana_segunda,
       d.qtd_ref / d.num_semanas                                  as quantidade_planejada
  from dados d
       cross join lateral generate_series(0, d.num_semanas - 1) as n;

-- Step 3: flip baseline → true. Trigger fn_planejamento_baseline_unica
-- desmarca outras baselines da mesma obra — sem efeito (só temos 1).
update planejamento
   set is_baseline = true
 where id = '0696a809-c6cc-4526-b106-94a6839ba81b'
   and is_baseline = false;

-- DEFERRED constraint trg_ptps_validar_soma roda no commit. Se soma divergir
-- de qtd_referencia além de 0.1%, transação aborta inteira e nada muda.

commit;

-- Verificação pós-commit
select count(*) as total_rows_inseridas from planejamento_tarefa_perfil_semana;
