-- InfraWork — Planejamento: validador qtd_alocada pula items indiretos.
--
-- A função fn_tarefa_validar_qtd_alocada garante que a SOMA de
-- quantidade_alocada das tarefas (mesmo item) não exceda o orçado. Faz
-- sentido pra serviços diretos (qtd física).
--
-- Pra indiretos é o oposto: a tarefa indireta cobre o cronograma inteiro;
-- se o cronograma extrapola o que o orçamento previu, isso é informação
-- legítima (a config `receita_extrapola` decide se receita acompanha ou
-- trava). Bloquear aqui seria contradição com a feature.

create or replace function public.fn_tarefa_validar_qtd_alocada()
returns trigger
language plpgsql
as $$
declare
  v_item uuid;
  v_plan uuid;
  v_total numeric;
  v_ref numeric;
  v_tol numeric;
  v_is_indireto boolean;
begin
  if tg_op = 'DELETE' then
    v_item := old.item_orcamentario_id;
    v_plan := old.planejamento_id;
  else
    v_item := new.item_orcamentario_id;
    v_plan := new.planejamento_id;
  end if;

  if v_item is null then return null; end if;

  -- Items indiretos: tarefa cobre cronograma; extrapolar é regra de
  -- negócio (não anomalia).
  select (indireto_id is not null) into v_is_indireto
    from public.item_orcamentario where id = v_item;
  if v_is_indireto then return null; end if;

  select coalesce(sum(quantidade_alocada), 0) into v_total
    from public.planejamento_tarefa
   where planejamento_id = v_plan
     and item_orcamentario_id = v_item
     and tipo_no = 'tarefa'
     and quantidade_alocada is not null;

  select quantidade_referencia into v_ref
    from public.item_orcamentario where id = v_item;
  if v_ref is null then return null; end if;

  v_tol := greatest(abs(v_ref) * 0.001, 0.0001);
  if v_total > v_ref + v_tol then
    raise exception 'Quantidade alocada total (%) excede a quantidade orcada (%) do item %',
      v_total, v_ref, v_item
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;
