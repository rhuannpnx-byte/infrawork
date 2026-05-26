-- InfraWork — vw_acompanhamento_obra_resumo.avanco_pct: usar
-- venda_total_calc/quantidade_referencia como fallback quando
-- venda_unitaria nao estiver preenchida diretamente no item.
--
-- Motivo: planilhas comuns chegam com venda_total_calc + quantidade_referencia
-- preenchidos mas sem venda_unitaria. Com a formula antiga (`io.venda_unitaria`
-- direto), avanco_pct virava 0% no dashboard mesmo com producao real.

drop view if exists public.vw_acompanhamento_obra_resumo cascade;

create view public.vw_acompanhamento_obra_resumo
with (security_invoker = true)
as
select
  l.obra_id,
  l.siga_projeto_id,
  -- Avanço físico ponderado por valor de venda do item.
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
   left join public.item_orcamentario io on io.id = pr.item_orcamentario_id
   where pr.obra_id = l.obra_id) as avanco_pct,
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
