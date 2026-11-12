-- Limpeza do esquema: tabelas, views, funções, colunas, índices e uma extensão que nada usa mais (web, MCP, app de
-- campo, Edge Functions e o próprio banco). Levantamento por referência cruzada do catálogo com o código.
--
--  - tabelas: obra_calendario(+excecao) (substituídas por calendario/calendario_definicao), planejamento_baseline_snapshot
--    (as LBs congelam em planejamento_lb_premissa), equipe_produtividade (nunca gravada), cpu_snapshot (nunca gravada);
--  - views: heatmap dia × serviço e custo agregado do serviço;
--  - colunas: hodômetro da ficha, tributação antiga da obra, CPM antigo da tarefa (early/late/float, modo, restrição),
--    lag_dias (= atraso_min), override de produção por equipe, apelidos da era SIGA nas views.

-- ── views que dependem do que sai ────────────────────────────────────────────────────────────────────
drop view if exists public.vw_acompanhamento_heatmap_dia_servico;
drop view if exists public.vw_servico_custo_agregado;
drop view if exists public.vw_planejamento_tarefa_completa;
drop view if exists public.vw_acompanhamento_produtividade_equipe;

-- ── funções que citavam o que sai ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.excluir_obra(_obra_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform set_config('infrawork.excluindo_obra', '1', true);
  -- ordem: as chaves NO ACTION entre ramos da cascata (tarefa → equipe, item de CPU → recurso, item do orçamento →
  -- serviço, viagem → item) são conferidas no fim de cada comando aninhado da cascata
  delete from public.viagem_ficha where obra_id = _obra_id;
  delete from public.planejamento where obra_id = _obra_id;
  delete from public.cpu where obra_id = _obra_id;
  delete from public.item_orcamentario where obra_id = _obra_id;
  delete from public.obras where id = _obra_id;
  perform set_config('infrawork.excluindo_obra', '', true);
end $function$;

CREATE OR REPLACE FUNCTION public.planejamento_promover(_planejamento_id uuid, _marcar_vigente boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p record; v_vig uuid; marcar boolean; n_folhas int;
begin
  if public.auth_role() not in ('god', 'adm', 'engenheiro') then raise exception 'Sem permissão para travar linhas de base'; end if;
  select * into p from public.planejamento where id = _planejamento_id for update;
  if p.id is null then raise exception 'Plano não encontrado'; end if;
  if not public.pode_planejar_obra(p.obra_id) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if p.is_baseline then raise exception 'Este plano já é uma linha de base.'; end if;
  select count(*) into n_folhas from public.planejamento_tarefa where planejamento_id = p.id and tipo_no = 'tarefa';
  if n_folhas > 0 and (p.calculo_rev is distinct from p.dados_rev or p.recalculo_pendente) then
    raise exception 'Cronograma desatualizado: abra o cronograma do plano e aguarde o cálculo terminar antes de travar a linha de base.';
  end if;

  update public.planejamento set is_baseline = true, status = 'ativo' where id = p.id;
  perform public.lb_capturar_premissas(p.id);

  select id into v_vig from public.planejamento where obra_id = p.obra_id and vigente;
  marcar := coalesce(_marcar_vigente, v_vig is null);
  if marcar then
    if v_vig is not null then update public.planejamento set vigente = false where id = v_vig; end if;
    update public.planejamento set vigente = true where id = p.id;
  end if;
  return jsonb_build_object('ok', true, 'baseline_id', p.id, 'vigente', marcar);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_item_orc_linha_calc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.snapshot_orcamento_atual(_obra_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'obra', (select to_jsonb(o) from public.obras o where o.id = _obra_id),
    'itens', coalesce(
      (select jsonb_agg(to_jsonb(i) order by i.codigo)
         from public.item_orcamentario i
        where i.obra_id = _obra_id),
      '[]'::jsonb
    ),
    'alocacoes', coalesce(
      (select jsonb_agg(to_jsonb(a))
         from public.item_orc_alocacao a
        where a.obra_id = _obra_id),
      '[]'::jsonb
    ),
    'indireto', coalesce(
      (select jsonb_agg(to_jsonb(ii) order by ii.codigo)
         from public.indireto_item ii
        where ii.obra_id = _obra_id),
      '[]'::jsonb
    ),
    'totais', jsonb_build_object(
      'custo_direto',
        (select coalesce(sum(custo_total_calc), 0)
           from public.item_orcamentario
          where obra_id = _obra_id and tipo = 'servico_grupo'),
      'venda_total',
        (select coalesce(sum(venda_total_calc), 0)
           from public.item_orcamentario
          where obra_id = _obra_id and parent_id is null and tipo <> 'servico_grupo'),
      'indireto_total',
        (select coalesce(sum(valor_total * distribuicao_perc), 0)
           from public.indireto_item
          where obra_id = _obra_id)
    ),
    'gerado_em', now()
  )
$function$;

CREATE OR REPLACE FUNCTION public.fn_tarefa_clonar(_tarefa_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t record; v_novo uuid; v_nome text; m text[];
begin
  select * into t from public.planejamento_tarefa where id = _tarefa_id;
  update public.planejamento_tarefa set ordem = ordem + 1
   where planejamento_id = t.planejamento_id and parent_id is not distinct from t.parent_id and ordem > t.ordem;
  -- nome: "X" → "X 2"; "X 3" → "X 4"
  v_nome := t.nome_custom;
  if v_nome is not null then
    m := regexp_match(v_nome, '^(.*\S)\s+(\d+)$');
    if m is not null then v_nome := m[1] || ' ' || (m[2]::int + 1); else v_nome := v_nome || ' 2'; end if;
  end if;
  insert into public.planejamento_tarefa (
    planejamento_id, item_orcamentario_id, tipo_no, parent_id, nivel, nome_custom, notas, ordem,
    prioridade, asap, inicio_dia, sentido, restricao_inicio, restricao_inicio_em, restricao_fim, restricao_fim_em,
    coef_producao, qtd_equipes, calendario_id, derivar_predecessoras, aparencia, inicio_em)
  values (
    t.planejamento_id, t.item_orcamentario_id, 'tarefa', t.parent_id, t.nivel, v_nome, t.notas, t.ordem + 1,
    t.prioridade, t.asap, t.inicio_dia, t.sentido, t.restricao_inicio, t.restricao_inicio_em, t.restricao_fim, t.restricao_fim_em,
    t.coef_producao, t.qtd_equipes, t.calendario_id, t.derivar_predecessoras, t.aparencia, t.inicio_em)
  returning id into v_novo;
  insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes)
  select v_novo, e.equipe_id, e.qtd_equipes from public.planejamento_tarefa_equipe e where e.tarefa_id = _tarefa_id;
  insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, origem, atraso_min, atraso_max, dias_uteis, aparencia)
  select d.planejamento_id, d.predecessora_id, v_novo, d.tipo, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
    from public.planejamento_dependencia d where d.sucessora_id = _tarefa_id
  on conflict (predecessora_id, sucessora_id) do nothing;
  insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, origem, atraso_min, atraso_max, dias_uteis, aparencia)
  select d.planejamento_id, v_novo, d.sucessora_id, d.tipo, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
    from public.planejamento_dependencia d where d.predecessora_id = _tarefa_id
  on conflict (predecessora_id, sucessora_id) do nothing;
  return v_novo;
end $function$;

CREATE OR REPLACE FUNCTION public.planejamento_copiar(_origem_id uuid, _nome text, _inicio date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o record; v_novo uuid; n_t int := 0; n_d int := 0; k int; nv int;
begin
  if public.auth_role() not in ('god', 'adm', 'engenheiro') then raise exception 'Sem permissão para criar planos'; end if;
  select * into o from public.planejamento where id = _origem_id;
  if o.id is null then raise exception 'Plano de origem não encontrado'; end if;
  if not public.pode_planejar_obra(o.obra_id) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if coalesce(btrim(_nome), '') = '' then raise exception 'Informe o nome do plano'; end if;
  if exists (select 1 from public.planejamento where obra_id = o.obra_id and not is_baseline) then
    raise exception 'Já existe um plano em edição nesta obra — trave-o como linha de base ou exclua-o antes.';
  end if;
  if exists (select 1 from public.planejamento where obra_id = o.obra_id and nome = btrim(_nome)) then
    raise exception 'Já existe um plano com o nome "%" nesta obra.', btrim(_nome);
  end if;

  insert into public.planejamento (obra_id, nome, descricao, is_baseline, status, data_referencia_inicio, prazo, calendario_id, modo, data_date, criado_por)
  values (o.obra_id, btrim(_nome), o.descricao, false, 'ativo', coalesce(_inicio, o.data_referencia_inicio), o.prazo, o.calendario_id, o.modo, o.data_date, auth.uid())
  returning id into v_novo;

  create temporary table if not exists _mapa_tarefa (velho uuid primary key, novo uuid not null) on commit drop;
  truncate _mapa_tarefa;
  insert into _mapa_tarefa (velho, novo) select id, gen_random_uuid() from public.planejamento_tarefa where planejamento_id = _origem_id;

  for nv in select distinct nivel from public.planejamento_tarefa where planejamento_id = _origem_id order by nivel loop
    insert into public.planejamento_tarefa (
      id, planejamento_id, item_orcamentario_id, tipo_no, parent_id, nivel, codigo_eap, nome_custom, quantidade_alocada, notas, ordem,
      prioridade, asap, inicio_dia, sentido, restricao_inicio, restricao_inicio_em, restricao_fim, restricao_fim_em, coef_producao,
      qtd_equipes, calendario_id, derivar_predecessoras, aparencia, inicio_em)
    select m.novo, v_novo, t.item_orcamentario_id, t.tipo_no, pm.novo, t.nivel, t.codigo_eap, t.nome_custom, t.quantidade_alocada, t.notas, t.ordem,
           t.prioridade, t.asap, t.inicio_dia, t.sentido, t.restricao_inicio, t.restricao_inicio_em, t.restricao_fim, t.restricao_fim_em, t.coef_producao,
           t.qtd_equipes, t.calendario_id, t.derivar_predecessoras, t.aparencia, t.inicio_em
      from public.planejamento_tarefa t
      join _mapa_tarefa m on m.velho = t.id
      left join _mapa_tarefa pm on pm.velho = t.parent_id
     where t.planejamento_id = _origem_id and t.nivel = nv and t.tipo_no in ('tarefa', 'grupo');
    get diagnostics k = row_count;
    n_t := n_t + k;
  end loop;

  -- locais "do template" que ficaram indisponíveis viram manuais (a cópia não pode falhar por isso)
  perform set_config('infrawork.copia_plano', '1', true);
  insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
  select m.novo, v_novo, l.ordem, l.trecho_id, l.inicio_m, l.fim_m, l.quantidade, l.qtd_origem
    from public.planejamento_tarefa_local l join _mapa_tarefa m on m.velho = l.tarefa_id
   where l.planejamento_id = _origem_id
   order by l.tarefa_id, l.ordem;
  perform set_config('infrawork.copia_plano', '', true);

  insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, origem, atraso_min, atraso_max, dias_uteis, aparencia)
  select v_novo, a.novo, b.novo, d.tipo, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
    from public.planejamento_dependencia d
    join _mapa_tarefa a on a.velho = d.predecessora_id
    join _mapa_tarefa b on b.velho = d.sucessora_id
   where d.planejamento_id = _origem_id;
  get diagnostics n_d = row_count;

  insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes)
  select m.novo, e.equipe_id, e.qtd_equipes
    from public.planejamento_tarefa_equipe e join _mapa_tarefa m on m.velho = e.tarefa_id;

  insert into public.planejamento_tarefa_indireto (
    tarefa_id, custo_periodicidade, custo_unitario, receita_modo, receita_unitaria, receita_percentual,
    offset_dias_antes, offset_dias_depois, receita_extrapola, aplica_taxas, taxa_regime_id)
  select m.novo, i.custo_periodicidade, i.custo_unitario, i.receita_modo, i.receita_unitaria, i.receita_percentual,
         i.offset_dias_antes, i.offset_dias_depois, i.receita_extrapola, i.aplica_taxas, i.taxa_regime_id
    from public.planejamento_tarefa_indireto i join _mapa_tarefa m on m.velho = i.tarefa_id;

  insert into public.planejamento_marco (planejamento_id, nome, descricao, inicio, fim, filtro_servicos, servicos, filtro_recursos, recursos,
                                         filtro_estacas, faixas, incluidas, excluidas, aparencia, ordem)
  select v_novo, mc.nome, mc.descricao, mc.inicio, mc.fim, mc.filtro_servicos, mc.servicos, mc.filtro_recursos, mc.recursos,
         mc.filtro_estacas, mc.faixas,
         coalesce((select array_agg(m.novo) from unnest(mc.incluidas) x join _mapa_tarefa m on m.velho = x), '{}'),
         coalesce((select array_agg(m.novo) from unnest(mc.excluidas) x join _mapa_tarefa m on m.velho = x), '{}'),
         mc.aparencia, mc.ordem
    from public.planejamento_marco mc where mc.planejamento_id = _origem_id;

  insert into public.planejamento_recurso_limite (planejamento_id, recurso_id, grupo_id, maximo)
  select v_novo, l.recurso_id, m.novo, l.maximo
    from public.planejamento_recurso_limite l left join _mapa_tarefa m on m.velho = l.grupo_id
   where l.planejamento_id = _origem_id and (l.grupo_id is null or m.novo is not null);

  return jsonb_build_object('ok', true, 'novo_id', v_novo, 'tarefas_copiadas', n_t, 'dependencias_copiadas', n_d, 'tarefas_ajustadas', 0);
end $function$;

CREATE OR REPLACE FUNCTION public.planejamento_tarefas_combinar(_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_kept uuid; v_plan uuid; a record; l record; cur_tr uuid; cur_ini numeric; cur_fim numeric; cur_q numeric; cur_tpl boolean;
  cur_area boolean; k int := 0; x uuid;
begin
  if _ids is null or array_length(_ids, 1) < 2 then raise exception 'Escolha ao menos duas tarefas'; end if;
  select id into v_kept from public.planejamento_tarefa where id = any(_ids) order by nivel, ordem, created_at limit 1;
  a := public.fn_tarefa_assert_editavel(v_kept);
  v_plan := a.planejamento_id;
  if (select count(distinct planejamento_id) from public.planejamento_tarefa where id = any(_ids)) <> 1
     or (select count(*) from public.planejamento_tarefa where id = any(_ids)) <> array_length(_ids, 1) then
    raise exception 'As tarefas precisam ser do mesmo plano';
  end if;
  if exists (select 1 from public.planejamento_tarefa where id = any(_ids) and tipo_no <> 'tarefa') then
    raise exception 'Só tarefas (não tarefas-resumo) se combinam';
  end if;
  if (select count(distinct item_orcamentario_id) from public.planejamento_tarefa where id = any(_ids)) <> 1 then
    raise exception 'Só tarefas do mesmo serviço podem ser combinadas';
  end if;
  if (select count(distinct coalesce((select string_agg(distinct coalesce(l2.trecho_id::text, '-'), ',' order by coalesce(l2.trecho_id::text, '-'))
                                        from public.planejamento_tarefa_local l2 where l2.tarefa_id = t.id), ''))
        from public.planejamento_tarefa t where t.id = any(_ids)) <> 1 then
    raise exception 'Só tarefas nos mesmos trechos podem ser combinadas';
  end if;

  create temporary table if not exists _fundir (ordem int, trecho_id uuid, inicio_m numeric, fim_m numeric, quantidade numeric, tpl boolean) on commit drop;
  truncate _fundir;
  cur_tr := null; cur_ini := null;
  for l in select * from public.planejamento_tarefa_local where tarefa_id = any(_ids)
            order by coalesce(trecho_id::text, ''), inicio_m nulls first, fim_m loop
    cur_area := l.inicio_m is null;
    if cur_ini is null and not cur_area then
      cur_tr := l.trecho_id; cur_ini := l.inicio_m; cur_fim := l.fim_m; cur_q := l.quantidade; cur_tpl := l.qtd_origem = 'trecho';
      continue;
    end if;
    if cur_area then
      -- área ou sem trecho: uma linha por trecho, somando
      if exists (select 1 from _fundir f where f.trecho_id is not distinct from l.trecho_id and f.inicio_m is null) then
        update _fundir set quantidade = quantidade + l.quantidade, tpl = tpl and l.qtd_origem = 'trecho'
         where trecho_id is not distinct from l.trecho_id and inicio_m is null;
      else
        insert into _fundir values (k, l.trecho_id, null, null, l.quantidade, l.qtd_origem = 'trecho'); k := k + 1;
      end if;
      continue;
    end if;
    -- faixas que se cruzam ou se encostam no mesmo eixo viram uma só (o ApeX só funde as que se cruzam; aqui um local
    -- contínuo é mais útil, e o motor divide pelos segmentos do template de qualquer jeito)
    if l.trecho_id = cur_tr and l.inicio_m <= cur_fim + 0.005 then
      cur_fim := greatest(cur_fim, l.fim_m); cur_q := cur_q + l.quantidade; cur_tpl := cur_tpl and l.qtd_origem = 'trecho';
    else
      insert into _fundir values (k, cur_tr, cur_ini, cur_fim, cur_q, cur_tpl); k := k + 1;
      cur_tr := l.trecho_id; cur_ini := l.inicio_m; cur_fim := l.fim_m; cur_q := l.quantidade; cur_tpl := l.qtd_origem = 'trecho';
    end if;
  end loop;
  if cur_ini is not null then insert into _fundir values (k, cur_tr, cur_ini, cur_fim, cur_q, cur_tpl); end if;

  -- dependências e equipes das absorvidas passam para a que fica; depois elas saem (antes de inserir os locais fundidos:
  -- o teto do serviço conta as quantidades das absorvidas enquanto existirem)
  foreach x in array _ids loop
    if x = v_kept then continue; end if;
    insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, origem, atraso_min, atraso_max, dias_uteis, aparencia)
    select d.planejamento_id, d.predecessora_id, v_kept, d.tipo, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
      from public.planejamento_dependencia d where d.sucessora_id = x and d.predecessora_id <> all(_ids)
    on conflict (predecessora_id, sucessora_id) do nothing;
    insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, origem, atraso_min, atraso_max, dias_uteis, aparencia)
    select d.planejamento_id, v_kept, d.sucessora_id, d.tipo, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
      from public.planejamento_dependencia d where d.predecessora_id = x and d.sucessora_id <> all(_ids)
    on conflict (predecessora_id, sucessora_id) do nothing;
    insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes)
    select v_kept, e.equipe_id, e.qtd_equipes from public.planejamento_tarefa_equipe e where e.tarefa_id = x
    on conflict do nothing;
  end loop;
  update public.planejamento_tarefa set inicio_em = (select min(inicio_em) from public.planejamento_tarefa where id = any(_ids)) where id = v_kept;
  delete from public.planejamento_tarefa where id = any(_ids) and id <> v_kept;
  delete from public.planejamento_tarefa_local where tarefa_id = v_kept;
  perform set_config('infrawork.locais_lote', '1', true);
  insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
  select v_kept, v_plan, f.ordem, f.trecho_id, f.inicio_m, f.fim_m, f.quantidade, case when f.tpl then 'trecho' else 'manual' end
    from _fundir f order by f.ordem;
  perform set_config('infrawork.locais_lote', '', true);
  perform public.fn_locais_validar(v_kept);
  return v_kept;
end $function$;

CREATE OR REPLACE FUNCTION public.planejamento_gravar_calculo(_planejamento_id uuid, _dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    is_critico = x.critico, restricao_limite = x.restricao_limite, violacoes = x.violacoes,
    -- indiretos: a quantidade é o número de períodos cobertos (como no motor antigo)
    quantidade_alocada = coalesce(x.quantidade, t.quantidade_alocada)
  from jsonb_to_recordset(coalesce(_dados->'tarefas', '[]'::jsonb)) as x(
    id uuid, inicio_em timestamp, fim_em timestamp, data_inicio date, data_fim date, duracao_dias_uteis numeric,
    folga_total_h numeric, folga_livre_h numeric, critico boolean,
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
end $function$;

CREATE OR REPLACE FUNCTION public.acompanhamento_alertas_sincronizar(p_obra_id uuid, p_alertas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_resolvidos int := 0;
  v_atualizados int := 0;
  v_reabertos int := 0;
  v_inseridos int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('acompanhamento_alertas:' || p_obra_id::text));

  if to_regclass('pg_temp._alerta_novo') is null then
    create temp table _alerta_novo (
      chave text primary key,
      tipo text,
      severidade text,
      titulo text,
      descricao text,
      contexto jsonb
    ) on commit drop;
  else
    truncate _alerta_novo;
  end if;

  insert into _alerta_novo
  select distinct on (x.chave) x.chave, x.tipo, x.severidade, x.titulo, x.descricao, coalesce(x.contexto, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_alertas, '[]'::jsonb))
         as x(chave text, tipo text, severidade text, titulo text, descricao text, contexto jsonb)
   where coalesce(x.chave, '') <> ''
   order by x.chave;

  -- deixou de existir: aberto (ou silenciado vencido) vira resolvido automaticamente
  update public.acompanhamento_alerta a
     set status = 'resolvido', resolvido_em = now(), resolvido_automaticamente = true, silenciado_ate = null
   where a.obra_id = p_obra_id
     and (a.status = 'aberto' or (a.status = 'silenciado' and a.silenciado_ate is not null and a.silenciado_ate <= now()))
     and not exists (select 1 from _alerta_novo n where n.chave = a.chave);
  get diagnostics v_resolvidos = row_count;

  -- continua aberto: atualiza os números, mantém criado_em
  update public.acompanhamento_alerta a
     set severidade = n.severidade, titulo = n.titulo, descricao = n.descricao, contexto = n.contexto, updated_at = now()
    from _alerta_novo n
   where a.obra_id = p_obra_id and a.status = 'aberto' and a.chave = n.chave
     and (a.severidade, a.titulo, a.descricao, a.contexto) is distinct from (n.severidade, n.titulo, n.descricao, n.contexto);
  get diagnostics v_atualizados = row_count;

  -- silenciamento venceu e a condição continua: reabre o mesmo alerta
  update public.acompanhamento_alerta a
     set status = 'aberto', silenciado_ate = null,
         severidade = n.severidade, titulo = n.titulo, descricao = n.descricao, contexto = n.contexto, updated_at = now()
    from _alerta_novo n
   where a.id in (
           select distinct on (s.chave) s.id
             from public.acompanhamento_alerta s
            where s.obra_id = p_obra_id and s.status = 'silenciado'
              and s.silenciado_ate is not null and s.silenciado_ate <= now()
            order by s.chave, s.silenciado_ate desc
         )
     and a.chave = n.chave
     and not exists (
           select 1 from public.acompanhamento_alerta o
            where o.obra_id = p_obra_id and o.chave = a.chave and o.status = 'aberto'
         );
  get diagnostics v_reabertos = row_count;

  -- novo: só se não houver aberto, silenciado ou resolvido à mão com a mesma chave
  insert into public.acompanhamento_alerta (obra_id, chave, tipo, severidade, titulo, descricao, contexto)
  select p_obra_id, n.chave, n.tipo, n.severidade, n.titulo, n.descricao, n.contexto
    from _alerta_novo n
   where not exists (
           select 1 from public.acompanhamento_alerta a
            where a.obra_id = p_obra_id and a.chave = n.chave
              and (a.status in ('aberto', 'silenciado')
                   or (a.status = 'resolvido' and a.resolvido_automaticamente = false))
         );
  get diagnostics v_inseridos = row_count;

  return jsonb_build_object(
    'inseridos', v_inseridos,
    'atualizados', v_atualizados,
    'reabertos', v_reabertos,
    'resolvidos', v_resolvidos,
    'abertos', (select count(*) from public.acompanhamento_alerta where obra_id = p_obra_id and status = 'aberto')
  );
end $function$;

-- ── tabelas ──────────────────────────────────────────────────────────────────────────────────────────
-- a obra nova continua nascendo com o calendário padrão; só sai a gravação na tabela antiga
create or replace function public.fn_obra_calendario_default()
returns trigger
language plpgsql
as $$
begin
  insert into public.calendario (obra_id, nome, padrao) values (new.id, 'Calendário da obra', true)
    on conflict (obra_id, nome) do nothing;
  return new;
end $$;
drop table if exists public.obra_calendario_excecao;
drop table if exists public.obra_calendario;
drop table if exists public.planejamento_baseline_snapshot;
drop table if exists public.equipe_produtividade;
drop function if exists public.fn_equipe_prod_mesma_obra();

alter table public.item_orcamentario drop constraint if exists chk_item_orc_tipo_coerencia;
alter table public.item_orcamentario drop column if exists cpu_snapshot_id;
alter table public.item_orcamentario add constraint chk_item_orc_tipo_coerencia check (
  (tipo = 'receita' and unidade is not null and quantidade is not null and venda_unitaria is not null
     and servico_id is null and indireto_id is null and quantidade_referencia is null and unidade_referencia is null
     and qtd_ref_modo is null and qtd_ref_filhos is null)
  or (tipo = 'servico_grupo' and not (servico_id is not null and indireto_id is not null)
     and quantidade_referencia is not null and qtd_ref_modo is not null
     and (unidade_referencia is not null or (servico_id is null and indireto_id is null))
     and unidade is null and quantidade is null and venda_unitaria is null)
  or (tipo = 'etapa' and servico_id is null and indireto_id is null and quantidade_referencia is null
     and unidade_referencia is null and qtd_ref_modo is null and qtd_ref_filhos is null
     and unidade is null and quantidade is null and venda_unitaria is null)
);
drop table if exists public.cpu_snapshot;
drop function if exists public.fn_cpu_snapshot_imutavel();

-- ── funções órfãs ────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.acomp_alerta_obra(uuid);
drop function if exists public.acomp_foto_obra(uuid);
drop function if exists public.comentario_obra(uuid);
drop function if exists public.cpu_snap_obra(uuid);
drop function if exists public.dependencia_obra(uuid);
drop function if exists public.encargos_obra(uuid);
drop function if exists public.encarregado_obra(uuid);
drop function if exists public.indireto_obra(uuid);
drop function if exists public.item_orc_obra(uuid);
drop function if exists public.memoria_obra(uuid);
drop function if exists public.servico_cpu_link_obra(uuid);
drop function if exists public.equipe_obra(uuid);
drop function if exists public.cronograma_validar_ciclo(uuid);
drop function if exists public.fn_orc_marca_obra();

-- ── colunas ──────────────────────────────────────────────────────────────────────────────────────────
alter table public.viagem_ficha drop constraint if exists chk_ficha_km;
alter table public.viagem_ficha drop column if exists km_inicial, drop column if exists km_final;

alter table public.obras
  drop column if exists regime_tributario,
  drop column if exists aliquota_iss_perc,
  drop column if exists aliquota_pis_perc,
  drop column if exists aliquota_cofins_perc,
  drop column if exists aliquota_outros_perc,
  drop column if exists status_orcamento;

-- o gatilho da LB travada listava colunas que saem: recria sem elas
drop trigger if exists trg_baseline_imutavel_tarefa on public.planejamento_tarefa;
create trigger trg_baseline_imutavel_tarefa
  before delete or update of item_orcamentario_id, notas, ordem, tipo_no, parent_id, nivel, quantidade_alocada, codigo_eap,
    nome_custom, prioridade, asap, inicio_dia, sentido, restricao_inicio, restricao_inicio_em, restricao_fim, restricao_fim_em,
    coef_producao, qtd_equipes, derivar_predecessoras, inicio_em
  on public.planejamento_tarefa
  for each row execute function public.fn_planejamento_baseline_imutavel();

alter table public.planejamento_tarefa
  drop column if exists data_inicio_manual,
  drop column if exists early_start,
  drop column if exists early_finish,
  drop column if exists late_start,
  drop column if exists late_finish,
  drop column if exists total_float,
  drop column if exists free_float,
  drop column if exists schedule_mode,
  drop column if exists constraint_type,
  drop column if exists constraint_date;

alter table public.planejamento_dependencia drop column if exists lag_dias;
alter table public.planejamento_tarefa_equipe drop column if exists producao_diaria_override;
alter table public.acompanhamento_alerta drop column if exists contexto_hash, drop column if exists silenciado_por;
alter table public.encarregado drop column if exists profile_id;

-- valores que nada produz
alter table public.planejamento_dependencia drop constraint if exists chk_plan_dep_origem;
alter table public.planejamento_dependencia add constraint chk_plan_dep_origem check (origem = 'manual');
alter table public.planejamento drop constraint if exists chk_planejamento_status;
alter table public.planejamento add constraint chk_planejamento_status check (status in ('rascunho', 'ativo'));

-- ── views recriadas sem as colunas que saíram ────────────────────────────────────────────────────────
create view public.vw_planejamento_tarefa_completa with (security_invoker = true) as
SELECT t.id,
    t.planejamento_id,
    t.item_orcamentario_id,
    t.data_inicio,
    t.data_fim,
    t.duracao_dias_uteis_calc,
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
    t.is_critico,
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
    snap.cpu_id AS cpu_id_origem,
    COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde) AS producao_diaria_qtde,
    snap.producao_diaria_unidade,
    COALESCE(pr.item_custo_unit, snap.custo_unit)::numeric(14,4) AS custo_unit_snapshot,
    COALESCE(pr.producao_diaria_efetiva, COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde) * t.qtd_equipes::numeric * t.coef_producao) AS producao_diaria_efetiva,
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
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'cor', e.cor, 'tipo', e.tipo, 'ordem', e.ordem, 'qtd_equipes', pte.qtd_equipes, 'producao_diaria_efetiva', COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde) * t.qtd_equipes::numeric * t.coef_producao) ORDER BY e.ordem, e.nome) AS jsonb_agg
           FROM planejamento_tarefa_equipe pte
             JOIN equipe e ON e.id = pte.equipe_id
          WHERE pte.tarefa_id = t.id), '[]'::jsonb) AS equipes,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', d.id, 'predecessora_id', d.predecessora_id, 'tipo', d.tipo, 'origem', d.origem, 'atraso_min', d.atraso_min, 'atraso_max', d.atraso_max, 'dias_uteis', d.dias_uteis)) AS jsonb_agg
           FROM planejamento_dependencia d
          WHERE d.sucessora_id = t.id), '[]'::jsonb) AS predecessoras,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', d.id, 'sucessora_id', d.sucessora_id, 'tipo', d.tipo, 'origem', d.origem, 'atraso_min', d.atraso_min, 'atraso_max', d.atraso_max, 'dias_uteis', d.dias_uteis)) AS jsonb_agg
           FROM planejamento_dependencia d
          WHERE d.predecessora_id = t.id), '[]'::jsonb) AS sucessoras,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('semana_segunda', ps.semana_segunda, 'quantidade_planejada', ps.quantidade_planejada) ORDER BY ps.semana_segunda) AS jsonb_agg
           FROM planejamento_tarefa_perfil_semana ps
          WHERE ps.tarefa_id = t.id), '[]'::jsonb) AS perfil_semanas,
    t.prioridade,
    t.asap,
    t.inicio_dia,
    t.sentido,
    t.restricao_inicio,
    t.restricao_inicio_em,
    t.restricao_fim,
    t.restricao_fim_em,
    t.coef_producao,
    t.qtd_equipes,
    t.calendario_id,
    t.derivar_predecessoras,
    t.aparencia,
    t.inicio_em,
    t.fim_em,
    t.folga_total_h,
    t.folga_livre_h,
    t.restricao_limite,
    t.violacoes,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', l.id, 'ordem', l.ordem, 'trecho_id', l.trecho_id, 'inicio_m', l.inicio_m, 'fim_m', l.fim_m, 'quantidade', l.quantidade, 'qtd_origem', l.qtd_origem, 'inicio_em', l.inicio_em, 'fim_em', l.fim_em, 'trecho_nome', tr.nome, 'trecho_tipo', tr.tipo, 'trecho_disponivel',
                CASE
                    WHEN l.trecho_id IS NOT NULL AND t.item_orcamentario_id IS NOT NULL THEN trecho_servico_disponivel(l.trecho_id, t.item_orcamentario_id)
                    ELSE false
                END) ORDER BY l.ordem, l.inicio_m) AS jsonb_agg
           FROM planejamento_tarefa_local l
             LEFT JOIN obra_trecho tr ON tr.id = l.trecho_id
          WHERE l.tarefa_id = t.id), '[]'::jsonb) AS locais
   FROM planejamento_tarefa t
     JOIN planejamento p ON p.id = t.planejamento_id
     LEFT JOIN item_orcamentario i ON i.id = t.item_orcamentario_id
     LEFT JOIN servico s ON s.id = i.servico_id
     LEFT JOIN vw_servico_vivo snap ON snap.servico_id = i.servico_id
     LEFT JOIN planejamento_lb_premissa pr ON pr.tarefa_id = t.id
     LEFT JOIN planejamento_tarefa_indireto pti ON pti.tarefa_id = t.id;
grant all on public.vw_planejamento_tarefa_completa to anon, authenticated, service_role;

create view public.vw_acompanhamento_produtividade_equipe with (security_invoker = true) as
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
            snap.producao_diaria_qtde AS meta
           FROM dia d
             LEFT JOIN equipe e ON e.id = d.equipe_id
             LEFT JOIN item_orcamentario io ON io.id = d.item_orcamentario_id
             LEFT JOIN servico s ON s.id = d.servico_id
             LEFT JOIN vw_servico_vivo snap ON snap.servico_id = io.servico_id
        )
 SELECT obra_id,
    equipe_id,
    equipe_id AS equipe_planejamento_id,
    COALESCE(equipe_nome, '—'::text) AS equipe_display_nome,
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
    min(data) AS primeira_data,
    max(data) AS ultima_data
   FROM base
  GROUP BY obra_id, equipe_id, equipe_nome, equipe_cor, servico_nome, servico_id, item_orcamentario_id, unidade_plano, meta;
grant all on public.vw_acompanhamento_produtividade_equipe to anon, authenticated, service_role;

-- ── índices repetidos ou cobertos por outro que começa pelas mesmas colunas ──────────────────────────
drop index if exists public.idx_servico_obra_codigo;
drop index if exists public.idx_obra_perm_obra;
drop index if exists public.idx_obras_empresa;
drop index if exists public.idx_encargos_obra;
drop index if exists public.idx_recurso_obra;
drop index if exists public.idx_recurso_obra_grupo;
drop index if exists public.idx_servico_obra;
drop index if exists public.idx_item_orc_obra;
drop index if exists public.idx_cpu_servico;
drop index if exists public.idx_cpu_obra;
drop index if exists public.idx_indireto_obra;
drop index if exists public.idx_equipe_obra;
drop index if exists public.idx_calendario_obra;
drop index if exists public.idx_planejamento_obra;
drop index if exists public.idx_plan_dep_plan;
drop index if exists public.idx_plan_dep_pred;
drop index if exists public.idx_ptps_tarefa;

-- ── extensão sem uso (era do casamento de nomes com o SIGA) ──────────────────────────────────────────
drop extension if exists pg_trgm;
