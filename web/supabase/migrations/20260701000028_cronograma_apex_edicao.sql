-- Cronograma ApeX (F3): RPCs de edição usadas pelas visões (Gantt, tempo-caminho, planilha de tarefas).
-- Cada uma é uma transação: o motor no cliente recalcula a partir do banco depois (dados_rev sobe uma vez por linha).

-- ═══ 1. Atualização em lote dos atributos de programação ═════════════════════════════════════════════════════════
-- Os comandos das visões do ApeX (mover início/fim, compactar, menu de contexto) mudam poucos campos de muitas tarefas
-- de uma vez. Só as chaves presentes em cada item são gravadas.
create or replace function public.planejamento_tarefas_atualizar(_planejamento_id uuid, _itens jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare it jsonb; n int := 0; v_obra uuid; v_lb boolean;
begin
  select obra_id, is_baseline into v_obra, v_lb from public.planejamento where id = _planejamento_id;
  if v_obra is null then raise exception 'Plano não encontrado'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if v_lb then raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela'; end if;
  for it in select value from jsonb_array_elements(coalesce(_itens, '[]'::jsonb)) loop
    update public.planejamento_tarefa t set
      inicio_em     = case when it ? 'inicio_em' then (it->>'inicio_em')::timestamp else t.inicio_em end,
      coef_producao = case when it ? 'coef_producao' then (it->>'coef_producao')::numeric else t.coef_producao end,
      prioridade    = case when it ? 'prioridade' then (it->>'prioridade')::int else t.prioridade end,
      asap          = case when it ? 'asap' then (it->>'asap')::boolean else t.asap end,
      sentido       = case when it ? 'sentido' then it->>'sentido' else t.sentido end,
      qtd_equipes   = case when it ? 'qtd_equipes' then (it->>'qtd_equipes')::smallint else t.qtd_equipes end
     where t.id = (it->>'id')::uuid and t.planejamento_id = _planejamento_id;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
grant execute on function public.planejamento_tarefas_atualizar(uuid, jsonb) to authenticated;

-- ═══ 2. Mover na EAP ═════════════════════════════════════════════════════════════════════════════════════════════
-- Leva as linhas (com as sub-árvores) para baixo de `_pai` (null = raiz), antes de `_antes` (null = no fim). O nível
-- é refeito pela árvore e a ordem dos irmãos no destino é renumerada.
create or replace function public.planejamento_mover_tarefas(_planejamento_id uuid, _ids uuid[], _pai uuid, _antes uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_obra uuid; v_lb boolean; v_nivel_pai smallint := 0; r record; ordem_nova int := 0; n int := 0;
begin
  select obra_id, is_baseline into v_obra, v_lb from public.planejamento where id = _planejamento_id;
  if v_obra is null then raise exception 'Plano não encontrado'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if v_lb then raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela'; end if;
  if _pai is not null then
    select nivel into v_nivel_pai from public.planejamento_tarefa
     where id = _pai and planejamento_id = _planejamento_id and tipo_no = 'grupo';
    if v_nivel_pai is null then raise exception 'O destino precisa ser uma tarefa-resumo do mesmo plano'; end if;
    -- não pode entrar na própria sub-árvore
    if exists (
      with recursive acima as (
        select id, parent_id from public.planejamento_tarefa where id = _pai
        union all
        select t.id, t.parent_id from public.planejamento_tarefa t join acima a on t.id = a.parent_id
      ) select 1 from acima where id = any(_ids)) then
      raise exception 'Uma tarefa-resumo não pode ficar dentro dela mesma';
    end if;
  end if;
  if exists (select 1 from unnest(_ids) x where not exists (
       select 1 from public.planejamento_tarefa t where t.id = x and t.planejamento_id = _planejamento_id)) then
    raise exception 'Tarefa de outro plano';
  end if;

  -- só as raízes da seleção (uma linha cujo ancestral também foi escolhido vai junto com ele)
  create temporary table if not exists _mover (id uuid primary key, pos int) on commit drop;
  delete from _mover;
  insert into _mover (id, pos)
  select u.x, u.k
    from unnest(_ids) with ordinality u(x, k)
   where not exists (
     with recursive acima as (
       select parent_id as id from public.planejamento_tarefa where id = u.x
       union all
       select t.parent_id from public.planejamento_tarefa t join acima a on t.id = a.id where a.id is not null
     ) select 1 from acima where acima.id = any(_ids))
  on conflict (id) do nothing;

  -- irmãos do destino na ordem atual, com as movidas antes de `_antes` (ou no fim)
  for r in
    with alvo as (
      select coalesce((select ordem from public.planejamento_tarefa
                        where id = _antes and parent_id is not distinct from _pai
                          and not exists (select 1 from _mover m where m.id = _antes)), 2147483647) as o
    )
    select z.id from (
      select t.id, t.ordem as o, case when t.ordem < (select o from alvo) then 0 else 2 end as faixa, 0::bigint as pos
        from public.planejamento_tarefa t
       where t.planejamento_id = _planejamento_id and t.parent_id is not distinct from _pai
         and not exists (select 1 from _mover m where m.id = t.id)
      union all
      select m.id, 0, 1, m.pos from _mover m
    ) z order by z.faixa, z.o, z.pos
  loop
    ordem_nova := ordem_nova + 1;
    update public.planejamento_tarefa set parent_id = _pai, nivel = v_nivel_pai + 1, ordem = ordem_nova
     where id = r.id and (parent_id is distinct from _pai or nivel <> v_nivel_pai + 1 or ordem <> ordem_nova);
  end loop;

  -- níveis das sub-árvores movidas, do mais raso para o mais fundo (o gatilho confere nível = nível do pai + 1)
  for r in
    with recursive sub as (
      select c.id, (v_nivel_pai + 2)::smallint as nivel, 1 as prof
        from public.planejamento_tarefa c join _mover m on c.parent_id = m.id
      union all
      select c.id, (s.nivel + 1)::smallint, s.prof + 1 from public.planejamento_tarefa c join sub s on c.parent_id = s.id
    ) select id, nivel from sub order by prof
  loop
    update public.planejamento_tarefa set nivel = r.nivel where id = r.id and nivel <> r.nivel;
  end loop;
  select count(*) into n from _mover;
  return n;
end $$;
grant execute on function public.planejamento_mover_tarefas(uuid, uuid[], uuid, uuid) to authenticated;

-- ═══ 3. Remover com as sub-árvores ═══════════════════════════════════════════════════════════════════════════════
-- Remover uma tarefa-resumo remove tudo o que está dentro dela (como no original); folhas antes dos pais.
create or replace function public.planejamento_excluir_tarefas(_planejamento_id uuid, _ids uuid[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_obra uuid; v_lb boolean; n int := 0; k int; p int;
begin
  select obra_id, is_baseline into v_obra, v_lb from public.planejamento where id = _planejamento_id;
  if v_obra is null then raise exception 'Plano não encontrado'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if v_lb then raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela'; end if;
  create temporary table if not exists _excluir (id uuid primary key, prof int) on commit drop;
  delete from _excluir;
  insert into _excluir (id, prof)
  with recursive sub as (
    select id, 0 as prof from public.planejamento_tarefa where id = any(_ids) and planejamento_id = _planejamento_id
    union all
    select c.id, s.prof + 1 from public.planejamento_tarefa c join sub s on c.parent_id = s.id
  ) select id, max(prof) from sub group by id;
  -- a chave do pai é RESTRICT: das folhas para a raiz
  for p in select distinct prof from _excluir order by prof desc loop
    delete from public.planejamento_tarefa t using _excluir x where x.id = t.id and x.prof = p;
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $$;
grant execute on function public.planejamento_excluir_tarefas(uuid, uuid[]) to authenticated;

-- ═══ 4. Locais da tarefa numa transação ══════════════════════════════════════════════════════════════════════════
-- O diálogo da tarefa edita a lista inteira (faixas que trocam de lugar não podem esbarrar na checagem de sobreposição
-- linha a linha): apaga e regrava na ordem dada. Os gatilhos calculam a quantidade "do trecho" e a soma da tarefa.
create or replace function public.planejamento_tarefa_locais_salvar(_tarefa_id uuid, _locais jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_plan uuid; v_obra uuid; v_lb boolean; l jsonb; k int := 0;
begin
  select t.planejamento_id, p.obra_id, p.is_baseline into v_plan, v_obra, v_lb
    from public.planejamento_tarefa t join public.planejamento p on p.id = t.planejamento_id where t.id = _tarefa_id;
  if v_plan is null then raise exception 'Tarefa não encontrada'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if v_lb then raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela'; end if;
  delete from public.planejamento_tarefa_local where tarefa_id = _tarefa_id;
  for l in select value from jsonb_array_elements(coalesce(_locais, '[]'::jsonb)) loop
    insert into public.planejamento_tarefa_local (tarefa_id, planejamento_id, ordem, trecho_id, inicio_m, fim_m, quantidade, qtd_origem)
    values (_tarefa_id, v_plan, k, nullif(l->>'trecho_id', '')::uuid, (l->>'inicio_m')::numeric, (l->>'fim_m')::numeric,
            coalesce((l->>'quantidade')::numeric, 0), coalesce(l->>'qtd_origem', 'manual'));
    k := k + 1;
  end loop;
  -- sem locais: a quantidade volta a ser a da própria tarefa (fn_local_soma só age com locais)
  return k;
end $$;
grant execute on function public.planejamento_tarefa_locais_salvar(uuid, jsonb) to authenticated;

-- ═══ 5. Equipes nomeadas da tarefa ═══════════════════════════════════════════════════════════════════════════════
create or replace function public.planejamento_tarefa_equipes_salvar(_tarefa_id uuid, _equipes uuid[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_obra uuid; v_lb boolean; n int;
begin
  select p.obra_id, p.is_baseline into v_obra, v_lb
    from public.planejamento_tarefa t join public.planejamento p on p.id = t.planejamento_id where t.id = _tarefa_id;
  if v_obra is null then raise exception 'Tarefa não encontrada'; end if;
  if not public.pode_planejar_obra(v_obra) then raise exception 'Sem permissão para planejar esta obra'; end if;
  if v_lb then raise exception 'Linha de base travada é imutável — crie um plano em edição a partir dela'; end if;
  if exists (select 1 from unnest(coalesce(_equipes, '{}')) e where not exists (
       select 1 from public.equipe q where q.id = e and q.obra_id = v_obra and not q.is_sistema)) then
    raise exception 'Equipe de outra obra';
  end if;
  delete from public.planejamento_tarefa_equipe x
   using public.equipe q
   where x.tarefa_id = _tarefa_id and q.id = x.equipe_id and not q.is_sistema and not (x.equipe_id = any(coalesce(_equipes, '{}')));
  insert into public.planejamento_tarefa_equipe (tarefa_id, equipe_id, qtd_equipes)
  select _tarefa_id, e, 1 from unnest(coalesce(_equipes, '{}')) e
  on conflict (tarefa_id, equipe_id) do nothing;
  select count(*) into n from public.planejamento_tarefa_equipe where tarefa_id = _tarefa_id;
  return n;
end $$;
grant execute on function public.planejamento_tarefa_equipes_salvar(uuid, uuid[]) to authenticated;

-- ═══ 6. Atributos do plano que entram no cálculo ═════════════════════════════════════════════════════════════════
-- Início, prazo, calendário padrão e modo mudam o cronograma: contam como edição dos dados de entrada.
create or replace function public.fn_plano_rev_atributos()
returns trigger
language plpgsql
as $$
begin
  if not new.is_baseline
     and (new.data_referencia_inicio, new.prazo, new.calendario_id, new.modo)
         is distinct from (old.data_referencia_inicio, old.prazo, old.calendario_id, old.modo) then
    new.dados_rev := old.dados_rev + 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_plano_rev_atributos on public.planejamento;
create trigger trg_plano_rev_atributos before update on public.planejamento
  for each row execute function public.fn_plano_rev_atributos();
