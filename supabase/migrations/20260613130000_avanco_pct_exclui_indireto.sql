-- InfraWork — vw_acompanhamento_obra_resumo.avanco_pct: avanço FÍSICO
-- ponderado por RECEITA, excluindo itens INDIRETOS.
--
-- Bugs corrigidos:
--  1) Itens indiretos (indireto_id not null — ex.: "Administração Central")
--     entravam no DENOMINADOR com sua receita planejada (≈ R$ 12M numa obra
--     real), mas seu qtd_real é sempre 0 (overhead não tem produção física
--     apontada). Isso puxava o "avanço físico" para baixo permanentemente e
--     impedia que ele chegasse a 100% (ex.: 7,78% com indireto vs 12,46% só
--     com os serviços diretos). Avanço FÍSICO deve medir só execução física.
--  2) O peso já era a RECEITA do item (venda_unitaria, com fallback
--     venda_total_calc/quantidade_referencia) — mantido. (O rótulo na UI dizia
--     "ponderado por custo"; corrigido no app para "ponderado por receita".)
--
-- Fix: filtrar `io.indireto_id is null` na soma do avanco_pct. Demais colunas
-- inalteradas → create or replace (sem cascade).

create or replace view public.vw_acompanhamento_obra_resumo
with (security_invoker = true)
as
select
  l.obra_id,
  l.siga_projeto_id,
  -- Avanço físico ponderado pela RECEITA do item, SÓ serviços diretos.
  -- preco_unit = coalesce(venda_unitaria, venda_total_calc / quantidade_referencia).
  (select round(
    coalesce(
      sum(coalesce(pr.qtd_real,0) * coalesce(
            io.venda_unitaria,
            io.venda_total_calc / nullif(io.quantidade_referencia, 0),
            0))
      / nullif(sum(coalesce(pr.qtd_plan,0) * coalesce(
            io.venda_unitaria,
            io.venda_total_calc / nullif(io.quantidade_referencia, 0),
            0)), 0),
      0
    )::numeric, 4)
   from public.vw_acompanhamento_previsto_x_realizado pr
   join public.item_orcamentario io on io.id = pr.item_orcamentario_id
   where pr.obra_id = l.obra_id
     and io.indireto_id is null) as avanco_pct,
  (select coalesce(sum(p.qtd), 0)
     from public.acompanhamento_producao p
    where p.obra_id = l.obra_id and p.data >= current_date - interval '30 days')      as producao_30d_qtd,
  (select count(*)
     from public.acompanhamento_producao p
    where p.obra_id = l.obra_id and p.data >= current_date - interval '30 days')      as producao_30d_registros,
  (select count(distinct data)
     from public.acompanhamento_producao p
    where p.obra_id = l.obra_id and p.data >= current_date - interval '30 days')      as dias_com_apontamento,
  (select count(distinct equipe_nome)
     from public.acompanhamento_producao p
    where p.obra_id = l.obra_id and p.data = current_date)        as equipes_ativas_hoje,
  (select count(distinct equipe_nome)
     from public.acompanhamento_producao p
    where p.obra_id = l.obra_id and p.data >= current_date - interval '7 days') as equipes_ativas_semana,
  (select count(*) from public.acompanhamento_foto f
    where f.obra_id = l.obra_id and f.excluida_em is null) as fotos_total,
  (select count(*) from public.acompanhamento_foto f
    where f.obra_id = l.obra_id and f.lat is not null and f.excluida_em is null) as fotos_com_geo,
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
  (select count(*) from public.acompanhamento_alerta a
    where a.obra_id = l.obra_id and a.status = 'aberto' and a.severidade = 'critical') as alertas_criticos,
  (select count(*) from public.acompanhamento_alerta a
    where a.obra_id = l.obra_id and a.status = 'aberto') as alertas_abertos_total,
  l.ultimo_sync_em,
  l.ultimo_sync_status,
  l.siga_projeto_codigo,
  l.siga_projeto_nome
from public.obra_acompanhamento_link l
where l.ativo = true;

grant select on public.vw_acompanhamento_obra_resumo to authenticated;
