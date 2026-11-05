-- InfraWork Web — excluir e mover tarefas falhavam com "DELETE requires a WHERE clause": o safeupdate do PostgREST
-- recusa DELETE sem WHERE, inclusive na limpeza das tabelas temporárias destas funções (0028).

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
  delete from _mover where true;
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
  delete from _excluir where true;
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
