-- InfraWork Web — Cadeia ao vivo: recurso → composição → serviço → orçamento.
--
-- Sem snapshot de CPU: o custo e a produção/dia do serviço do orçamento vêm
-- AO VIVO da composição (vw_servico_vivo). Toda alteração que mexe em valores
-- do orçamento marca a obra para recálculo; o recálculo roda UMA vez por obra
-- no fim da transação (constraint trigger adiada) — os botões manuais
-- ("Recalcular", "Atualizar CPUs vigentes", "Reaplicar") deixam de existir.
-- As linhas de base guardam as próprias premissas (fase 2); a cadeia viva só
-- alimenta o orçamento e o plano em edição.

-- ─── 1. Serviço ao vivo ─────────────────────────────────────────────────────
-- Modo agregador (servico_cpu_link): Σ custo das CPUs ÷|× fator; produção =
-- override do serviço ou a da 1ª CPU. Modo legado: CPU vigente do serviço.
create or replace view public.vw_servico_vivo with (security_invoker = true) as
with lk as (
  select l.servico_id, l.ordem, l.cpu_id, c.producao_diaria_qtde, c.producao_diaria_unidade,
         case when l.fator is null or l.fator = 0 then 0::numeric
              when l.operacao = 'multiplicar' then l.fator else 1 / l.fator end as k,
         c.custo_unit_calc, c.custo_eq_dia_calc, c.custo_comb_dia_calc, c.custo_mo_dia_calc, c.custo_mat_dia_calc
    from public.servico_cpu_link l
    join public.cpu c on c.id = l.cpu_id
), agg as (
  select servico_id, count(*) as n,
         sum(custo_unit_calc * k) as custo_unit,
         sum(custo_eq_dia_calc * k) as eq, sum(custo_comb_dia_calc * k) as comb,
         sum(custo_mo_dia_calc * k) as mo, sum(custo_mat_dia_calc * k) as mat,
         (array_agg(producao_diaria_qtde order by ordem, cpu_id))[1] as prod,
         (array_agg(producao_diaria_unidade order by ordem, cpu_id))[1] as prod_un,
         (array_agg(cpu_id order by ordem, cpu_id))[1] as cpu1
    from lk group by servico_id
)
select s.id as servico_id,
       s.obra_id,
       coalesce(agg.cpu1, cv.id) as cpu_id,
       (case when agg.n > 0 then agg.custo_unit else cv.custo_unit_calc end)::numeric(14,4) as custo_unit,
       (case when agg.n > 0 then coalesce(s.producao_diaria_qtde, agg.prod)
             else cv.producao_diaria_qtde end)::numeric(14,4) as producao_diaria_qtde,
       case when agg.n > 0 then coalesce(s.producao_diaria_unidade, agg.prod_un, 'DIA')
            else cv.producao_diaria_unidade end as producao_diaria_unidade,
       (case when agg.n > 0 then agg.eq else cv.custo_eq_dia_calc end)::numeric(14,4) as custo_eq_dia,
       (case when agg.n > 0 then agg.comb else cv.custo_comb_dia_calc end)::numeric(14,4) as custo_comb_dia,
       (case when agg.n > 0 then agg.mo else cv.custo_mo_dia_calc end)::numeric(14,4) as custo_mo_dia,
       (case when agg.n > 0 then agg.mat else cv.custo_mat_dia_calc end)::numeric(14,4) as custo_mat_dia,
       case when agg.n > 0 then 'agregador' else 'legado' end as modo
  from public.servico s
  left join agg on agg.servico_id = s.id
  left join public.cpu cv on cv.servico_id = s.id and cv.is_vigente and coalesce(agg.n, 0) = 0;

grant select on public.vw_servico_vivo to authenticated, service_role;

create or replace function public.servico_custo_unit(_servico_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$ select custo_unit from public.vw_servico_vivo where servico_id = _servico_id $$;

-- ─── 2. Linha do orçamento: custo do serviço ao vivo ───────────────────────
create or replace function public.fn_item_orc_linha_calc()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  ind_valor numeric(14,2);
begin
  new.updated_at := now();

  if new.tipo = 'receita' then
    new.custo_unitario_calc := null;
    new.venda_total_calc    := coalesce(new.quantidade, 0) * coalesce(new.venda_unitaria, 0);
    -- custo_total_calc/lucratividade: apropriados por recalcular_orcamento
    if tg_op = 'INSERT' then
      new.custo_total_calc        := 0;
      new.lucratividade_perc_calc := null;
    end if;
  elsif new.tipo = 'servico_grupo' then
    new.cpu_snapshot_id := null;
    if new.indireto_id is not null then
      select valor_total into ind_valor from public.indireto_item where id = new.indireto_id;
      new.custo_unitario_calc := coalesce(ind_valor, 0);
    elsif new.servico_id is not null then
      new.custo_unitario_calc := coalesce(public.servico_custo_unit(new.servico_id), 0);
    else
      new.custo_unitario_calc := 0;
    end if;
    new.custo_total_calc := coalesce(new.quantidade_referencia, 0) * new.custo_unitario_calc;
    -- venda_total_calc e lucratividade_perc_calc: recalcular_orcamento
  else
    new.custo_unitario_calc := null;
  end if;

  return new;
end
$$;

-- ─── 3. Recálculo automático (uma vez por obra, no fim da transação) ───────
create table if not exists public.orcamento_recalculo_pendente (
  obra_id uuid primary key,
  marcado_em timestamptz not null default now()
);
alter table public.orcamento_recalculo_pendente enable row level security;
revoke all on public.orcamento_recalculo_pendente from anon, authenticated;

create or replace function public.fn_orc_marcar_recalculo(_obra_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if _obra_id is null or coalesce(current_setting('infrawork.recalc_em_curso', true), '') = '1' then
    return;
  end if;
  insert into public.orcamento_recalculo_pendente (obra_id) values (_obra_id)
  on conflict (obra_id) do nothing;
end $$;

create or replace function public.fn_orc_recalculo_executar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.orcamento_recalculo_pendente where obra_id = new.obra_id) then
    return null;
  end if;
  delete from public.orcamento_recalculo_pendente where obra_id = new.obra_id;
  if exists (select 1 from public.obras where id = new.obra_id) then
    perform set_config('infrawork.recalc_em_curso', '1', true);
    perform public.recalcular_orcamento(new.obra_id);
    perform set_config('infrawork.recalc_em_curso', '', true);
  end if;
  return null;
end $$;

drop trigger if exists trg_orc_recalculo_executar on public.orcamento_recalculo_pendente;
create constraint trigger trg_orc_recalculo_executar
  after insert on public.orcamento_recalculo_pendente
  deferrable initially deferred
  for each row execute function public.fn_orc_recalculo_executar();

-- recalcular_orcamento chamado direto (RPC) também não deve re-marcar
create or replace function public.fn_orc_marca_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_orc_marcar_recalculo(coalesce(new.obra_id, old.obra_id));
  return null;
end $$;

drop trigger if exists trg_orc_marca_item on public.item_orcamentario;
create trigger trg_orc_marca_item
  after insert or delete or update of quantidade, venda_unitaria, parent_id, tipo, qtd_ref_modo,
    quantidade_referencia, servico_id, indireto_id
  on public.item_orcamentario
  for each row execute function public.fn_orc_marca_item();

drop trigger if exists trg_orc_marca_alocacao on public.item_orc_alocacao;
create trigger trg_orc_marca_alocacao
  after insert or delete or update on public.item_orc_alocacao
  for each row execute function public.fn_orc_marca_item();

drop trigger if exists trg_orc_marca_indireto on public.indireto_item;
create trigger trg_orc_marca_indireto
  after insert or delete or update of valor_total, distribuicao_perc on public.indireto_item
  for each row execute function public.fn_orc_marca_item();

create or replace function public.fn_orc_marca_cpu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.custo_unit_calc is not distinct from old.custo_unit_calc
     and new.producao_diaria_qtde is not distinct from old.producao_diaria_qtde
     and new.is_vigente is not distinct from old.is_vigente then
    return null;
  end if;
  perform public.fn_orc_marcar_recalculo(coalesce(new.obra_id, old.obra_id));
  return null;
end $$;

drop trigger if exists trg_orc_marca_cpu on public.cpu;
create trigger trg_orc_marca_cpu
  after insert or delete or update on public.cpu
  for each row execute function public.fn_orc_marca_cpu();

create or replace function public.fn_orc_marca_servico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_orc_marcar_recalculo(
    (select obra_id from public.servico where id = coalesce(new.servico_id, old.servico_id)));
  return null;
end $$;

drop trigger if exists trg_orc_marca_link on public.servico_cpu_link;
create trigger trg_orc_marca_link
  after insert or delete or update on public.servico_cpu_link
  for each row execute function public.fn_orc_marca_servico();

create or replace function public.fn_orc_marca_servico_prod()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_orc_marcar_recalculo(new.obra_id);
  return null;
end $$;

drop trigger if exists trg_orc_marca_servico_prod on public.servico;
create trigger trg_orc_marca_servico_prod
  after update of producao_diaria_qtde, producao_diaria_unidade on public.servico
  for each row execute function public.fn_orc_marca_servico_prod();

create or replace function public.fn_orc_marca_obra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_orc_marcar_recalculo(new.id);
  return null;
end $$;

drop trigger if exists trg_orc_marca_obra on public.obras;
create trigger trg_orc_marca_obra
  after update of aliquota_iss_perc, aliquota_pis_perc, aliquota_cofins_perc, aliquota_outros_perc
  on public.obras
  for each row execute function public.fn_orc_marca_obra();

-- ─── Composição: correções de propagação interna ───────────────────────────
-- Nova vigente repõe os vínculos de serviço composto que apontavam para outra
-- versão do mesmo serviço.
create or replace function public.fn_cpu_demarcar_outras()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.is_vigente = true and new.servico_id is not null then
    update public.cpu
       set is_vigente = false
     where servico_id = new.servico_id
       and id <> new.id
       and is_vigente = true;
    update public.servico_cpu_link l
       set cpu_id = new.id
      from public.cpu c
     where l.cpu_id = c.id and c.servico_id = new.servico_id and c.id <> new.id;
  end if;
  return new;
end
$$;

-- Produção/dia mudou → materiais por consumo (consumo × produção × preço)
-- precisam ser refeitos antes de somar.
create or replace function public.fn_cpu_producao_changed()
returns trigger
language plpgsql
as $$
begin
  if new.producao_diaria_qtde is distinct from old.producao_diaria_qtde then
    update public.cpu_item set updated_at = now()
     where cpu_id = new.id and grupo = 'MATERIAL' and consumo_material_por_unid is not null;
    perform public.fn_cpu_recalc(new.id);
  end if;
  return new;
end
$$;

-- Equipamento mudou → combustível automático (quantidade 0) é refeito.
create or replace function public.fn_cpu_item_propagate()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'DELETE' and new.grupo = 'EQUIPAMENTO' or tg_op = 'DELETE' and old.grupo = 'EQUIPAMENTO' then
    update public.cpu_item set updated_at = now()
     where cpu_id = coalesce(new.cpu_id, old.cpu_id) and grupo = 'COMBUSTIVEL'
       and coalesce(quantidade, 0) = 0;
  end if;
  if tg_op = 'DELETE' then
    perform public.fn_cpu_recalc(old.cpu_id);
    return old;
  end if;
  perform public.fn_cpu_recalc(new.cpu_id);
  return new;
end
$$;

-- ─── recalcular_orcamento: não se re-marca ─────────────────────────────────
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

  select coalesce(aliquota_iss_perc, 0) + coalesce(aliquota_pis_perc, 0)
       + coalesce(aliquota_cofins_perc, 0) + coalesce(aliquota_outros_perc, 0)
    into obra_aliquota
    from public.obras where id = _obra_id;

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

-- ─── 4. Views: snapshot → serviço ao vivo ───────────────────────────────────
create or replace view public.vw_planejamento_tarefa_completa with (security_invoker = true) as
SELECT t.id,
    t.planejamento_id,
    t.item_orcamentario_id,
    t.data_inicio,
    t.data_fim,
    t.duracao_dias_uteis_calc,
    t.data_inicio_manual,
    t.notas,
    t.ordem,
    t.created_at,
    t.updated_at,
    t.tipo_no,
    t.parent_id,
    t.nivel,
    t.codigo_eap,
    t.nome_custom,
    t.quantidade_alocada,
    t.early_start,
    t.early_finish,
    t.late_start,
    t.late_finish,
    t.total_float,
    t.free_float,
    t.is_critico,
    t.schedule_mode,
    t.constraint_type,
    t.constraint_date,
    p.obra_id,
    p.is_baseline,
    p.status AS planejamento_status,
    p.data_date AS planejamento_data_date,
    i.codigo AS servico_grupo_codigo,
    i.descricao AS servico_grupo_descricao,
    i.quantidade_referencia,
    i.servico_id,
    i.indireto_id,
    i.unidade_referencia AS unidade_referencia_item,
    i.custo_unitario_calc AS custo_unitario_item,
        CASE
            WHEN i.tipo = 'receita'::text THEN i.venda_unitaria
            WHEN i.tipo = 'servico_grupo'::text AND i.quantidade_referencia > 0::numeric THEN (i.venda_total_calc / i.quantidade_referencia)::numeric(18,4)
            ELSE NULL::numeric
        END AS venda_unitaria_item,
    i.venda_total_calc AS venda_total_item,
    s.codigo AS servico_codigo,
    s.nome AS servico_nome,
    s.unidade AS unidade_servico,
    i.cpu_snapshot_id,
    snap.cpu_id AS cpu_id_origem,
    snap.producao_diaria_qtde,
    snap.producao_diaria_unidade,
    snap.custo_unit AS custo_unit_snapshot,
    COALESCE(( SELECT sum(COALESCE(pte.producao_diaria_override, ep.producao_diaria, snap.producao_diaria_qtde) * GREATEST(1, pte.qtd_equipes::integer)::numeric) AS sum
           FROM planejamento_tarefa_equipe pte
             LEFT JOIN equipe_produtividade ep ON ep.equipe_id = pte.equipe_id AND ep.servico_id = i.servico_id
          WHERE pte.tarefa_id = t.id), snap.producao_diaria_qtde) AS producao_diaria_efetiva,
    i.indireto_id IS NOT NULL AS is_indireto,
        CASE
            WHEN i.indireto_id IS NOT NULL AND pti.tarefa_id IS NOT NULL THEN jsonb_build_object('custo_periodicidade', pti.custo_periodicidade, 'custo_unitario', pti.custo_unitario, 'receita_modo', pti.receita_modo, 'receita_unitaria', pti.receita_unitaria, 'receita_percentual', pti.receita_percentual, 'offset_dias_antes', pti.offset_dias_antes, 'offset_dias_depois', pti.offset_dias_depois, 'receita_extrapola', pti.receita_extrapola, 'aplica_taxas', pti.aplica_taxas, 'taxa_regime_id', pti.taxa_regime_id, 'periodos_calc', pti.periodos_calc)
            ELSE NULL::jsonb
        END AS indireto_config,
        CASE
            WHEN i.indireto_id IS NOT NULL THEN COALESCE(pti.custo_total_calc, 0::numeric)::numeric(18,2)
            WHEN snap.custo_unit IS NOT NULL AND t.quantidade_alocada IS NOT NULL THEN (snap.custo_unit * t.quantidade_alocada)::numeric(18,2)
            ELSE 0::numeric(18,2)
        END AS custo_total_calc,
        CASE
            WHEN i.indireto_id IS NOT NULL THEN COALESCE(pti.receita_total_calc, 0::numeric)::numeric(18,2)
            WHEN i.tipo = 'servico_grupo'::text AND i.quantidade_referencia > 0::numeric AND t.quantidade_alocada IS NOT NULL THEN (i.venda_total_calc / i.quantidade_referencia * t.quantidade_alocada)::numeric(18,2)
            WHEN i.tipo = 'receita'::text AND i.venda_unitaria IS NOT NULL AND t.quantidade_alocada IS NOT NULL THEN (i.venda_unitaria * t.quantidade_alocada)::numeric(18,2)
            ELSE 0::numeric(18,2)
        END AS receita_total_calc,
        CASE
            WHEN i.indireto_id IS NOT NULL THEN pti.custo_taxas_calc
            ELSE NULL::numeric
        END AS custo_taxas_calc,
        CASE
            WHEN snap.custo_unit IS NOT NULL AND t.quantidade_alocada IS NOT NULL THEN (snap.custo_unit * t.quantidade_alocada)::numeric(14,2)
            ELSE 0::numeric(14,2)
        END AS custo_total_tarefa,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'cor', e.cor, 'tipo', e.tipo, 'ordem', e.ordem, 'qtd_equipes', pte.qtd_equipes, 'producao_diaria_override', pte.producao_diaria_override, 'producao_diaria_equipe', ep.producao_diaria, 'producao_diaria_efetiva', COALESCE(pte.producao_diaria_override, ep.producao_diaria, snap.producao_diaria_qtde) * GREATEST(1, pte.qtd_equipes::integer)::numeric) ORDER BY e.ordem, e.nome) AS jsonb_agg
           FROM planejamento_tarefa_equipe pte
             JOIN equipe e ON e.id = pte.equipe_id
             LEFT JOIN equipe_produtividade ep ON ep.equipe_id = pte.equipe_id AND ep.servico_id = i.servico_id
          WHERE pte.tarefa_id = t.id), '[]'::jsonb) AS equipes,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', d.id, 'predecessora_id', d.predecessora_id, 'tipo', d.tipo, 'lag_dias', d.lag_dias, 'origem', d.origem)) AS jsonb_agg
           FROM planejamento_dependencia d
          WHERE d.sucessora_id = t.id), '[]'::jsonb) AS predecessoras,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', d.id, 'sucessora_id', d.sucessora_id, 'tipo', d.tipo, 'lag_dias', d.lag_dias, 'origem', d.origem)) AS jsonb_agg
           FROM planejamento_dependencia d
          WHERE d.predecessora_id = t.id), '[]'::jsonb) AS sucessoras,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('semana_segunda', ps.semana_segunda, 'quantidade_planejada', ps.quantidade_planejada) ORDER BY ps.semana_segunda) AS jsonb_agg
           FROM planejamento_tarefa_perfil_semana ps
          WHERE ps.tarefa_id = t.id), '[]'::jsonb) AS perfil_semanas
   FROM planejamento_tarefa t
     JOIN planejamento p ON p.id = t.planejamento_id
     LEFT JOIN item_orcamentario i ON i.id = t.item_orcamentario_id
     LEFT JOIN servico s ON s.id = i.servico_id
     LEFT JOIN vw_servico_vivo snap ON snap.servico_id = i.servico_id
     LEFT JOIN planejamento_tarefa_indireto pti ON pti.tarefa_id = t.id;

create or replace view public.vw_acompanhamento_previsto_x_realizado with (security_invoker = true) as
WITH baseline AS (
         SELECT pl.obra_id,
            min(pt.id::text)::uuid AS tarefa_id,
            pt.item_orcamentario_id AS item_id,
            min(pt.data_inicio) AS data_inicio,
            max(pt.data_fim) AS data_fim,
            io.codigo AS servico_grupo_codigo,
            io.descricao AS servico_grupo_descricao,
            sum(pt.quantidade_alocada)::numeric(14,4) AS quantidade_planejada,
            io.unidade_referencia AS unidade,
            snap.producao_diaria_qtde AS producao_diaria_cpu,
                CASE
                    WHEN COALESCE(sum(pt.duracao_dias_uteis_calc), 0::numeric) > 0::numeric THEN (sum(pt.quantidade_alocada) / sum(pt.duracao_dias_uteis_calc))::numeric(14,4)
                    ELSE NULL::numeric
                END AS producao_diaria_plan
           FROM planejamento pl
             JOIN planejamento_tarefa pt ON pt.planejamento_id = pl.id
             JOIN item_orcamentario io ON io.id = pt.item_orcamentario_id
             LEFT JOIN vw_servico_vivo snap ON snap.servico_id = io.servico_id
          WHERE pl.is_baseline = true AND io.indireto_id IS NULL
          GROUP BY pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao, io.unidade_referencia, snap.producao_diaria_qtde
        ), plan_periodo AS (
         SELECT pl.obra_id,
            pt.item_orcamentario_id AS item_id,
            sum(ps.quantidade_planejada / 5.0 * LEAST(5, GREATEST(0, CURRENT_DATE - ps.semana_segunda + 1))::numeric)::numeric(14,4) AS qtd_plan_periodo
           FROM planejamento pl
             JOIN planejamento_tarefa pt ON pt.planejamento_id = pl.id
             JOIN planejamento_tarefa_perfil_semana ps ON ps.tarefa_id = pt.id
          WHERE pl.is_baseline = true
          GROUP BY pl.obra_id, pt.item_orcamentario_id
        ), realizado AS (
         SELECT p.obra_id,
            p.item_orcamentario_id AS item_id,
            sum(p.quantidade * p.fator_conversao) AS quantidade_realizada,
            count(DISTINCT p.data) AS dias_realizado,
            min(p.data) AS data_primeira,
            max(p.data) AS data_ultima
           FROM acompanhamento_producao p
          WHERE p.item_orcamentario_id IS NOT NULL
          GROUP BY p.obra_id, p.item_orcamentario_id
        )
 SELECT b.obra_id,
    b.tarefa_id,
    b.item_id AS item_orcamentario_id,
    b.servico_grupo_codigo AS codigo,
    b.servico_grupo_descricao AS descricao,
    b.unidade,
    b.quantidade_planejada AS qtd_plan,
    COALESCE(r.quantidade_realizada, 0::numeric) AS qtd_real,
        CASE
            WHEN b.quantidade_planejada IS NULL OR b.quantidade_planejada = 0::numeric THEN NULL::numeric
            ELSE round(COALESCE(r.quantidade_realizada, 0::numeric) / b.quantidade_planejada, 4)
        END AS pct_avanco,
    b.data_inicio AS data_inicio_plan,
    b.data_fim AS data_fim_plan,
        CASE
            WHEN b.data_fim IS NULL OR b.data_inicio IS NULL THEN NULL::integer
            ELSE GREATEST(1, b.data_fim - b.data_inicio + 1)
        END AS dias_plan,
    r.dias_realizado AS dias_real,
    r.data_primeira AS data_primeira_realizacao,
    r.data_ultima AS data_ultima_realizacao,
        CASE
            WHEN b.quantidade_planejada IS NULL OR b.quantidade_planejada = 0::numeric THEN NULL::numeric
            ELSE LEAST(1::numeric, round(COALESCE(pp.qtd_plan_periodo, 0::numeric) / b.quantidade_planejada, 4))
        END AS pct_esperado_hoje,
        CASE
            WHEN b.data_fim IS NULL THEN NULL::integer
            WHEN r.data_ultima IS NULL THEN NULL::integer
            WHEN COALESCE(b.producao_diaria_plan, b.producao_diaria_cpu) IS NULL OR COALESCE(b.producao_diaria_plan, b.producao_diaria_cpu) = 0::numeric THEN NULL::integer
            ELSE b.data_fim - (r.data_ultima + ceil(GREATEST(0::numeric, b.quantidade_planejada - COALESCE(r.quantidade_realizada, 0::numeric)) / COALESCE(b.producao_diaria_plan, b.producao_diaria_cpu))::integer)
        END AS desvio_dias_estimado,
        CASE
            WHEN b.quantidade_planejada IS NULL THEN 'sem_plano'::text
            WHEN r.quantidade_realizada IS NULL THEN 'nao_iniciado'::text
            WHEN r.quantidade_realizada >= b.quantidade_planejada THEN 'concluido'::text
            WHEN b.data_inicio IS NULL OR b.data_fim IS NULL THEN 'em_andamento'::text
            WHEN CURRENT_DATE > b.data_fim THEN 'atrasado'::text
            WHEN COALESCE(pp.qtd_plan_periodo, 0::numeric) <= 0::numeric THEN 'em_andamento'::text
            ELSE
            CASE
                WHEN (COALESCE(r.quantidade_realizada, 0::numeric) / NULLIF(pp.qtd_plan_periodo, 0::numeric)) >= 1.05 THEN 'adiantado'::text
                WHEN (COALESCE(r.quantidade_realizada, 0::numeric) / NULLIF(pp.qtd_plan_periodo, 0::numeric)) < 0.7 THEN 'atrasado'::text
                WHEN (COALESCE(r.quantidade_realizada, 0::numeric) / NULLIF(pp.qtd_plan_periodo, 0::numeric)) < 0.95 THEN 'em_risco'::text
                ELSE 'no_prazo'::text
            END
        END AS status,
    COALESCE(pp.qtd_plan_periodo, 0::numeric) AS qtd_plan_periodo,
    COALESCE(b.producao_diaria_plan, b.producao_diaria_cpu) AS producao_diaria_plan
   FROM baseline b
     LEFT JOIN plan_periodo pp ON pp.obra_id = b.obra_id AND pp.item_id = b.item_id
     LEFT JOIN realizado r ON r.obra_id = b.obra_id AND r.item_id = b.item_id;

create or replace view public.vw_acompanhamento_produtividade_equipe with (security_invoker = true) as
WITH dia AS (
         SELECT p.obra_id,
            p.equipe_id,
            p.item_orcamentario_id,
            p.servico_id,
            p.data,
            max(p.servico_nome) AS servico_nome,
            sum(p.quantidade * p.fator_conversao) AS qtd
           FROM acompanhamento_producao p
          WHERE p.quantidade > 0::numeric
          GROUP BY p.obra_id, p.equipe_id, p.item_orcamentario_id, p.servico_id, p.data
        ), base AS (
         SELECT d.obra_id,
            d.equipe_id,
            d.item_orcamentario_id,
            d.servico_id,
            d.data,
            d.servico_nome,
            d.qtd,
            e.nome AS equipe_nome,
            e.cor AS equipe_cor,
            COALESCE(s.unidade, io.unidade_referencia) AS unidade_plano,
            COALESCE(ep.producao_diaria, snap.producao_diaria_qtde) AS meta
           FROM dia d
             LEFT JOIN equipe e ON e.id = d.equipe_id
             LEFT JOIN item_orcamentario io ON io.id = d.item_orcamentario_id
             LEFT JOIN servico s ON s.id = d.servico_id
             LEFT JOIN vw_servico_vivo snap ON snap.servico_id = io.servico_id
             LEFT JOIN equipe_produtividade ep ON ep.equipe_id = d.equipe_id AND ep.servico_id = d.servico_id
        )
 SELECT obra_id,
    equipe_id,
    equipe_id AS equipe_planejamento_id,
    COALESCE(equipe_nome, '—'::text) AS equipe_display_nome,
    COALESCE(equipe_nome, '—'::text) AS siga_equipe_nome,
    COALESCE(equipe_cor, '#94a3b8'::text) AS equipe_cor,
    servico_nome,
    servico_id,
    servico_id AS servico_planejamento_id,
    item_orcamentario_id,
    unidade_plano AS unidade,
    count(*) AS registros,
    count(DISTINCT data) AS dias_trabalhados,
    sum(qtd) AS qtd_total,
    avg(qtd) AS qtd_media,
    min(qtd) AS qtd_min,
    max(qtd) AS qtd_max,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (qtd::double precision)) AS qtd_p50,
    percentile_cont(0.9::double precision) WITHIN GROUP (ORDER BY (qtd::double precision)) AS qtd_p90,
    meta AS producao_diaria_meta,
    meta AS producao_diaria_cpu,
        CASE
            WHEN meta IS NULL OR meta = 0::numeric THEN NULL::numeric
            ELSE round((percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (qtd::double precision)) / meta::double precision)::numeric, 4)
        END AS pct_aderencia_meta,
        CASE
            WHEN meta IS NULL OR meta = 0::numeric THEN NULL::numeric
            ELSE round((percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (qtd::double precision)) / meta::double precision)::numeric, 4)
        END AS pct_aderencia_cpu,
    min(data) AS primeira_data,
    max(data) AS ultima_data
   FROM base
  GROUP BY obra_id, equipe_id, equipe_nome, equipe_cor, servico_nome, servico_id, item_orcamentario_id, unidade_plano, meta;
