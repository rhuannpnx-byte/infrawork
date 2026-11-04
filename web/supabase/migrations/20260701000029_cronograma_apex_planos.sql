-- Cronograma ApeX (F2): copiar plano e travar como linha de base no modelo novo, em transações no banco.
-- Substituem as edge functions copiar-planejamento, promover-baseline e restaurar-linha-base (o cálculo agora roda no
-- cliente; "restaurar" é copiar → calcular no cliente → travar).

-- ═══ 1. Copiar um plano (cria o plano em edição) ═════════════════════════════════════════════════════════════════
-- Copia a EAP inteira com os atributos de programação do ApeX, os locais, as dependências, as equipes nomeadas, os
-- indiretos, os marcos (com as tarefas remapeadas) e os limites de recursos. Os resultados não: o plano novo nasce
-- sem cálculo (calculo_rev nulo) e é calculado ao abrir — o início desejado de cada tarefa (inicio_em) vai junto,
-- então o primeiro cálculo reproduz o cronograma da origem.
create or replace function public.planejamento_copiar(_origem_id uuid, _nome text, _inicio date default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
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
  truncate _mapa_tarefa; -- (DELETE sem WHERE é recusado pelo safeupdate do PostgREST)
  insert into _mapa_tarefa (velho, novo) select id, gen_random_uuid() from public.planejamento_tarefa where planejamento_id = _origem_id;

  -- tarefas, nível a nível (o gatilho de nível exige o pai já gravado)
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

  insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
  select m.novo, v_novo, l.ordem, l.trecho_id, l.inicio_m, l.fim_m, l.quantidade, l.qtd_origem
    from public.planejamento_tarefa_local l join _mapa_tarefa m on m.velho = l.tarefa_id
   where l.planejamento_id = _origem_id
   order by l.tarefa_id, l.ordem;

  insert into public.planejamento_dependencia (planejamento_id, predecessora_id, sucessora_id, tipo, lag_dias, origem, atraso_min, atraso_max, dias_uteis, aparencia)
  select v_novo, a.novo, b.novo, d.tipo, d.lag_dias, d.origem, d.atraso_min, d.atraso_max, d.dias_uteis, d.aparencia
    from public.planejamento_dependencia d
    join _mapa_tarefa a on a.velho = d.predecessora_id
    join _mapa_tarefa b on b.velho = d.sucessora_id
   where d.planejamento_id = _origem_id;
  get diagnostics n_d = row_count;

  insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes, producao_diaria_override)
  select m.novo, e.equipe_id, e.qtd_equipes, e.producao_diaria_override
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
end $$;
grant execute on function public.planejamento_copiar(uuid, text, date) to authenticated;

-- ═══ 2. Travar como linha de base ════════════════════════════════════════════════════════════════════════════════
-- Exige o cronograma calculado sobre os dados atuais (calculo_rev = dados_rev, sem recálculo pendente): a linha de
-- base congela os resultados (perfis, trechos de tarefa) e as premissas (orçamento, composições, calendários).
create or replace function public.planejamento_promover(_planejamento_id uuid, _marcar_vigente boolean default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare p record; v_snap uuid; v_vig uuid; marcar boolean; n_folhas int;
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

  insert into public.planejamento_baseline_snapshot (planejamento_id, obra_id, payload, criado_por)
  values (p.id, p.obra_id, jsonb_build_object(
      'formato', 'apex/1',
      'plano', to_jsonb(p),
      'tarefas', coalesce((select jsonb_agg(to_jsonb(t) order by t.nivel, t.ordem) from public.planejamento_tarefa t where t.planejamento_id = p.id), '[]'::jsonb),
      'locais', coalesce((select jsonb_agg(to_jsonb(l)) from public.planejamento_tarefa_local l where l.planejamento_id = p.id), '[]'::jsonb),
      'wps', coalesce((select jsonb_agg(to_jsonb(w) order by w.tarefa_id, w.ordem) from public.planejamento_tarefa_wp w where w.planejamento_id = p.id), '[]'::jsonb),
      'dependencias', coalesce((select jsonb_agg(to_jsonb(d)) from public.planejamento_dependencia d where d.planejamento_id = p.id), '[]'::jsonb),
      'equipes', coalesce((select jsonb_agg(to_jsonb(e)) from public.planejamento_tarefa_equipe e join public.planejamento_tarefa t on t.id = e.tarefa_id where t.planejamento_id = p.id), '[]'::jsonb),
      'marcos', coalesce((select jsonb_agg(to_jsonb(m)) from public.planejamento_marco m where m.planejamento_id = p.id), '[]'::jsonb),
      'limites', coalesce((select jsonb_agg(to_jsonb(l)) from public.planejamento_recurso_limite l where l.planejamento_id = p.id), '[]'::jsonb),
      'perfis_semana', coalesce((select jsonb_agg(to_jsonb(s)) from public.planejamento_tarefa_perfil_semana s join public.planejamento_tarefa t on t.id = s.tarefa_id where t.planejamento_id = p.id), '[]'::jsonb),
      'calendarios', public.calendario_fingerprint(p.obra_id),
      'tipos', public.servico_dependencias_fingerprint(p.obra_id),
      'snapshot_em', now()), auth.uid())
  returning id into v_snap;

  update public.planejamento set is_baseline = true, status = 'ativo' where id = p.id;
  perform public.lb_capturar_premissas(p.id);

  select id into v_vig from public.planejamento where obra_id = p.obra_id and vigente;
  marcar := coalesce(_marcar_vigente, v_vig is null);
  if marcar then
    if v_vig is not null then update public.planejamento set vigente = false where id = v_vig; end if;
    update public.planejamento set vigente = true where id = p.id;
  end if;
  return jsonb_build_object('ok', true, 'baseline_id', p.id, 'snapshot_id', v_snap, 'vigente', marcar);
end $$;
grant execute on function public.planejamento_promover(uuid, boolean) to authenticated;
