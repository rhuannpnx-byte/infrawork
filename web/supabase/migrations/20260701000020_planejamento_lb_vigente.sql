-- InfraWork Web — Planejamento: plano em edição, linhas de base e vigente.
--
--   * 0..1 plano EM EDIÇÃO por obra (is_baseline = false);
--   * até 20 LINHAS DE BASE (is_baseline = true), travadas e com as próprias
--     PREMISSAS (quantidade/venda/custo do serviço e produção/dia de cada
--     tarefa + calendário) gravadas na promoção — o orçamento pode mudar
--     depois, a LB não;
--   * 0..1 VIGENTE (sempre uma LB): é a régua do acompanhamento. Sem vigente,
--     a régua é a última LB que foi vigente (referência provisória).
--   * CADEIA (recursos, composições, serviços, orçamento, indiretos) só é
--     editável sem vigente e com plano em edição — ou antes de existir
--     qualquer linha de base. Aditivos e reajustes (próximas fases) passam pela
--     trava com a flag infrawork.via_aditivo.
--   * Σ quantidade das tarefas de um serviço ≤ quantidade do serviço.

-- ─── 1. Colunas e estados ──────────────────────────────────────────────────
alter table public.planejamento
  add column if not exists vigente boolean not null default false,
  add column if not exists vigente_em timestamptz,
  add column if not exists travada_em timestamptz,
  add column if not exists premissa_calendario jsonb,
  -- orçamento/composições mudaram: o plano em edição recalcula o cronograma ao abrir
  add column if not exists recalculo_pendente boolean not null default false;

drop index if exists public.idx_planejamento_baseline_unica;
drop trigger if exists trg_planejamento_baseline_unica on public.planejamento;
drop function if exists public.fn_planejamento_baseline_unica();

-- dados existentes: a baseline atual vira a vigente; o plano não-baseline mais
-- recente fica em edição; os demais viram linhas de base.
update public.planejamento
   set vigente = true, vigente_em = coalesce(updated_at, now()), travada_em = coalesce(updated_at, now())
 where is_baseline;

with extras as (
  select id from (
    select id, row_number() over (partition by obra_id order by created_at desc) as rn
      from public.planejamento where not is_baseline
  ) x where rn > 1
)
update public.planejamento p
   set is_baseline = true, travada_em = now()
  from extras where extras.id = p.id;

update public.planejamento set status = 'ativo' where status <> 'ativo';

create unique index if not exists uq_planejamento_edicao
  on public.planejamento (obra_id) where not is_baseline;
create unique index if not exists uq_planejamento_vigente
  on public.planejamento (obra_id) where vigente;

alter table public.planejamento drop constraint if exists chk_planejamento_vigente_lb;
alter table public.planejamento
  add constraint chk_planejamento_vigente_lb check (not vigente or is_baseline);

create or replace function public.fn_planejamento_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if tg_op = 'DELETE' then
    if old.vigente then
      raise exception 'A linha de base "%" é a vigente — desmarque-a antes de excluir', old.nome;
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.is_baseline and not new.is_baseline then
    raise exception 'Linha de base travada não volta a ser editável — crie um plano em edição a partir dela';
  end if;
  if new.is_baseline and (tg_op = 'INSERT' or not old.is_baseline) then
    select count(*) into n from public.planejamento
     where obra_id = new.obra_id and is_baseline and id <> new.id;
    if n >= 20 then
      raise exception 'Limite de 20 linhas de base por obra — exclua uma antes de promover outra';
    end if;
    new.travada_em := now();
  end if;
  if new.vigente and (tg_op = 'INSERT' or not old.vigente) then
    new.vigente_em := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_planejamento_estado on public.planejamento;
create trigger trg_planejamento_estado
  before insert or update or delete on public.planejamento
  for each row execute function public.fn_planejamento_estado();

-- ─── 2. Premissas da linha de base ─────────────────────────────────────────
create table if not exists public.planejamento_lb_premissa (
  tarefa_id               uuid primary key references public.planejamento_tarefa(id) on delete cascade,
  planejamento_id         uuid not null references public.planejamento(id) on delete cascade,
  item_orcamentario_id    uuid,
  item_quantidade         numeric(18,4),
  item_venda_total        numeric(18,2),
  item_custo_unit         numeric(18,4),
  producao_diaria_cpu     numeric(14,4),
  producao_diaria_efetiva numeric(14,4)
);
create index if not exists idx_lb_premissa_plan on public.planejamento_lb_premissa (planejamento_id);

alter table public.planejamento_lb_premissa enable row level security;
drop policy if exists lb_premissa_select on public.planejamento_lb_premissa;
create policy lb_premissa_select on public.planejamento_lb_premissa
  for select using (exists (select 1 from public.planejamento p where p.id = planejamento_id));
grant select on public.planejamento_lb_premissa to authenticated;

create or replace function public.calendario_fingerprint(_obra_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'bitmask', (select dias_uteis_bitmask from public.obra_calendario where obra_id = _obra_id),
    'excecoes', coalesce((select jsonb_agg(jsonb_build_array(data, eh_util) order by data)
                            from public.obra_calendario_excecao where obra_id = _obra_id), '[]'::jsonb),
    'fatores', coalesce((select jsonb_agg(jsonb_build_array(ano_mes, fator) order by ano_mes)
                           from public.obra_produtividade_mes where obra_id = _obra_id), '[]'::jsonb))
$$;

-- valores AO VIVO de cada tarefa (ignora premissas): o que a LB teria hoje
create or replace function public.planejamento_tarefa_valores_vivos(_planejamento_id uuid)
returns table (
  tarefa_id uuid, item_orcamentario_id uuid, codigo text, descricao text,
  item_quantidade numeric, item_venda_total numeric, item_custo_unit numeric,
  producao_diaria_cpu numeric, producao_diaria_efetiva numeric
)
language sql stable security definer set search_path = public
as $$
  select t.id, i.id, i.codigo, i.descricao,
         i.quantidade_referencia, i.venda_total_calc, i.custo_unitario_calc,
         v.producao_diaria_qtde,
         coalesce((select sum(coalesce(pte.producao_diaria_override, ep.producao_diaria, v.producao_diaria_qtde)
                              * greatest(1, pte.qtd_equipes::int))
                     from public.planejamento_tarefa_equipe pte
                     left join public.equipe_produtividade ep
                       on ep.equipe_id = pte.equipe_id and ep.servico_id = i.servico_id
                    where pte.tarefa_id = t.id), v.producao_diaria_qtde)
    from public.planejamento_tarefa t
    join public.item_orcamentario i on i.id = t.item_orcamentario_id
    left join public.vw_servico_vivo v on v.servico_id = i.servico_id
   where t.planejamento_id = _planejamento_id and t.tipo_no = 'tarefa'
$$;

create or replace function public.lb_capturar_premissas(_planejamento_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  delete from public.planejamento_lb_premissa where planejamento_id = _planejamento_id;
  insert into public.planejamento_lb_premissa
    (tarefa_id, planejamento_id, item_orcamentario_id, item_quantidade, item_venda_total,
     item_custo_unit, producao_diaria_cpu, producao_diaria_efetiva)
  select tarefa_id, _planejamento_id, item_orcamentario_id, item_quantidade, item_venda_total,
         item_custo_unit, producao_diaria_cpu, producao_diaria_efetiva
    from public.planejamento_tarefa_valores_vivos(_planejamento_id);
  get diagnostics n = row_count;
  update public.planejamento p
     set premissa_calendario = public.calendario_fingerprint(p.obra_id)
   where p.id = _planejamento_id;
  return n;
end $$;
revoke all on function public.lb_capturar_premissas(uuid) from public, anon, authenticated;
grant execute on function public.lb_capturar_premissas(uuid) to service_role;

-- premissas que mudaram desde a promoção (vazio = LB ainda vale)
create or replace function public.lb_premissas_diff(_planejamento_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  itens jsonb; cal_mudou boolean; tem_item_excluido boolean; p record;
begin
  select id, obra_id, is_baseline, premissa_calendario into p
    from public.planejamento where id = _planejamento_id;
  if p.id is null or not p.is_baseline then
    return jsonb_build_object('mudou', false, 'itens', '[]'::jsonb, 'calendario', false);
  end if;

  with antes as (
    select pr.*, t.item_orcamentario_id as item_atual
      from public.planejamento_lb_premissa pr
      join public.planejamento_tarefa t on t.id = pr.tarefa_id
     where pr.planejamento_id = _planejamento_id
  ), agora as (
    select * from public.planejamento_tarefa_valores_vivos(_planejamento_id)
  ), cmp as (
    select a.item_orcamentario_id,
           coalesce(v.codigo, '?') as codigo, coalesce(v.descricao, '(serviço excluído)') as descricao,
           a.item_quantidade as qtd_antes, v.item_quantidade as qtd_agora,
           a.item_venda_total as venda_antes, v.item_venda_total as venda_agora,
           a.item_custo_unit as custo_antes, v.item_custo_unit as custo_agora,
           a.producao_diaria_efetiva as prod_antes, v.producao_diaria_efetiva as prod_agora
      from antes a left join agora v on v.tarefa_id = a.tarefa_id
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'item_orcamentario_id', item_orcamentario_id, 'codigo', codigo, 'descricao', descricao,
           'quantidade', case when abs(coalesce(qtd_antes,0) - coalesce(qtd_agora,0)) > 0.0001
                              then jsonb_build_array(qtd_antes, qtd_agora) end,
           'venda', case when abs(coalesce(venda_antes,0) - coalesce(venda_agora,0)) > 0.005
                         then jsonb_build_array(venda_antes, venda_agora) end,
           'custo_unit', case when abs(coalesce(custo_antes,0) - coalesce(custo_agora,0)) > 0.00005
                              then jsonb_build_array(custo_antes, custo_agora) end,
           'producao', case when abs(coalesce(prod_antes,0) - coalesce(prod_agora,0)) > 0.0001
                            then jsonb_build_array(prod_antes, prod_agora) end)), '[]'::jsonb)
    into itens
    from cmp
   where abs(coalesce(qtd_antes,0) - coalesce(qtd_agora,0)) > 0.0001
      or abs(coalesce(venda_antes,0) - coalesce(venda_agora,0)) > 0.005
      or abs(coalesce(custo_antes,0) - coalesce(custo_agora,0)) > 0.00005
      or abs(coalesce(prod_antes,0) - coalesce(prod_agora,0)) > 0.0001;

  cal_mudou := p.premissa_calendario is not null
           and p.premissa_calendario is distinct from public.calendario_fingerprint(p.obra_id);

  return jsonb_build_object(
    'mudou', jsonb_array_length(itens) > 0 or cal_mudou,
    'itens', itens,
    'calendario', cal_mudou);
end $$;
grant execute on function public.lb_premissas_diff(uuid) to authenticated, service_role;

-- ─── 3. Vigente e referência do acompanhamento ─────────────────────────────
create or replace function public.planejamento_referencia(_obra_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.planejamento
   where obra_id = _obra_id and is_baseline and vigente_em is not null
   order by vigente desc, vigente_em desc
   limit 1
$$;
grant execute on function public.planejamento_referencia(uuid) to authenticated, anon, service_role;

create or replace function public.marcar_vigente(_planejamento_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare p record; d jsonb;
begin
  select id, obra_id, is_baseline, nome into p from public.planejamento where id = _planejamento_id;
  if p.id is null then raise exception 'Planejamento não encontrado'; end if;
  if not public.pode_planejar_obra(p.obra_id) then raise exception 'Sem permissão'; end if;
  if not p.is_baseline then
    raise exception 'Só uma linha de base pode ser vigente — promova o plano em edição primeiro';
  end if;
  d := public.lb_premissas_diff(_planejamento_id);
  if (d->>'mudou')::boolean then
    raise exception 'As premissas da linha de base "%" mudaram desde que foi travada — use "Restaurar como nova linha de base"', p.nome;
  end if;
  update public.planejamento set vigente = false where obra_id = p.obra_id and vigente and id <> p.id;
  update public.planejamento set vigente = true where id = p.id;
end $$;
grant execute on function public.marcar_vigente(uuid) to authenticated;

create or replace function public.desmarcar_vigente(_obra_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.pode_planejar_obra(_obra_id) then raise exception 'Sem permissão'; end if;
  update public.planejamento set vigente = false where obra_id = _obra_id and vigente;
end $$;
grant execute on function public.desmarcar_vigente(uuid) to authenticated;

-- ─── 4. Trava da cadeia ────────────────────────────────────────────────────
create or replace function public.cadeia_trava_motivo(_obra_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when exists (select 1 from public.planejamento where obra_id = _obra_id and vigente) then
      'há um plano vigente ("' || (select nome from public.planejamento where obra_id = _obra_id and vigente) ||
      '") — desmarque o vigente para replanejar, ou lance um aditivo'
    when exists (select 1 from public.planejamento where obra_id = _obra_id and is_baseline)
     and not exists (select 1 from public.planejamento where obra_id = _obra_id and not is_baseline) then
      'não há plano em edição — crie um plano em edição para alterar'
    else null end
$$;
grant execute on function public.cadeia_trava_motivo(uuid) to authenticated;

create or replace function public.fn_cadeia_trava()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  j jsonb; v_obra uuid; motivo text;
begin
  if coalesce(current_setting('infrawork.recalc_em_curso', true), '') = '1'
     or coalesce(current_setting('infrawork.via_aditivo', true), '') = '1' then
    return coalesce(new, old);
  end if;
  j := to_jsonb(coalesce(new, old));
  if tg_table_name = 'recurso_preco' then
    v_obra := public.recurso_obra((j->>'recurso_id')::uuid);
  elsif tg_table_name = 'cpu_item' then
    select obra_id into v_obra from public.cpu where id = (j->>'cpu_id')::uuid;
  elsif tg_table_name = 'servico_cpu_link' then
    select obra_id into v_obra from public.servico where id = (j->>'servico_id')::uuid;
  else
    v_obra := (j->>'obra_id')::uuid;
  end if;
  if v_obra is null or not exists (select 1 from public.obras where id = v_obra) then
    return coalesce(new, old);
  end if;
  motivo := public.cadeia_trava_motivo(v_obra);
  if motivo is not null then
    raise exception 'Orçamento travado: %', motivo using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['recurso', 'recurso_preco', 'cpu', 'cpu_item', 'servico', 'servico_cpu_link',
                           'item_orcamentario', 'item_orc_alocacao', 'indireto_item']
  loop
    execute format('drop trigger if exists trg_cadeia_trava on public.%I', t);
    execute format('create trigger trg_cadeia_trava before insert or update or delete on public.%I
                    for each row execute function public.fn_cadeia_trava()', t);
  end loop;
end $$;

-- ─── 5. Σ tarefas de um serviço ≤ quantidade do serviço ───────────────────
create or replace function public.fn_tarefa_limite_servico()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_ref numeric; v_usado numeric; v_ind uuid; v_desc text; v_lb boolean;
begin
  if new.item_orcamentario_id is null or new.tipo_no <> 'tarefa' or new.quantidade_alocada is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.item_orcamentario_id is not distinct from old.item_orcamentario_id
     and coalesce(new.quantidade_alocada, 0) <= coalesce(old.quantidade_alocada, 0) then
    return new;
  end if;
  select is_baseline into v_lb from public.planejamento where id = new.planejamento_id;
  if v_lb then return new; end if;
  select quantidade_referencia, indireto_id, descricao into v_ref, v_ind, v_desc
    from public.item_orcamentario where id = new.item_orcamentario_id;
  if v_ind is not null then return new; end if;
  select coalesce(sum(quantidade_alocada), 0) into v_usado
    from public.planejamento_tarefa
   where planejamento_id = new.planejamento_id and item_orcamentario_id = new.item_orcamentario_id
     and tipo_no = 'tarefa' and id <> new.id;
  if v_usado + new.quantidade_alocada > coalesce(v_ref, 0) + 0.0001 then
    raise exception 'Quantidade acima do serviço "%": % já programado + % > % do orçamento (restam %)',
      v_desc, round(v_usado, 4), round(new.quantidade_alocada, 4), round(coalesce(v_ref, 0), 4),
      round(greatest(coalesce(v_ref, 0) - v_usado, 0), 4);
  end if;
  return new;
end $$;

drop trigger if exists trg_tarefa_limite_servico on public.planejamento_tarefa;
create trigger trg_tarefa_limite_servico
  before insert or update of quantidade_alocada, item_orcamentario_id on public.planejamento_tarefa
  for each row execute function public.fn_tarefa_limite_servico();

-- premissas das LBs que já existiam
do $$
declare r record;
begin
  for r in select id from public.planejamento where is_baseline loop
    perform public.lb_capturar_premissas(r.id);
  end loop;
end $$;

-- ─── 6. Views: LB usa as próprias premissas; acompanhamento usa a referência ─
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
    COALESCE(pr.item_quantidade, i.quantidade_referencia)::numeric(14,4) AS quantidade_referencia,
    i.servico_id,
    i.indireto_id,
    i.unidade_referencia AS unidade_referencia_item,
    COALESCE(pr.item_custo_unit, i.custo_unitario_calc)::numeric(14,4) AS custo_unitario_item,
        CASE
            WHEN i.tipo = 'receita'::text THEN i.venda_unitaria
            WHEN i.tipo = 'servico_grupo'::text AND COALESCE(pr.item_quantidade, i.quantidade_referencia) > 0::numeric THEN (COALESCE(pr.item_venda_total, i.venda_total_calc) / COALESCE(pr.item_quantidade, i.quantidade_referencia))::numeric(18,4)
            ELSE NULL::numeric
        END AS venda_unitaria_item,
    COALESCE(pr.item_venda_total, i.venda_total_calc)::numeric(14,2) AS venda_total_item,
    s.codigo AS servico_codigo,
    s.nome AS servico_nome,
    s.unidade AS unidade_servico,
    i.cpu_snapshot_id,
    snap.cpu_id AS cpu_id_origem,
    COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde)::numeric(14,4) AS producao_diaria_qtde,
    snap.producao_diaria_unidade,
    COALESCE(pr.item_custo_unit, snap.custo_unit)::numeric(14,4) AS custo_unit_snapshot,
    COALESCE(pr.producao_diaria_efetiva, ( SELECT sum(COALESCE(pte.producao_diaria_override, ep.producao_diaria, COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde)) * GREATEST(1, pte.qtd_equipes::integer)::numeric) AS sum
           FROM planejamento_tarefa_equipe pte
             LEFT JOIN equipe_produtividade ep ON ep.equipe_id = pte.equipe_id AND ep.servico_id = i.servico_id
          WHERE pte.tarefa_id = t.id), COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde)) AS producao_diaria_efetiva,
    i.indireto_id IS NOT NULL AS is_indireto,
        CASE
            WHEN i.indireto_id IS NOT NULL AND pti.tarefa_id IS NOT NULL THEN jsonb_build_object('custo_periodicidade', pti.custo_periodicidade, 'custo_unitario', pti.custo_unitario, 'receita_modo', pti.receita_modo, 'receita_unitaria', pti.receita_unitaria, 'receita_percentual', pti.receita_percentual, 'offset_dias_antes', pti.offset_dias_antes, 'offset_dias_depois', pti.offset_dias_depois, 'receita_extrapola', pti.receita_extrapola, 'aplica_taxas', pti.aplica_taxas, 'taxa_regime_id', pti.taxa_regime_id, 'periodos_calc', pti.periodos_calc)
            ELSE NULL::jsonb
        END AS indireto_config,
        CASE
            WHEN i.indireto_id IS NOT NULL THEN COALESCE(pti.custo_total_calc, 0::numeric)::numeric(18,2)
            WHEN COALESCE(pr.item_custo_unit, snap.custo_unit) IS NOT NULL AND t.quantidade_alocada IS NOT NULL THEN (COALESCE(pr.item_custo_unit, snap.custo_unit) * t.quantidade_alocada)::numeric(18,2)
            ELSE 0::numeric(18,2)
        END AS custo_total_calc,
        CASE
            WHEN i.indireto_id IS NOT NULL THEN COALESCE(pti.receita_total_calc, 0::numeric)::numeric(18,2)
            WHEN i.tipo = 'servico_grupo'::text AND COALESCE(pr.item_quantidade, i.quantidade_referencia) > 0::numeric AND t.quantidade_alocada IS NOT NULL THEN (COALESCE(pr.item_venda_total, i.venda_total_calc) / COALESCE(pr.item_quantidade, i.quantidade_referencia) * t.quantidade_alocada)::numeric(18,2)
            WHEN i.tipo = 'receita'::text AND i.venda_unitaria IS NOT NULL AND t.quantidade_alocada IS NOT NULL THEN (i.venda_unitaria * t.quantidade_alocada)::numeric(18,2)
            ELSE 0::numeric(18,2)
        END AS receita_total_calc,
        CASE
            WHEN i.indireto_id IS NOT NULL THEN pti.custo_taxas_calc
            ELSE NULL::numeric
        END AS custo_taxas_calc,
        CASE
            WHEN COALESCE(pr.item_custo_unit, snap.custo_unit) IS NOT NULL AND t.quantidade_alocada IS NOT NULL THEN (COALESCE(pr.item_custo_unit, snap.custo_unit) * t.quantidade_alocada)::numeric(14,2)
            ELSE 0::numeric(14,2)
        END AS custo_total_tarefa,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'cor', e.cor, 'tipo', e.tipo, 'ordem', e.ordem, 'qtd_equipes', pte.qtd_equipes, 'producao_diaria_override', pte.producao_diaria_override, 'producao_diaria_equipe', ep.producao_diaria, 'producao_diaria_efetiva', COALESCE(pte.producao_diaria_override, ep.producao_diaria, COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde)) * GREATEST(1, pte.qtd_equipes::integer)::numeric) ORDER BY e.ordem, e.nome) AS jsonb_agg
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
     LEFT JOIN planejamento_lb_premissa pr ON pr.tarefa_id = t.id
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
          WHERE pl.id = planejamento_referencia(pl.obra_id) AND io.indireto_id IS NULL
          GROUP BY pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao, io.unidade_referencia, snap.producao_diaria_qtde
        ), plan_periodo AS (
         SELECT pl.obra_id,
            pt.item_orcamentario_id AS item_id,
            sum(ps.quantidade_planejada / 5.0 * LEAST(5, GREATEST(0, CURRENT_DATE - ps.semana_segunda + 1))::numeric)::numeric(14,4) AS qtd_plan_periodo
           FROM planejamento pl
             JOIN planejamento_tarefa pt ON pt.planejamento_id = pl.id
             JOIN planejamento_tarefa_perfil_semana ps ON ps.tarefa_id = pt.id
          WHERE pl.id = planejamento_referencia(pl.obra_id)
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

create or replace view public.vw_acompanhamento_curva_s with (security_invoker = true) as
WITH baseline_meta AS (
         SELECT pl.obra_id,
            pt.item_orcamentario_id AS item_id,
            io.codigo,
            io.descricao,
            sum(pt.quantidade_alocada)::numeric(14,4) AS qtd_plan
           FROM planejamento pl
             JOIN planejamento_tarefa pt ON pt.planejamento_id = pl.id
             JOIN item_orcamentario io ON io.id = pt.item_orcamentario_id
          WHERE pl.id = planejamento_referencia(pl.obra_id) AND pt.quantidade_alocada IS NOT NULL
          GROUP BY pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao
        ), planejado_dia_raw AS (
         SELECT pl.obra_id,
            pt.item_orcamentario_id AS item_id,
            (ps.semana_segunda + ((i.i || ' days'::text)::interval))::date AS data,
            ps.quantidade_planejada / 5.0 AS planejado_dia
           FROM planejamento pl
             JOIN planejamento_tarefa pt ON pt.planejamento_id = pl.id
             JOIN planejamento_tarefa_perfil_semana ps ON ps.tarefa_id = pt.id
             CROSS JOIN generate_series(0, 4) i(i)
          WHERE pl.id = planejamento_referencia(pl.obra_id)
        ), real_dia AS (
         SELECT p.obra_id,
            p.item_orcamentario_id AS item_id,
            p.data,
            sum(p.quantidade * p.fator_conversao) AS qtd
           FROM acompanhamento_producao p
          WHERE p.item_orcamentario_id IS NOT NULL
          GROUP BY p.obra_id, p.item_orcamentario_id, p.data
        ), todos_pares AS (
         SELECT planejado_dia_raw.obra_id,
            planejado_dia_raw.item_id,
            planejado_dia_raw.data
           FROM planejado_dia_raw
        UNION
         SELECT real_dia.obra_id,
            real_dia.item_id,
            real_dia.data
           FROM real_dia
        ), agregado AS (
         SELECT tp.obra_id,
            tp.item_id,
            tp.data,
            COALESCE(( SELECT sum(pp.planejado_dia) AS sum
                   FROM planejado_dia_raw pp
                  WHERE pp.obra_id = tp.obra_id AND pp.item_id = tp.item_id AND pp.data = tp.data), 0::numeric) AS planejado_dia,
            COALESCE(( SELECT rd.qtd
                   FROM real_dia rd
                  WHERE rd.obra_id = tp.obra_id AND rd.item_id = tp.item_id AND rd.data = tp.data), 0::numeric) AS realizado_dia
           FROM todos_pares tp
        )
 SELECT a.obra_id,
    a.item_id AS item_orcamentario_id,
    bm.codigo AS servico_grupo_codigo,
    bm.descricao AS servico_grupo_descricao,
    a.data,
    a.planejado_dia,
    sum(a.planejado_dia) OVER (PARTITION BY a.obra_id, a.item_id ORDER BY a.data) AS planejado_acumulado,
    a.realizado_dia,
    sum(a.realizado_dia) OVER (PARTITION BY a.obra_id, a.item_id ORDER BY a.data) AS realizado_acumulado,
    bm.qtd_plan AS qtd_planejada_total
   FROM agregado a
     LEFT JOIN baseline_meta bm ON bm.obra_id = a.obra_id AND bm.item_id = a.item_id;

create or replace view public.vw_acompanhamento_producao_enriquecida with (security_invoker = true) as
SELECT p.id,
    p.obra_id,
    p.data,
    p.item_orcamentario_id,
    p.servico_id,
    p.servico_id AS servico_planejamento_id,
    p.servico_nome,
    p.quantidade AS qtd,
    (p.quantidade * p.fator_conversao)::numeric(14,4) AS qtd_convertida,
    p.fator_conversao,
    p.unidade,
    COALESCE(s.unidade, io.unidade_referencia, p.unidade) AS unidade_plano,
    COALESCE(NULLIF(TRIM(BOTH FROM p.frente), ''::text), '(sem frente)'::text) AS frente,
    p.frente AS frente_raw,
    p.estaca_inicial,
    p.estaca_final,
    p.obs,
    p.origem,
    p.importacao_id,
    p.criado_por,
    pr.nome AS criado_por_nome,
    p.created_at,
    p.updated_at,
    p.equipe_id,
    p.equipe_id AS equipe_planejamento_id,
    COALESCE(e.nome, '—'::text) AS equipe_display_nome,
    COALESCE(e.cor, '#94a3b8'::text) AS equipe_display_cor,
    e.tipo AS equipe_tipo,
    p.encarregado_id,
    COALESCE(en.apelido, en.nome) AS encarregado_display_nome,
    s.codigo AS servico_codigo,
    COALESCE(s.nome, p.servico_nome) AS servico_display_nome,
    s.unidade AS servico_unidade,
    io.codigo AS servico_grupo_codigo,
    io.descricao AS servico_grupo_descricao,
    pta.tarefa_id AS tarefa_baseline_id,
    pta.data_inicio AS tarefa_data_inicio,
    pta.data_fim AS tarefa_data_fim,
    ( SELECT count(*) AS count
           FROM acompanhamento_foto f
          WHERE f.producao_id = p.id AND f.excluida_em IS NULL) AS fotos_count
   FROM acompanhamento_producao p
     LEFT JOIN equipe e ON e.id = p.equipe_id
     LEFT JOIN encarregado en ON en.id = p.encarregado_id
     LEFT JOIN item_orcamentario io ON io.id = p.item_orcamentario_id
     LEFT JOIN servico s ON s.id = p.servico_id
     LEFT JOIN profiles pr ON pr.id = p.criado_por
     LEFT JOIN planejamento pl ON pl.obra_id = p.obra_id AND pl.id = planejamento_referencia(p.obra_id)
     LEFT JOIN ( SELECT pt.planejamento_id,
            pt.item_orcamentario_id,
            min(pt.data_inicio) AS data_inicio,
            max(pt.data_fim) AS data_fim,
            (array_agg(pt.id ORDER BY pt.data_inicio))[1] AS tarefa_id
           FROM planejamento_tarefa pt
          WHERE pt.item_orcamentario_id IS NOT NULL
          GROUP BY pt.planejamento_id, pt.item_orcamentario_id) pta ON pta.planejamento_id = pl.id AND pta.item_orcamentario_id = p.item_orcamentario_id;

-- ─── 7. Orçamento recalculado → plano em edição precisa recalcular datas ───
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
    update public.planejamento set recalculo_pendente = true
     where obra_id = new.obra_id and not is_baseline and not recalculo_pendente;
  end if;
  return null;
end $$;
