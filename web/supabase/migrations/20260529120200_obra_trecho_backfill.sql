-- InfraWork — Backfill: 1 trecho default por obra + planejamento_tarefa.trecho_id
--
-- Estrategia:
--   1) Pra cada obra sem trecho, cria 'Principal' herdando obras.unidade_espaco_padrao.
--   2) Pra cada tarefa sem trecho_id, aponta pro trecho de menor ordem da sua obra.
--
-- Idempotente: re-rodar nao duplica trechos (uq_obra_trecho_obra_nome) e nao
-- mexe em tarefas que ja tem trecho.

-- 1) Trecho default por obra
insert into public.obra_trecho (obra_id, nome, ordem, unidade_espaco_padrao)
select o.id, 'Principal', 0, o.unidade_espaco_padrao
  from public.obras o
 where not exists (
   select 1 from public.obra_trecho t where t.obra_id = o.id
 )
on conflict (obra_id, nome) do nothing;

-- 2) planejamento_tarefa.trecho_id = primeiro trecho (menor ordem) da obra
-- Nao precisa session_replication_role: trecho_id ainda nao esta na whitelist
-- do trg_baseline_imutavel_tarefa (adicionado em migration sibling apos backfill).
update public.planejamento_tarefa pt
   set trecho_id = sub.trecho_id
  from (
    select pt2.id as tarefa_id,
           (select t.id
              from public.obra_trecho t
              join public.planejamento p on p.obra_id = t.obra_id
             where p.id = pt2.planejamento_id
             order by t.ordem asc, t.created_at asc
             limit 1) as trecho_id
      from public.planejamento_tarefa pt2
     where pt2.trecho_id is null
  ) sub
 where pt.id = sub.tarefa_id
   and sub.trecho_id is not null;
