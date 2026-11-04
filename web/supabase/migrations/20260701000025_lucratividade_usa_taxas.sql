-- Lucratividade por item (serviços, receitas, etapas) passa a descontar a taxa
-- cadastrada na tela Taxas (encargos_sociais_regime vigente) — a mesma da tela
-- de Lucratividade. Antes usava obras.aliquota_* (padrões herdados, sem tela).

CREATE OR REPLACE FUNCTION public.recalcular_orcamento(_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  obra_aliquota   numeric(7,4);
  max_nivel       smallint;
  lvl             smallint;
  itens_total     int;
  custo_total     numeric(14,2);
  venda_total     numeric(14,2);
  lucr_global     numeric(7,4);
  inicio_ms       bigint;
begin
  inicio_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  perform pg_advisory_xact_lock(hashtext('orc:' || _obra_id::text));
  -- as escritas do próprio recálculo não marcam a obra de novo
  perform set_config('infrawork.recalc_em_curso', '1', true);

  -- impostos = taxa vigente cadastrada em Taxas (mesma regra de vw_orcamento_consolidado)
  select coalesce(total_perc_calc, 0)
    into obra_aliquota
    from public.encargos_sociais_regime
   where obra_id = _obra_id
     and ativo = true
     and (vigencia_inicio is null or vigencia_inicio <= current_date)
     and (vigencia_fim    is null or vigencia_fim    >= current_date)
   order by vigencia_inicio desc nulls last
   limit 1;
  obra_aliquota := coalesce(obra_aliquota, 0);

  -- 1) receitas: venda da linha
  update public.item_orcamentario
     set updated_at = now()
   where obra_id = _obra_id and tipo = 'receita';

  -- 2) frações do rateio
  perform public.fn_item_orc_aloc_recalcular(_obra_id);

  -- 3) serviços: quantidade (não-manual) e venda rateada; o trigger refaz o custo
  update public.item_orcamentario g
     set qtd_ref_modo = case
           when g.qtd_ref_modo = 'manual' then 'manual'
           when (select count(*) from public.item_orc_alocacao a
                  where a.grupo_id = g.id and a.compoe_qtd) = 1 then 'heranca'
           else 'soma_filhos'
         end,
         quantidade_referencia = case
           when g.qtd_ref_modo = 'manual' then g.quantidade_referencia
           else coalesce((select sum(r.quantidade * a.fracao)
                            from public.item_orc_alocacao a
                            join public.item_orcamentario r on r.id = a.receita_id
                           where a.grupo_id = g.id and a.compoe_qtd), 0)
         end,
         venda_total_calc = coalesce((select sum(r.venda_total_calc * a.fracao)
                                        from public.item_orc_alocacao a
                                        join public.item_orcamentario r on r.id = a.receita_id
                                       where a.grupo_id = g.id), 0),
         updated_at = now()
   where g.obra_id = _obra_id and g.tipo = 'servico_grupo';

  update public.item_orcamentario
     set lucratividade_perc_calc = case
       when venda_total_calc > 0 and custo_total_calc > 0 then
         (venda_total_calc - custo_total_calc - venda_total_calc * obra_aliquota) / venda_total_calc
       else null
     end
   where obra_id = _obra_id and tipo = 'servico_grupo';

  -- 4) apropriação do custo dos serviços nas receitas (pela venda alocada)
  update public.item_orcamentario r
     set custo_total_calc = coalesce((
           select sum(g.custo_total_calc * (r.venda_total_calc * a.fracao) / g.venda_total_calc)
             from public.item_orc_alocacao a
             join public.item_orcamentario g on g.id = a.grupo_id
            where a.receita_id = r.id and g.venda_total_calc > 0), 0)
   where r.obra_id = _obra_id and r.tipo = 'receita';

  update public.item_orcamentario
     set lucratividade_perc_calc = case
       when venda_total_calc > 0 and custo_total_calc > 0 then
         (venda_total_calc - custo_total_calc - venda_total_calc * obra_aliquota) / venda_total_calc
       else null
     end
   where obra_id = _obra_id and tipo = 'receita';

  -- 5) rollup das etapas (planilha de venda), do nível mais profundo até a raiz
  select coalesce(max(nivel), 0) into max_nivel
    from public.item_orcamentario
   where obra_id = _obra_id and tipo = 'etapa';

  lvl := max_nivel;
  while lvl >= 1 loop
    update public.item_orcamentario p
       set custo_total_calc = s.custo,
           venda_total_calc = s.venda,
           lucratividade_perc_calc = case when s.venda > 0 and s.custo > 0
             then (s.venda - s.custo - s.venda * obra_aliquota) / s.venda else null end,
           updated_at = now()
      from (select c.parent_id,
                   coalesce(sum(c.custo_total_calc), 0) as custo,
                   coalesce(sum(c.venda_total_calc), 0) as venda
              from public.item_orcamentario c
             where c.obra_id = _obra_id and c.parent_id is not null
             group by c.parent_id) s
     where p.id = s.parent_id
       and p.obra_id = _obra_id
       and p.tipo = 'etapa'
       and p.nivel = lvl;
    -- etapa sem filhos
    update public.item_orcamentario p
       set custo_total_calc = 0, venda_total_calc = 0, lucratividade_perc_calc = null
     where p.obra_id = _obra_id and p.tipo = 'etapa' and p.nivel = lvl
       and not exists (select 1 from public.item_orcamentario c where c.parent_id = p.id);
    lvl := lvl - 1;
  end loop;

  -- 6) totais: venda = planilha de venda; custo direto = serviços
  select count(*),
         coalesce(sum(custo_total_calc) filter (where tipo = 'servico_grupo'), 0),
         coalesce(sum(venda_total_calc) filter (where parent_id is null and tipo <> 'servico_grupo'), 0)
    into itens_total, custo_total, venda_total
    from public.item_orcamentario
   where obra_id = _obra_id;

  if venda_total > 0 then
    lucr_global := (venda_total - custo_total - venda_total * obra_aliquota) / venda_total;
  else
    lucr_global := null;
  end if;

  perform set_config('infrawork.recalc_em_curso', '', true);

  return jsonb_build_object(
    'ok', true,
    'itens_atualizados', itens_total,
    'custo_total',       custo_total,
    'venda_total',       venda_total,
    'lucratividade_global', lucr_global,
    'duracao_ms', ((extract(epoch from clock_timestamp()) * 1000)::bigint - inicio_ms)
  );
end
$function$;

-- mudou a taxa → recalcula a obra (uma vez, no fim da transação)
create or replace function public.fn_orc_marca_taxa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.fn_orc_marcar_recalculo(old.obra_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.fn_orc_marcar_recalculo(new.obra_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_orc_marca_taxa on public.encargos_sociais_regime;
create trigger trg_orc_marca_taxa
  after insert or update or delete on public.encargos_sociais_regime
  for each row execute function public.fn_orc_marca_taxa();

-- obras.aliquota_* não entram mais na conta
drop trigger if exists trg_orc_marca_obra on public.obras;

-- aplica a nova regra nas obras existentes
select public.recalcular_orcamento(id) from public.obras;
