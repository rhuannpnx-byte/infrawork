-- Indireto pontual e parcelado (canteiro, mobilização/desmobilização), além do contínuo (administração).
--
-- distribuicao = 'continuo': como antes (custo unitário × períodos na janela das diretas ± folgas).
-- distribuicao = 'parcela': a tarefa leva parcela_percentual do valor total orçado do item (custo e receita) nos
--   primeiros (parcela_ancora = 'inicio') ou nos últimos ('fim') parcela_dias dias úteis da janela das diretas,
--   repartido por igual. O pontual é uma parcela de 100%; o parcelado são várias tarefas do mesmo item, cada uma
--   com a sua parcela. A soma das parcelas de um item no mesmo plano não passa de 100%.

alter table public.planejamento_tarefa_indireto
  add column if not exists distribuicao text not null default 'continuo',
  add column if not exists parcela_percentual numeric(7,4),
  add column if not exists parcela_ancora text,
  add column if not exists parcela_dias integer;

alter table public.planejamento_tarefa_indireto
  drop constraint if exists chk_indireto_distribuicao,
  add constraint chk_indireto_distribuicao check (
    distribuicao = 'continuo'
    or (distribuicao = 'parcela'
        and parcela_percentual > 0 and parcela_percentual <= 1
        and parcela_ancora in ('inicio', 'fim')
        and parcela_dias > 0));

-- Σ das parcelas do mesmo item no mesmo plano ≤ 100 %; e o item não fica contínuo e parcelado ao mesmo tempo
create or replace function public.fn_indireto_parcelas_limite()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_plano uuid; v_item uuid; v_soma numeric;
begin
  select planejamento_id, item_orcamentario_id into v_plano, v_item
    from public.planejamento_tarefa where id = new.tarefa_id;
  -- o mesmo item não fica contínuo e em parcelas ao mesmo tempo (o custo contaria duas vezes)
  if exists (select 1 from public.planejamento_tarefa_indireto i
               join public.planejamento_tarefa t on t.id = i.tarefa_id
              where t.planejamento_id = v_plano and t.item_orcamentario_id = v_item
                and i.tarefa_id <> new.tarefa_id and i.distribuicao <> new.distribuicao) then
    raise exception '%', case when new.distribuicao = 'parcela'
      then 'Este item já tem uma tarefa contínua no plano: mude-a para pontual ou parcelado, ou exclua-a, antes de criar parcelas.'
      else 'Este item já está em parcelas no plano: exclua as parcelas antes de criar a tarefa contínua.' end
      using errcode = '23514';
  end if;
  if new.distribuicao <> 'parcela' then return new; end if;
  select coalesce(sum(i.parcela_percentual), 0) into v_soma
    from public.planejamento_tarefa_indireto i
    join public.planejamento_tarefa t on t.id = i.tarefa_id
   where t.planejamento_id = v_plano and t.item_orcamentario_id = v_item
     and i.distribuicao = 'parcela' and i.tarefa_id <> new.tarefa_id;
  if v_soma + new.parcela_percentual > 1.00005 then
    raise exception 'As parcelas deste item passam de 100%% (já há % em outras tarefas)',
      replace(round(v_soma * 100, 2)::text, '.', ',') || '%'
      using errcode = '23514';
  end if;
  return new;
end $function$;
revoke all on function public.fn_indireto_parcelas_limite() from public, anon, authenticated;

drop trigger if exists trg_indireto_parcelas_limite on public.planejamento_tarefa_indireto;
create trigger trg_indireto_parcelas_limite
  before insert or update of distribuicao, parcela_percentual on public.planejamento_tarefa_indireto
  for each row execute function public.fn_indireto_parcelas_limite();

CREATE OR REPLACE FUNCTION public.criar_tarefa_indireta(p_planejamento_id uuid, p_item_orcamentario_id uuid, p_indireto_config jsonb, p_parent_id uuid DEFAULT NULL::uuid, p_nome_custom text DEFAULT NULL::text, p_ordem integer DEFAULT 0, p_notas text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_tarefa_id    uuid;
  v_indireto_id  uuid;
  v_obra_id      uuid;
  v_equipe_id    uuid;
begin
  select indireto_id into v_indireto_id
    from public.item_orcamentario
   where id = p_item_orcamentario_id;
  if v_indireto_id is null then
    raise exception 'Item % não é indireto (não tem indireto_id)', p_item_orcamentario_id
      using errcode = '22023';
  end if;

  if p_indireto_config is null
     or p_indireto_config->>'custo_periodicidade' is null
     or p_indireto_config->>'receita_modo' is null then
    raise exception 'indireto_config deve conter custo_periodicidade e receita_modo'
      using errcode = '22023';
  end if;

  select obra_id into v_obra_id from public.planejamento where id = p_planejamento_id;

  select t.equipe_id into v_equipe_id
    from public.get_or_create_indireto_resources(v_obra_id) t;

  insert into public.planejamento_tarefa (
    planejamento_id, item_orcamentario_id, quantidade_alocada, tipo_no,
    parent_id, nome_custom, ordem, notas, nivel
  ) values (
    p_planejamento_id, p_item_orcamentario_id, 1, 'tarefa',
    p_parent_id, p_nome_custom, coalesce(p_ordem, 0), p_notas, 1
  )
  returning id into v_tarefa_id;

  insert into public.planejamento_tarefa_indireto (
    tarefa_id, custo_periodicidade, custo_unitario, receita_modo, receita_unitaria,
    receita_percentual, offset_dias_antes, offset_dias_depois, receita_extrapola,
    aplica_taxas, taxa_regime_id, distribuicao, parcela_percentual, parcela_ancora, parcela_dias
  ) values (
    v_tarefa_id,
    p_indireto_config->>'custo_periodicidade',
    nullif(p_indireto_config->>'custo_unitario','')::numeric,
    p_indireto_config->>'receita_modo',
    nullif(p_indireto_config->>'receita_unitaria','')::numeric,
    nullif(p_indireto_config->>'receita_percentual','')::numeric,
    coalesce((p_indireto_config->>'offset_dias_antes')::int, 0),
    coalesce((p_indireto_config->>'offset_dias_depois')::int, 0),
    coalesce((p_indireto_config->>'receita_extrapola')::boolean, true),
    coalesce((p_indireto_config->>'aplica_taxas')::boolean, false),
    nullif(p_indireto_config->>'taxa_regime_id','')::uuid,
    coalesce(nullif(p_indireto_config->>'distribuicao',''), 'continuo'),
    nullif(p_indireto_config->>'parcela_percentual','')::numeric,
    nullif(p_indireto_config->>'parcela_ancora',''),
    nullif(p_indireto_config->>'parcela_dias','')::int
  );

  insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes)
  values (v_tarefa_id, v_equipe_id, 1)
  on conflict do nothing;

  return v_tarefa_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.atualizar_tarefa_indireta(p_tarefa_id uuid, p_indireto_config jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if p_indireto_config is null then
    raise exception 'indireto_config nulo' using errcode = '22023';
  end if;

  update public.planejamento_tarefa_indireto set
    custo_periodicidade = coalesce(p_indireto_config->>'custo_periodicidade', custo_periodicidade),
    custo_unitario      = coalesce(nullif(p_indireto_config->>'custo_unitario','')::numeric, custo_unitario),
    receita_modo        = coalesce(p_indireto_config->>'receita_modo', receita_modo),
    receita_unitaria    = case
                            when p_indireto_config ? 'receita_unitaria'
                              then nullif(p_indireto_config->>'receita_unitaria','')::numeric
                            else receita_unitaria
                          end,
    receita_percentual  = case
                            when p_indireto_config ? 'receita_percentual'
                              then nullif(p_indireto_config->>'receita_percentual','')::numeric
                            else receita_percentual
                          end,
    offset_dias_antes   = coalesce((p_indireto_config->>'offset_dias_antes')::int, offset_dias_antes),
    offset_dias_depois  = coalesce((p_indireto_config->>'offset_dias_depois')::int, offset_dias_depois),
    receita_extrapola   = coalesce((p_indireto_config->>'receita_extrapola')::boolean, receita_extrapola),
    aplica_taxas        = coalesce((p_indireto_config->>'aplica_taxas')::boolean, aplica_taxas),
    taxa_regime_id      = case
                            when p_indireto_config ? 'taxa_regime_id'
                              then nullif(p_indireto_config->>'taxa_regime_id','')::uuid
                            else taxa_regime_id
                          end,
    distribuicao        = coalesce(nullif(p_indireto_config->>'distribuicao',''), distribuicao),
    parcela_percentual  = case
                            when p_indireto_config ? 'parcela_percentual'
                              then nullif(p_indireto_config->>'parcela_percentual','')::numeric
                            else parcela_percentual
                          end,
    parcela_ancora      = case
                            when p_indireto_config ? 'parcela_ancora'
                              then nullif(p_indireto_config->>'parcela_ancora','')
                            else parcela_ancora
                          end,
    parcela_dias        = case
                            when p_indireto_config ? 'parcela_dias'
                              then nullif(p_indireto_config->>'parcela_dias','')::int
                            else parcela_dias
                          end
  where tarefa_id = p_tarefa_id;
end;
$function$;

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
    offset_dias_antes, offset_dias_depois, receita_extrapola, aplica_taxas, taxa_regime_id,
    distribuicao, parcela_percentual, parcela_ancora, parcela_dias)
  select m.novo, i.custo_periodicidade, i.custo_unitario, i.receita_modo, i.receita_unitaria, i.receita_percentual,
         i.offset_dias_antes, i.offset_dias_depois, i.receita_extrapola, i.aplica_taxas, i.taxa_regime_id,
         i.distribuicao, i.parcela_percentual, i.parcela_ancora, i.parcela_dias
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

-- a configuração do indireto que a tela e o MCP leem passa a trazer a distribuição
create or replace view public.vw_planejamento_tarefa_completa with (security_invoker=true) as
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
    (COALESCE(pr.item_quantidade, i.quantidade_referencia))::numeric(14,4) AS quantidade_referencia,
    i.servico_id,
    i.indireto_id,
    i.unidade_referencia AS unidade_referencia_item,
    (COALESCE(pr.item_custo_unit, i.custo_unitario_calc))::numeric(14,4) AS custo_unitario_item,
        CASE
            WHEN (i.tipo = 'receita'::text) THEN i.venda_unitaria
            WHEN ((i.tipo = 'servico_grupo'::text) AND (COALESCE(pr.item_quantidade, i.quantidade_referencia) > (0)::numeric)) THEN ((COALESCE(pr.item_venda_total, i.venda_total_calc) / COALESCE(pr.item_quantidade, i.quantidade_referencia)))::numeric(18,4)
            ELSE NULL::numeric
        END AS venda_unitaria_item,
    (COALESCE(pr.item_venda_total, i.venda_total_calc))::numeric(14,2) AS venda_total_item,
    s.codigo AS servico_codigo,
    s.nome AS servico_nome,
    s.unidade AS unidade_servico,
    snap.cpu_id AS cpu_id_origem,
    COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde) AS producao_diaria_qtde,
    snap.producao_diaria_unidade,
    (COALESCE(pr.item_custo_unit, snap.custo_unit))::numeric(14,4) AS custo_unit_snapshot,
    COALESCE(pr.producao_diaria_efetiva, ((COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde) * (t.qtd_equipes)::numeric) * t.coef_producao)) AS producao_diaria_efetiva,
    (i.indireto_id IS NOT NULL) AS is_indireto,
        CASE
            WHEN ((i.indireto_id IS NOT NULL) AND (pti.tarefa_id IS NOT NULL)) THEN jsonb_build_object('custo_periodicidade', pti.custo_periodicidade, 'custo_unitario', pti.custo_unitario, 'receita_modo', pti.receita_modo, 'receita_unitaria', pti.receita_unitaria, 'receita_percentual', pti.receita_percentual, 'offset_dias_antes', pti.offset_dias_antes, 'offset_dias_depois', pti.offset_dias_depois, 'receita_extrapola', pti.receita_extrapola, 'aplica_taxas', pti.aplica_taxas, 'taxa_regime_id', pti.taxa_regime_id, 'periodos_calc', pti.periodos_calc, 'distribuicao', pti.distribuicao, 'parcela_percentual', pti.parcela_percentual, 'parcela_ancora', pti.parcela_ancora, 'parcela_dias', pti.parcela_dias)
            ELSE NULL::jsonb
        END AS indireto_config,
        CASE
            WHEN (i.indireto_id IS NOT NULL) THEN (COALESCE(pti.custo_total_calc, (0)::numeric))::numeric(18,2)
            WHEN ((COALESCE(pr.item_custo_unit, snap.custo_unit) IS NOT NULL) AND (t.quantidade_alocada IS NOT NULL)) THEN ((COALESCE(pr.item_custo_unit, snap.custo_unit) * t.quantidade_alocada))::numeric(18,2)
            ELSE (0)::numeric(18,2)
        END AS custo_total_calc,
        CASE
            WHEN (i.indireto_id IS NOT NULL) THEN (COALESCE(pti.receita_total_calc, (0)::numeric))::numeric(18,2)
            WHEN ((i.tipo = 'servico_grupo'::text) AND (COALESCE(pr.item_quantidade, i.quantidade_referencia) > (0)::numeric) AND (t.quantidade_alocada IS NOT NULL)) THEN (((COALESCE(pr.item_venda_total, i.venda_total_calc) / COALESCE(pr.item_quantidade, i.quantidade_referencia)) * t.quantidade_alocada))::numeric(18,2)
            WHEN ((i.tipo = 'receita'::text) AND (i.venda_unitaria IS NOT NULL) AND (t.quantidade_alocada IS NOT NULL)) THEN ((i.venda_unitaria * t.quantidade_alocada))::numeric(18,2)
            ELSE (0)::numeric(18,2)
        END AS receita_total_calc,
        CASE
            WHEN (i.indireto_id IS NOT NULL) THEN pti.custo_taxas_calc
            ELSE NULL::numeric
        END AS custo_taxas_calc,
        CASE
            WHEN ((COALESCE(pr.item_custo_unit, snap.custo_unit) IS NOT NULL) AND (t.quantidade_alocada IS NOT NULL)) THEN ((COALESCE(pr.item_custo_unit, snap.custo_unit) * t.quantidade_alocada))::numeric(14,2)
            ELSE (0)::numeric(14,2)
        END AS custo_total_tarefa,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'cor', e.cor, 'tipo', e.tipo, 'ordem', e.ordem, 'qtd_equipes', pte.qtd_equipes, 'producao_diaria_efetiva', ((COALESCE(pr.producao_diaria_cpu, snap.producao_diaria_qtde) * (t.qtd_equipes)::numeric) * t.coef_producao)) ORDER BY e.ordem, e.nome) AS jsonb_agg
           FROM (planejamento_tarefa_equipe pte
             JOIN equipe e ON ((e.id = pte.equipe_id)))
          WHERE (pte.tarefa_id = t.id)), '[]'::jsonb) AS equipes,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', d.id, 'predecessora_id', d.predecessora_id, 'tipo', d.tipo, 'origem', d.origem, 'atraso_min', d.atraso_min, 'atraso_max', d.atraso_max, 'dias_uteis', d.dias_uteis)) AS jsonb_agg
           FROM planejamento_dependencia d
          WHERE (d.sucessora_id = t.id)), '[]'::jsonb) AS predecessoras,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', d.id, 'sucessora_id', d.sucessora_id, 'tipo', d.tipo, 'origem', d.origem, 'atraso_min', d.atraso_min, 'atraso_max', d.atraso_max, 'dias_uteis', d.dias_uteis)) AS jsonb_agg
           FROM planejamento_dependencia d
          WHERE (d.predecessora_id = t.id)), '[]'::jsonb) AS sucessoras,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('semana_segunda', ps.semana_segunda, 'quantidade_planejada', ps.quantidade_planejada) ORDER BY ps.semana_segunda) AS jsonb_agg
           FROM planejamento_tarefa_perfil_semana ps
          WHERE (ps.tarefa_id = t.id)), '[]'::jsonb) AS perfil_semanas,
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
                    WHEN ((l.trecho_id IS NOT NULL) AND (t.item_orcamentario_id IS NOT NULL)) THEN trecho_servico_disponivel(l.trecho_id, t.item_orcamentario_id)
                    ELSE false
                END) ORDER BY l.ordem, l.inicio_m) AS jsonb_agg
           FROM (planejamento_tarefa_local l
             LEFT JOIN obra_trecho tr ON ((tr.id = l.trecho_id)))
          WHERE (l.tarefa_id = t.id)), '[]'::jsonb) AS locais
   FROM ((((((planejamento_tarefa t
     JOIN planejamento p ON ((p.id = t.planejamento_id)))
     LEFT JOIN item_orcamentario i ON ((i.id = t.item_orcamentario_id)))
     LEFT JOIN servico s ON ((s.id = i.servico_id)))
     LEFT JOIN vw_servico_vivo snap ON ((snap.servico_id = i.servico_id)))
     LEFT JOIN planejamento_lb_premissa pr ON ((pr.tarefa_id = t.id)))
     LEFT JOIN planejamento_tarefa_indireto pti ON ((pti.tarefa_id = t.id)));
