-- InfraWork — Planejamento: defaults técnicos pra tarefa indireta.
--
-- Tarefa indireta tem semântica completamente diferente (cobre cronograma,
-- não ocupa recurso). Mas o resto da UI/motor espera colunas técnicas
-- (trecho_id, quantidade_alocada) pra renderizar/cachear. Solução: preencher
-- defaults na criação e deixar o motor recalcular ao rodar Recalcular.
--
-- Defaults aplicados:
--   * trecho_id           = primeiro trecho da obra (ordem ASC)
--   * quantidade_alocada  = 1 (placeholder; motor sobrescreve com periodos_calc)
--
-- Equipe NÃO é atribuída — indireta não tem recurso real. Filtro de pendências
-- na UI será ajustado pra ignorar indiretas (lógica client-side, não SQL).

create or replace function public.criar_tarefa_indireta(
  p_planejamento_id      uuid,
  p_item_orcamentario_id uuid,
  p_indireto_config      jsonb,
  p_parent_id            uuid    default null,
  p_nome_custom          text    default null,
  p_ordem                int     default 0,
  p_notas                text    default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tarefa_id    uuid;
  v_indireto_id  uuid;
  v_obra_id      uuid;
  v_trecho_id    uuid;
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

  -- Defaults técnicos: obra do planejamento + primeiro trecho.
  select obra_id into v_obra_id
  from public.planejamento where id = p_planejamento_id;

  select id into v_trecho_id
  from public.obra_trecho
  where obra_id = v_obra_id
  order by ordem asc nulls last, created_at asc
  limit 1;

  -- Insert tarefa com defaults. quantidade_alocada=1 é placeholder positivo
  -- (passa no check chk_plan_tar_qtd_alocada_pos); motor sobrescreve com
  -- periodos_calc no próximo recálculo.
  insert into public.planejamento_tarefa (
    planejamento_id,
    item_orcamentario_id,
    trecho_id,
    quantidade_alocada,
    tipo_no,
    parent_id,
    nome_custom,
    ordem,
    notas,
    nivel,
    perfil_default
  ) values (
    p_planejamento_id,
    p_item_orcamentario_id,
    v_trecho_id,
    1,
    'tarefa',
    p_parent_id,
    p_nome_custom,
    coalesce(p_ordem, 0),
    p_notas,
    1,
    'uniforme'
  )
  returning id into v_tarefa_id;

  insert into public.planejamento_tarefa_indireto (
    tarefa_id,
    custo_periodicidade,
    custo_unitario,
    receita_modo,
    receita_unitaria,
    receita_percentual,
    offset_dias_antes,
    offset_dias_depois,
    receita_extrapola,
    aplica_taxas,
    taxa_regime_id
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
    nullif(p_indireto_config->>'taxa_regime_id','')::uuid
  );

  return v_tarefa_id;
end;
$$;

-- ─── Backfill: indiretas pré-existentes sem trecho/quantidade ────────────
-- Aplica trecho default + quantidade_alocada = periodos_calc (ou 1 se NULL).

update public.planejamento_tarefa pt
   set trecho_id = coalesce(
         pt.trecho_id,
         (select id
            from public.obra_trecho
           where obra_id = (select obra_id from public.planejamento where id = pt.planejamento_id)
           order by ordem asc nulls last, created_at asc
           limit 1)
       ),
       quantidade_alocada = coalesce(
         pt.quantidade_alocada,
         (select greatest(coalesce(periodos_calc, 0), 0.0001)
            from public.planejamento_tarefa_indireto where tarefa_id = pt.id),
         1
       )
   where pt.id in (
     select tarefa_id from public.planejamento_tarefa_indireto
   )
   and (pt.trecho_id is null or pt.quantidade_alocada is null);
