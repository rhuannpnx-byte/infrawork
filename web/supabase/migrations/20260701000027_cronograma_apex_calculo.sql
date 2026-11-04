-- Cronograma ApeX (F2): equipe viva da composição, gravação transacional dos resultados do motor, premissas da linha
-- de base estendidas e views lendo o perfil diário (que segue o calendário do plano).

-- ═══ 1. Equipe (crew) do ApeX = composição viva do serviço ═══════════════════════════════════════════════════════
-- Mesma fonte de vw_servico_vivo: as CPUs ligadas (servico_cpu_link) ou, sem ligação, a CPU vigente. Recursos = itens
-- de equipamento e mão de obra dessas CPUs, somados por recurso. O adaptador do cronograma e as premissas da linha de
-- base usam esta função, então a equipe congelada é exatamente a calculada.
create or replace function public.servico_equipe_viva(_servico_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with cpus as (
    select l.cpu_id from public.servico_cpu_link l where l.servico_id = _servico_id
    union
    select c.id from public.cpu c
     where c.servico_id = _servico_id and c.is_vigente
       and not exists (select 1 from public.servico_cpu_link l where l.servico_id = _servico_id)
  ), rec as (
    select it.recurso_id, r.nome, r.grupo, sum(coalesce(it.quantidade, 0)) as qtd
      from public.cpu_item it
      join cpus on cpus.cpu_id = it.cpu_id
      join public.recurso r on r.id = it.recurso_id
     where it.grupo in ('EQUIPAMENTO', 'MO') and it.recurso_id is not null
     group by it.recurso_id, r.nome, r.grupo
    having sum(coalesce(it.quantidade, 0)) > 0
  )
  select jsonb_build_object(
    'servico_id', _servico_id,
    'producao_diaria', v.producao_diaria_qtde,
    'unidade', v.producao_diaria_unidade,
    'cpu_ids', coalesce((select jsonb_agg(cpu_id order by cpu_id) from cpus), '[]'::jsonb),
    'recursos', coalesce((select jsonb_agg(jsonb_build_object('recurso_id', recurso_id, 'nome', nome, 'grupo', grupo, 'qtd', qtd) order by nome, recurso_id) from rec), '[]'::jsonb))
    from public.vw_servico_vivo v where v.servico_id = _servico_id
$$;
grant execute on function public.servico_equipe_viva(uuid) to authenticated;

-- equipes de todos os serviços de uma obra numa chamada (o adaptador monta o projeto com elas)
create or replace function public.obra_equipes_vivas(_obra_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(public.servico_equipe_viva(s.id) order by s.codigo), '[]'::jsonb)
    from public.servico s
   where s.obra_id = _obra_id and public.pode_ver_obra(_obra_id)
     and (exists (select 1 from public.cpu c where c.servico_id = s.id) or exists (select 1 from public.servico_cpu_link l where l.servico_id = s.id))
$$;
grant execute on function public.obra_equipes_vivas(uuid) to authenticated;

-- ═══ 2. Gravação dos resultados ══════════════════════════════════════════════════════════════════════════════════
-- Uma transação, com trava por plano. Recusa resultado calculado sobre dados antigos (dados_rev diferente): o cliente
-- recalcula. Datas em timestamp sem fuso (os segundos do motor = horário local da obra).
create or replace function public.planejamento_gravar_calculo(_planejamento_id uuid, _dados jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare p record; n_t int; n_l int; n_w int; n_d int; n_s int;
begin
  select id, obra_id, is_baseline, dados_rev into p from public.planejamento where id = _planejamento_id;
  if p.id is null then raise exception 'Plano não encontrado'; end if;
  if not public.pode_planejar_obra(p.obra_id) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if p.is_baseline then raise exception 'Linha de base travada não recebe novo cálculo'; end if;
  perform pg_advisory_xact_lock(hashtext('plan-calc:' || _planejamento_id::text));
  -- relê depois da trava
  select dados_rev into p.dados_rev from public.planejamento where id = _planejamento_id;
  if (_dados->>'dados_rev')::bigint is distinct from p.dados_rev then
    return jsonb_build_object('ok', false, 'motivo', 'desatualizado', 'dados_rev', p.dados_rev);
  end if;

  perform set_config('infrawork.gravando_calculo', '1', true);

  update public.planejamento_tarefa t set
    inicio_em = x.inicio_em, fim_em = x.fim_em,
    data_inicio = x.data_inicio, data_fim = x.data_fim,
    duracao_dias_uteis_calc = x.duracao_dias_uteis,
    folga_total_h = x.folga_total_h, folga_livre_h = x.folga_livre_h,
    total_float = x.folga_total_dias, free_float = x.folga_livre_dias,
    is_critico = x.critico, restricao_limite = x.restricao_limite, violacoes = x.violacoes,
    early_start = x.data_inicio, early_finish = x.data_fim,
    -- indiretos: a quantidade é o número de períodos cobertos (como no motor antigo)
    quantidade_alocada = coalesce(x.quantidade, t.quantidade_alocada)
  from jsonb_to_recordset(coalesce(_dados->'tarefas', '[]'::jsonb)) as x(
    id uuid, inicio_em timestamp, fim_em timestamp, data_inicio date, data_fim date, duracao_dias_uteis numeric,
    folga_total_h numeric, folga_livre_h numeric, folga_total_dias int, folga_livre_dias int, critico boolean,
    restricao_limite text, violacoes jsonb, quantidade numeric)
  where t.id = x.id and t.planejamento_id = _planejamento_id;
  get diagnostics n_t = row_count;

  update public.planejamento_tarefa_local l set inicio_em = x.inicio_em, fim_em = x.fim_em
    from jsonb_to_recordset(coalesce(_dados->'locais', '[]'::jsonb)) as x(id uuid, inicio_em timestamp, fim_em timestamp)
   where l.id = x.id and l.planejamento_id = _planejamento_id;
  get diagnostics n_l = row_count;

  delete from public.planejamento_tarefa_wp where planejamento_id = _planejamento_id;
  insert into public.planejamento_tarefa_wp (planejamento_id, tarefa_id, local_id, ordem, trecho_id, inicio_m, fim_m, quantidade, inicio_em, fim_em)
  select _planejamento_id, x.tarefa_id, x.local_id, x.ordem, x.trecho_id, x.inicio_m, x.fim_m, x.quantidade, x.inicio_em, x.fim_em
    from jsonb_to_recordset(coalesce(_dados->'wps', '[]'::jsonb)) as x(
      tarefa_id uuid, local_id uuid, ordem int, trecho_id uuid, inicio_m numeric, fim_m numeric, quantidade numeric,
      inicio_em timestamp, fim_em timestamp)
    join public.planejamento_tarefa t on t.id = x.tarefa_id and t.planejamento_id = _planejamento_id;
  get diagnostics n_w = row_count;

  delete from public.planejamento_tarefa_perfil_dia d using public.planejamento_tarefa t
   where t.id = d.tarefa_id and t.planejamento_id = _planejamento_id;
  insert into public.planejamento_tarefa_perfil_dia (tarefa_id, dia, quantidade)
  select x.tarefa_id, x.dia, x.quantidade
    from jsonb_to_recordset(coalesce(_dados->'perfil_dia', '[]'::jsonb)) as x(tarefa_id uuid, dia date, quantidade numeric)
    join public.planejamento_tarefa t on t.id = x.tarefa_id and t.planejamento_id = _planejamento_id
   where x.quantidade <> 0;
  get diagnostics n_d = row_count;

  delete from public.planejamento_tarefa_perfil_semana s using public.planejamento_tarefa t
   where t.id = s.tarefa_id and t.planejamento_id = _planejamento_id;
  insert into public.planejamento_tarefa_perfil_semana (tarefa_id, semana_segunda, quantidade_planejada)
  select x.tarefa_id, x.semana_segunda, x.quantidade
    from jsonb_to_recordset(coalesce(_dados->'perfil_semana', '[]'::jsonb)) as x(tarefa_id uuid, semana_segunda date, quantidade numeric)
    join public.planejamento_tarefa t on t.id = x.tarefa_id and t.planejamento_id = _planejamento_id
   where x.quantidade <> 0;
  get diagnostics n_s = row_count;

  -- indiretos: janela pelas diretas e custo/receita do período (calculados no cliente, como o motor antigo fazia)
  update public.planejamento_tarefa_indireto i set
    custo_total_calc = x.custo_total_calc, receita_total_calc = x.receita_total_calc,
    custo_taxas_calc = x.custo_taxas_calc, periodos_calc = x.periodos_calc
    from jsonb_to_recordset(coalesce(_dados->'indiretos', '[]'::jsonb)) as x(
      tarefa_id uuid, custo_total_calc numeric, receita_total_calc numeric, custo_taxas_calc numeric, periodos_calc numeric)
    join public.planejamento_tarefa t on t.id = x.tarefa_id and t.planejamento_id = _planejamento_id
   where i.tarefa_id = x.tarefa_id;

  update public.planejamento set
    calculo_rev = dados_rev, calculado_em = now(), recalculo_pendente = false,
    calculo_aviso = nullif(_dados->>'aviso', '')
   where id = _planejamento_id;

  if (_dados->>'data_fim_obra') is not null then
    update public.obras set data_fim_planejada = (_dados->>'data_fim_obra')::date where id = p.obra_id;
  end if;

  perform set_config('infrawork.gravando_calculo', '', true);
  return jsonb_build_object('ok', true, 'tarefas', n_t, 'locais', n_l, 'wps', n_w, 'perfil_dia', n_d, 'perfil_semana', n_s);
end $$;
grant execute on function public.planejamento_gravar_calculo(uuid, jsonb) to authenticated;

-- ═══ 3. Premissas da linha de base ═══════════════════════════════════════════════════════════════════════════════
alter table public.planejamento_lb_premissa add column equipe jsonb;
comment on column public.planejamento_lb_premissa.equipe is 'Equipe (composição) usada no cálculo: servico_equipe_viva no momento da promoção';

-- calendários (com definições), fatores mensais e dependências entre serviços: o que a obra usa no cálculo
create or replace function public.calendario_fingerprint(_obra_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'calendarios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'nome', c.nome, 'padrao', c.padrao, 'semana', c.semana,
               'definicoes', coalesce((select jsonb_agg(jsonb_build_object(
                   'tipo', d.tipo, 'nome', d.nome, 'data_inicio', d.data_inicio, 'data_fim', d.data_fim,
                   'todo_ano', d.todo_ano, 'dia_semana', d.dia_semana, 'semana', d.semana) order by d.ordem, d.id)
                 from public.calendario_definicao d where d.calendario_id = c.id), '[]'::jsonb)) order by c.id)
        from public.calendario c where c.obra_id = _obra_id), '[]'::jsonb),
    'fatores', coalesce((select jsonb_agg(jsonb_build_array(ano_mes, fator) order by ano_mes)
                           from public.obra_produtividade_mes where obra_id = _obra_id), '[]'::jsonb))
$$;

create or replace function public.servico_dependencias_fingerprint(_obra_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('predecessor_id', predecessor_id, 'sucessor_id', sucessor_id, 'atraso_dias', atraso_dias)
                    order by predecessor_id, sucessor_id), '[]'::jsonb)
    from public.servico_dependencia where obra_id = _obra_id
$$;

-- ganha a coluna equipe: muda o tipo de retorno
drop function if exists public.planejamento_tarefa_valores_vivos(uuid);
create or replace function public.planejamento_tarefa_valores_vivos(_planejamento_id uuid)
returns table (
  tarefa_id uuid, item_orcamentario_id uuid, codigo text, descricao text,
  item_quantidade numeric, item_venda_total numeric, item_custo_unit numeric,
  producao_diaria_cpu numeric, producao_diaria_efetiva numeric, equipe jsonb
)
language sql stable security definer set search_path = public
as $$
  select t.id, i.id, i.codigo, i.descricao,
         i.quantidade_referencia, i.venda_total_calc, i.custo_unitario_calc,
         v.producao_diaria_qtde,
         v.producao_diaria_qtde * t.qtd_equipes * t.coef_producao,
         case when i.servico_id is not null then public.servico_equipe_viva(i.servico_id) end
    from public.planejamento_tarefa t
    join public.item_orcamentario i on i.id = t.item_orcamentario_id
    left join public.vw_servico_vivo v on v.servico_id = i.servico_id
   where t.planejamento_id = _planejamento_id and t.tipo_no = 'tarefa'
$$;

create or replace function public.lb_capturar_premissas(_planejamento_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  delete from public.planejamento_lb_premissa where planejamento_id = _planejamento_id;
  insert into public.planejamento_lb_premissa
    (tarefa_id, planejamento_id, item_orcamentario_id, item_quantidade, item_venda_total,
     item_custo_unit, producao_diaria_cpu, producao_diaria_efetiva, equipe)
  select tarefa_id, _planejamento_id, item_orcamentario_id, item_quantidade, item_venda_total,
         item_custo_unit, producao_diaria_cpu, producao_diaria_efetiva, equipe
    from public.planejamento_tarefa_valores_vivos(_planejamento_id);
  get diagnostics n = row_count;
  update public.planejamento p
     set premissa_calendario = public.calendario_fingerprint(p.obra_id),
         premissa_calendarios = public.calendario_fingerprint(p.obra_id),
         premissa_tipos = public.servico_dependencias_fingerprint(p.obra_id)
   where p.id = _planejamento_id;
  return n;
end $$;
revoke all on function public.lb_capturar_premissas(uuid) from public, anon, authenticated;
grant execute on function public.lb_capturar_premissas(uuid) to service_role;

create or replace function public.lb_premissas_diff(_planejamento_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare itens jsonb; cal_mudou boolean; tipos_mudou boolean; p record;
begin
  select id, obra_id, is_baseline, premissa_calendarios, premissa_calendario, premissa_tipos into p
    from public.planejamento where id = _planejamento_id;
  if p.id is null or not p.is_baseline then
    return jsonb_build_object('mudou', false, 'itens', '[]'::jsonb, 'calendario', false, 'tipos', false);
  end if;
  with antes as (
    select pr.* from public.planejamento_lb_premissa pr where pr.planejamento_id = _planejamento_id
  ), agora as (
    select * from public.planejamento_tarefa_valores_vivos(_planejamento_id)
  ), cmp as (
    select a.item_orcamentario_id,
           coalesce(v.codigo, '?') as codigo, coalesce(v.descricao, '(serviço excluído)') as descricao,
           a.item_quantidade as qtd_antes, v.item_quantidade as qtd_agora,
           a.item_venda_total as venda_antes, v.item_venda_total as venda_agora,
           a.item_custo_unit as custo_antes, v.item_custo_unit as custo_agora,
           a.producao_diaria_efetiva as prod_antes, v.producao_diaria_efetiva as prod_agora,
           (a.equipe is not null and v.equipe is not null and (a.equipe->'recursos') is distinct from (v.equipe->'recursos')) as equipe_mudou
      from antes a left join agora v on v.tarefa_id = a.tarefa_id
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'item_orcamentario_id', item_orcamentario_id, 'codigo', codigo, 'descricao', descricao,
           'quantidade', case when abs(coalesce(qtd_antes,0) - coalesce(qtd_agora,0)) > 0.0001 then jsonb_build_array(qtd_antes, qtd_agora) end,
           'venda', case when abs(coalesce(venda_antes,0) - coalesce(venda_agora,0)) > 0.005 then jsonb_build_array(venda_antes, venda_agora) end,
           'custo_unit', case when abs(coalesce(custo_antes,0) - coalesce(custo_agora,0)) > 0.00005 then jsonb_build_array(custo_antes, custo_agora) end,
           'producao', case when abs(coalesce(prod_antes,0) - coalesce(prod_agora,0)) > 0.0001 then jsonb_build_array(prod_antes, prod_agora) end,
           'equipe', case when equipe_mudou then true end)), '[]'::jsonb)
    into itens
    from cmp
   where abs(coalesce(qtd_antes,0) - coalesce(qtd_agora,0)) > 0.0001
      or abs(coalesce(venda_antes,0) - coalesce(venda_agora,0)) > 0.005
      or abs(coalesce(custo_antes,0) - coalesce(custo_agora,0)) > 0.00005
      or abs(coalesce(prod_antes,0) - coalesce(prod_agora,0)) > 0.0001
      or equipe_mudou;
  cal_mudou := coalesce(p.premissa_calendarios, p.premissa_calendario) is not null
           and coalesce(p.premissa_calendarios, p.premissa_calendario) is distinct from public.calendario_fingerprint(p.obra_id);
  tipos_mudou := p.premissa_tipos is not null and p.premissa_tipos is distinct from public.servico_dependencias_fingerprint(p.obra_id);
  return jsonb_build_object(
    'mudou', jsonb_array_length(itens) > 0 or cal_mudou or tipos_mudou,
    'itens', itens, 'calendario', cal_mudou, 'tipos', tipos_mudou);
end $$;

-- ═══ 4. View das tarefas: campos do ApeX no fim (os existentes mantêm nome e tipo) ════════════════════════════════
create or replace view public.vw_planejamento_tarefa_completa as
 select t.id, t.planejamento_id, t.item_orcamentario_id, t.data_inicio, t.data_fim, t.duracao_dias_uteis_calc,
    t.data_inicio_manual, t.notas, t.ordem, t.created_at, t.updated_at, t.tipo_no, t.parent_id, t.nivel, t.codigo_eap,
    t.nome_custom, t.quantidade_alocada, t.early_start, t.early_finish, t.late_start, t.late_finish, t.total_float,
    t.free_float, t.is_critico, t.schedule_mode, t.constraint_type, t.constraint_date,
    p.obra_id, p.is_baseline, p.status as planejamento_status, p.data_date as planejamento_data_date,
    i.codigo as servico_grupo_codigo, i.descricao as servico_grupo_descricao,
    coalesce(pr.item_quantidade, i.quantidade_referencia)::numeric(14,4) as quantidade_referencia,
    i.servico_id, i.indireto_id, i.unidade_referencia as unidade_referencia_item,
    coalesce(pr.item_custo_unit, i.custo_unitario_calc)::numeric(14,4) as custo_unitario_item,
    case
      when i.tipo = 'receita' then i.venda_unitaria
      when i.tipo = 'servico_grupo' and coalesce(pr.item_quantidade, i.quantidade_referencia) > 0
        then (coalesce(pr.item_venda_total, i.venda_total_calc) / coalesce(pr.item_quantidade, i.quantidade_referencia))::numeric(18,4)
      else null::numeric
    end as venda_unitaria_item,
    coalesce(pr.item_venda_total, i.venda_total_calc)::numeric(14,2) as venda_total_item,
    s.codigo as servico_codigo, s.nome as servico_nome, s.unidade as unidade_servico,
    i.cpu_snapshot_id, snap.cpu_id as cpu_id_origem,
    coalesce(pr.producao_diaria_cpu, snap.producao_diaria_qtde) as producao_diaria_qtde,
    snap.producao_diaria_unidade,
    coalesce(pr.item_custo_unit, snap.custo_unit)::numeric(14,4) as custo_unit_snapshot,
    coalesce(pr.producao_diaria_efetiva, coalesce(pr.producao_diaria_cpu, snap.producao_diaria_qtde) * t.qtd_equipes * t.coef_producao) as producao_diaria_efetiva,
    (i.indireto_id is not null) as is_indireto,
    case when i.indireto_id is not null and pti.tarefa_id is not null then jsonb_build_object(
      'custo_periodicidade', pti.custo_periodicidade, 'custo_unitario', pti.custo_unitario, 'receita_modo', pti.receita_modo,
      'receita_unitaria', pti.receita_unitaria, 'receita_percentual', pti.receita_percentual,
      'offset_dias_antes', pti.offset_dias_antes, 'offset_dias_depois', pti.offset_dias_depois,
      'receita_extrapola', pti.receita_extrapola, 'aplica_taxas', pti.aplica_taxas, 'taxa_regime_id', pti.taxa_regime_id,
      'periodos_calc', pti.periodos_calc) end as indireto_config,
    case
      when i.indireto_id is not null then coalesce(pti.custo_total_calc, 0)::numeric(18,2)
      when coalesce(pr.item_custo_unit, snap.custo_unit) is not null and t.quantidade_alocada is not null
        then (coalesce(pr.item_custo_unit, snap.custo_unit) * t.quantidade_alocada)::numeric(18,2)
      else 0::numeric(18,2)
    end as custo_total_calc,
    case
      when i.indireto_id is not null then coalesce(pti.receita_total_calc, 0)::numeric(18,2)
      when i.tipo = 'servico_grupo' and coalesce(pr.item_quantidade, i.quantidade_referencia) > 0 and t.quantidade_alocada is not null
        then ((coalesce(pr.item_venda_total, i.venda_total_calc) / coalesce(pr.item_quantidade, i.quantidade_referencia)) * t.quantidade_alocada)::numeric(18,2)
      when i.tipo = 'receita' and i.venda_unitaria is not null and t.quantidade_alocada is not null
        then (i.venda_unitaria * t.quantidade_alocada)::numeric(18,2)
      else 0::numeric(18,2)
    end as receita_total_calc,
    case when i.indireto_id is not null then pti.custo_taxas_calc else null::numeric end as custo_taxas_calc,
    case
      when coalesce(pr.item_custo_unit, snap.custo_unit) is not null and t.quantidade_alocada is not null
        then (coalesce(pr.item_custo_unit, snap.custo_unit) * t.quantidade_alocada)::numeric(14,2)
      else 0::numeric(14,2)
    end as custo_total_tarefa,
    coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'cor', e.cor, 'tipo', e.tipo, 'ordem', e.ordem,
                 'qtd_equipes', pte.qtd_equipes, 'producao_diaria_override', pte.producao_diaria_override,
                 'producao_diaria_equipe', ep.producao_diaria,
                 'producao_diaria_efetiva', coalesce(pr.producao_diaria_cpu, snap.producao_diaria_qtde) * t.qtd_equipes * t.coef_producao)
               order by e.ordem, e.nome)
        from public.planejamento_tarefa_equipe pte
        join public.equipe e on e.id = pte.equipe_id
        left join public.equipe_produtividade ep on ep.equipe_id = pte.equipe_id and ep.servico_id = i.servico_id
       where pte.tarefa_id = t.id), '[]'::jsonb) as equipes,
    coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'predecessora_id', d.predecessora_id, 'tipo', d.tipo, 'lag_dias', d.lag_dias,
                 'origem', d.origem, 'atraso_min', d.atraso_min, 'atraso_max', d.atraso_max, 'dias_uteis', d.dias_uteis))
        from public.planejamento_dependencia d where d.sucessora_id = t.id), '[]'::jsonb) as predecessoras,
    coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'sucessora_id', d.sucessora_id, 'tipo', d.tipo, 'lag_dias', d.lag_dias,
                 'origem', d.origem, 'atraso_min', d.atraso_min, 'atraso_max', d.atraso_max, 'dias_uteis', d.dias_uteis))
        from public.planejamento_dependencia d where d.predecessora_id = t.id), '[]'::jsonb) as sucessoras,
    coalesce((select jsonb_agg(jsonb_build_object('semana_segunda', ps.semana_segunda, 'quantidade_planejada', ps.quantidade_planejada) order by ps.semana_segunda)
        from public.planejamento_tarefa_perfil_semana ps where ps.tarefa_id = t.id), '[]'::jsonb) as perfil_semanas,
    t.trecho_id, tr.nome as trecho_nome, tr.ordem as trecho_ordem, t.posicao_inicio_m, t.posicao_fim_m, t.qtd_origem,
    case when t.trecho_id is not null and t.item_orcamentario_id is not null
      then public.trecho_servico_disponivel(t.trecho_id, t.item_orcamentario_id) else false end as trecho_disponivel,
    -- ApeX
    t.prioridade, t.asap, t.inicio_dia, t.sentido, t.restricao_inicio, t.restricao_inicio_em, t.restricao_fim, t.restricao_fim_em,
    t.coef_producao, t.qtd_equipes, t.calendario_id, t.derivar_predecessoras, t.aparencia,
    t.inicio_em, t.fim_em, t.folga_total_h, t.folga_livre_h, t.restricao_limite, t.violacoes,
    coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ordem', l.ordem, 'trecho_id', l.trecho_id, 'inicio_m', l.inicio_m,
                 'fim_m', l.fim_m, 'quantidade', l.quantidade, 'qtd_origem', l.qtd_origem, 'inicio_em', l.inicio_em, 'fim_em', l.fim_em,
                 'trecho_disponivel', case when l.trecho_id is not null and t.item_orcamentario_id is not null
                                           then public.trecho_servico_disponivel(l.trecho_id, t.item_orcamentario_id) else false end)
               order by l.ordem, l.inicio_m)
        from public.planejamento_tarefa_local l where l.tarefa_id = t.id), '[]'::jsonb) as locais
   from public.planejamento_tarefa t
   join public.planejamento p on p.id = t.planejamento_id
   left join public.item_orcamentario i on i.id = t.item_orcamentario_id
   left join public.servico s on s.id = i.servico_id
   left join public.vw_servico_vivo snap on snap.servico_id = i.servico_id
   left join public.planejamento_lb_premissa pr on pr.tarefa_id = t.id
   left join public.planejamento_tarefa_indireto pti on pti.tarefa_id = t.id
   left join public.obra_trecho tr on tr.id = t.trecho_id;

-- ═══ 5. Acompanhamento: planejado por dia vem do perfil diário (calendário real) ═════════════════════════════════
-- Tarefas sem perfil diário (calculadas pelo motor antigo) continuam pelo perfil semanal ÷ 5.
create or replace view public.vw_acompanhamento_curva_s as
 with baseline_meta as (
   select pl.obra_id, pt.item_orcamentario_id as item_id, io.codigo, io.descricao,
          sum(pt.quantidade_alocada)::numeric(14,4) as qtd_plan
     from public.planejamento pl
     join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
     join public.item_orcamentario io on io.id = pt.item_orcamentario_id
    where pl.id = public.planejamento_referencia(pl.obra_id) and pt.quantidade_alocada is not null
    group by pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao
 ), planejado_dia_raw as (
   select pl.obra_id, pt.item_orcamentario_id as item_id, pd.dia as data, pd.quantidade as planejado_dia
     from public.planejamento pl
     join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
     join public.planejamento_tarefa_perfil_dia pd on pd.tarefa_id = pt.id
    where pl.id = public.planejamento_referencia(pl.obra_id)
   union all
   select pl.obra_id, pt.item_orcamentario_id, (ps.semana_segunda + (i.i || ' days')::interval)::date, ps.quantidade_planejada / 5.0
     from public.planejamento pl
     join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
     join public.planejamento_tarefa_perfil_semana ps on ps.tarefa_id = pt.id
     cross join generate_series(0, 4) i(i)
    where pl.id = public.planejamento_referencia(pl.obra_id)
      and not exists (select 1 from public.planejamento_tarefa_perfil_dia x where x.tarefa_id = pt.id)
 ), real_dia as (
   select p.obra_id, p.item_orcamentario_id as item_id, p.data, sum(p.quantidade * p.fator_conversao) as qtd
     from public.acompanhamento_producao p
    where p.item_orcamentario_id is not null
    group by p.obra_id, p.item_orcamentario_id, p.data
 ), todos_pares as (
   select obra_id, item_id, data from planejado_dia_raw
   union
   select obra_id, item_id, data from real_dia
 ), agregado as (
   select tp.obra_id, tp.item_id, tp.data,
          coalesce((select sum(pp.planejado_dia) from planejado_dia_raw pp
                     where pp.obra_id = tp.obra_id and pp.item_id = tp.item_id and pp.data = tp.data), 0::numeric) as planejado_dia,
          coalesce((select rd.qtd from real_dia rd
                     where rd.obra_id = tp.obra_id and rd.item_id = tp.item_id and rd.data = tp.data), 0::numeric) as realizado_dia
     from todos_pares tp
 )
 select a.obra_id, a.item_id as item_orcamentario_id, bm.codigo as servico_grupo_codigo, bm.descricao as servico_grupo_descricao,
        a.data, a.planejado_dia,
        sum(a.planejado_dia) over (partition by a.obra_id, a.item_id order by a.data) as planejado_acumulado,
        a.realizado_dia,
        sum(a.realizado_dia) over (partition by a.obra_id, a.item_id order by a.data) as realizado_acumulado,
        bm.qtd_plan as qtd_planejada_total
   from agregado a
   left join baseline_meta bm on bm.obra_id = a.obra_id and bm.item_id = a.item_id;

create or replace view public.vw_acompanhamento_previsto_x_realizado as
 with baseline as (
   select pl.obra_id, min(pt.id::text)::uuid as tarefa_id, pt.item_orcamentario_id as item_id,
          min(pt.data_inicio) as data_inicio, max(pt.data_fim) as data_fim,
          io.codigo as servico_grupo_codigo, io.descricao as servico_grupo_descricao,
          sum(pt.quantidade_alocada)::numeric(14,4) as quantidade_planejada, io.unidade_referencia as unidade,
          snap.producao_diaria_qtde as producao_diaria_cpu,
          case when coalesce(sum(pt.duracao_dias_uteis_calc), 0) > 0
               then (sum(pt.quantidade_alocada) / sum(pt.duracao_dias_uteis_calc))::numeric(14,4) end as producao_diaria_plan
     from public.planejamento pl
     join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
     join public.item_orcamentario io on io.id = pt.item_orcamentario_id
     left join public.vw_servico_vivo snap on snap.servico_id = io.servico_id
    where pl.id = public.planejamento_referencia(pl.obra_id) and io.indireto_id is null
    group by pl.obra_id, pt.item_orcamentario_id, io.codigo, io.descricao, io.unidade_referencia, snap.producao_diaria_qtde
 ), plan_periodo as (
   select x.obra_id, x.item_id, sum(x.q)::numeric(14,4) as qtd_plan_periodo
     from (
       select pl.obra_id, pt.item_orcamentario_id as item_id, pd.quantidade as q
         from public.planejamento pl
         join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
         join public.planejamento_tarefa_perfil_dia pd on pd.tarefa_id = pt.id
        where pl.id = public.planejamento_referencia(pl.obra_id) and pd.dia <= current_date
       union all
       select pl.obra_id, pt.item_orcamentario_id, (ps.quantidade_planejada / 5.0) * least(5, greatest(0, (current_date - ps.semana_segunda) + 1))::numeric
         from public.planejamento pl
         join public.planejamento_tarefa pt on pt.planejamento_id = pl.id
         join public.planejamento_tarefa_perfil_semana ps on ps.tarefa_id = pt.id
        where pl.id = public.planejamento_referencia(pl.obra_id)
          and not exists (select 1 from public.planejamento_tarefa_perfil_dia y where y.tarefa_id = pt.id)
     ) x
    group by x.obra_id, x.item_id
 ), realizado as (
   select p.obra_id, p.item_orcamentario_id as item_id, sum(p.quantidade * p.fator_conversao) as quantidade_realizada,
          count(distinct p.data) as dias_realizado, min(p.data) as data_primeira, max(p.data) as data_ultima
     from public.acompanhamento_producao p
    where p.item_orcamentario_id is not null
    group by p.obra_id, p.item_orcamentario_id
 )
 select b.obra_id, b.tarefa_id, b.item_id as item_orcamentario_id, b.servico_grupo_codigo as codigo, b.servico_grupo_descricao as descricao,
        b.unidade, b.quantidade_planejada as qtd_plan, coalesce(r.quantidade_realizada, 0) as qtd_real,
        case when b.quantidade_planejada is null or b.quantidade_planejada = 0 then null
             else round(coalesce(r.quantidade_realizada, 0) / b.quantidade_planejada, 4) end as pct_avanco,
        b.data_inicio as data_inicio_plan, b.data_fim as data_fim_plan,
        case when b.data_fim is null or b.data_inicio is null then null else greatest(1, (b.data_fim - b.data_inicio) + 1) end as dias_plan,
        r.dias_realizado as dias_real, r.data_primeira as data_primeira_realizacao, r.data_ultima as data_ultima_realizacao,
        case when b.quantidade_planejada is null or b.quantidade_planejada = 0 then null
             else least(1, round(coalesce(pp.qtd_plan_periodo, 0) / b.quantidade_planejada, 4)) end as pct_esperado_hoje,
        case
          when b.data_fim is null then null
          when r.data_ultima is null then null
          when coalesce(b.producao_diaria_plan, b.producao_diaria_cpu) is null or coalesce(b.producao_diaria_plan, b.producao_diaria_cpu) = 0 then null
          else b.data_fim - (r.data_ultima + ceil(greatest(0, b.quantidade_planejada - coalesce(r.quantidade_realizada, 0)) / coalesce(b.producao_diaria_plan, b.producao_diaria_cpu))::int)
        end as desvio_dias_estimado,
        case
          when b.quantidade_planejada is null then 'sem_plano'
          when r.quantidade_realizada is null then 'nao_iniciado'
          when r.quantidade_realizada >= b.quantidade_planejada then 'concluido'
          when b.data_inicio is null or b.data_fim is null then 'em_andamento'
          when current_date > b.data_fim then 'atrasado'
          when coalesce(pp.qtd_plan_periodo, 0) <= 0 then 'em_andamento'
          else case
            when coalesce(r.quantidade_realizada, 0) / nullif(pp.qtd_plan_periodo, 0) >= 1.05 then 'adiantado'
            when coalesce(r.quantidade_realizada, 0) / nullif(pp.qtd_plan_periodo, 0) < 0.7 then 'atrasado'
            when coalesce(r.quantidade_realizada, 0) / nullif(pp.qtd_plan_periodo, 0) < 0.95 then 'em_risco'
            else 'no_prazo' end
        end as status,
        coalesce(pp.qtd_plan_periodo, 0) as qtd_plan_periodo,
        coalesce(b.producao_diaria_plan, b.producao_diaria_cpu) as producao_diaria_plan
   from baseline b
   left join plan_periodo pp on pp.obra_id = b.obra_id and pp.item_id = b.item_id
   left join realizado r on r.obra_id = b.obra_id and r.item_id = b.item_id;
