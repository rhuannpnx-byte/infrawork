-- 0060 — Mais duas gravações em vários passos viram uma transação, com as permissões de quem chama:
--   reajuste_criar: rascunho de reajuste e, copiando outro, os grupos (índice anterior = atual do outro) e a
--     classificação das receitas. Antes, uma falha no meio deixava um rascunho com parte dos grupos.
--   equipes_ordenar: a ordem (prioridade no cronograma) num único update. Antes, um pedido por equipe.

create function public.reajuste_criar(_obra_id uuid, _data date, _descricao text default null, _copiar_de uuid default null)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare v_id uuid; g record; v_novo uuid;
begin
  insert into public.orcamento_reajuste (obra_id, data, descricao)
  values (_obra_id, _data, nullif(btrim(_descricao), ''))
  returning id into v_id;
  if _copiar_de is not null then
    if not exists (select 1 from public.orcamento_reajuste where id = _copiar_de and obra_id = _obra_id) then
      raise exception 'Reajuste a copiar não encontrado nesta obra';
    end if;
    for g in select id, ordem, nome, indice_atual from public.orcamento_reajuste_grupo
              where reajuste_id = _copiar_de order by ordem, id loop
      insert into public.orcamento_reajuste_grupo (reajuste_id, ordem, nome, indice_anterior, indice_atual)
      values (v_id, g.ordem, g.nome, g.indice_atual, g.indice_atual)
      returning id into v_novo;
      insert into public.orcamento_reajuste_item (reajuste_id, receita_id, grupo_id)
      select v_id, i.receita_id, v_novo from public.orcamento_reajuste_item i
       where i.reajuste_id = _copiar_de and i.grupo_id = g.id;
    end loop;
  end if;
  return v_id;
end
$$;

create function public.equipes_ordenar(_obra_id uuid, _ids uuid[])
returns integer
language plpgsql
set search_path to 'public'
as $$
declare n int;
begin
  update public.equipe e set ordem = x.ordem
    from (select id, (ord - 1)::int as ordem from unnest(_ids) with ordinality as u(id, ord)) x
   where e.id = x.id and e.obra_id = _obra_id and e.ordem is distinct from x.ordem;
  get diagnostics n = row_count;
  return n;
end
$$;
