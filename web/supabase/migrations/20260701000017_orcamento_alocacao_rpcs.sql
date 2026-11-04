-- InfraWork Web — operações de alocação/rateio usadas pela tela do orçamento.
-- Todas SECURITY INVOKER (a RLS de item_orc_alocacao vale) e transacionais;
-- cada uma termina com recalcular_orcamento da obra.

-- O modo exibido acompanha o "compõe": 1 receita = herdar, várias = somar.
create or replace function public.fn_item_orc_aloc_sync_modo(_obra_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.item_orcamentario g
     set qtd_ref_modo = case
           when (select count(*) from public.item_orc_alocacao a where a.grupo_id = g.id and a.compoe_qtd) = 1
             then 'heranca' else 'soma_filhos' end
   where g.obra_id = _obra_id and g.tipo = 'servico_grupo' and g.qtd_ref_modo <> 'manual';
$$;
alter function public.fn_item_orc_aloc_sync_modo(uuid) owner to postgres;

-- ─── Alocar receitas a um serviço (100% ou o saldo do rateio percentual) ──
create or replace function public.alocar_receitas(_grupo_id uuid, _receita_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_obra uuid; rid uuid; v_crit text; v_soma numeric; v_saldo numeric;
  v_unid_grupo text; v_tem_compoe boolean; v_unids int; v_compoe boolean;
  n_ok int := 0; avisos text[] := '{}'; v_cod text;
begin
  select obra_id, unidade_referencia into v_obra, v_unid_grupo
    from public.item_orcamentario where id = _grupo_id and tipo = 'servico_grupo';
  if v_obra is null then raise exception 'Serviço não encontrado'; end if;

  -- primeiras receitas de um serviço sem referência de quantidade compõem a
  -- quantidade (se tiverem a mesma unidade)
  select exists (select 1 from public.item_orc_alocacao where grupo_id = _grupo_id and compoe_qtd)
    into v_tem_compoe;
  select count(distinct lower(trim(unidade))) into v_unids
    from public.item_orcamentario where id = any(_receita_ids);
  v_compoe := not v_tem_compoe and v_unids = 1;

  foreach rid in array _receita_ids loop
    select codigo into v_cod from public.item_orcamentario where id = rid;
    if exists (select 1 from public.item_orc_alocacao where grupo_id = _grupo_id and receita_id = rid) then
      avisos := avisos || (v_cod || ': já está neste serviço');
      continue;
    end if;
    select min(criterio), coalesce(sum(valor), 0) into v_crit, v_soma
      from public.item_orc_alocacao where receita_id = rid;
    if v_crit is null then
      v_saldo := 100;
    elsif v_crit = 'percentual' then
      v_saldo := 100 - v_soma;
      if v_saldo <= 0.0001 then
        avisos := avisos || (v_cod || ': já está 100% alocada — use Ratear');
        continue;
      end if;
    else
      avisos := avisos || (v_cod || ': rateada por ' || v_crit || ' — use Ratear');
      continue;
    end if;
    insert into public.item_orc_alocacao (obra_id, grupo_id, receita_id, criterio, valor, compoe_qtd)
    values (v_obra, _grupo_id, rid, 'percentual', v_saldo, v_compoe);
    n_ok := n_ok + 1;
  end loop;

  if v_compoe and v_unid_grupo is null then
    update public.item_orcamentario g
       set unidade_referencia = (select min(unidade) from public.item_orcamentario where id = any(_receita_ids))
     where g.id = _grupo_id and g.servico_id is null and g.indireto_id is null;
  end if;

  perform public.fn_item_orc_aloc_sync_modo(v_obra);
  perform public.recalcular_orcamento(v_obra);
  return jsonb_build_object('alocadas', n_ok, 'avisos', to_jsonb(avisos));
end $$;

-- ─── Salvar o rateio de uma receita (substitui todas as alocações dela) ───
-- _destinos: [{ grupo_id, valor, compoe_qtd, bases? }]
create or replace function public.salvar_rateio_receita(_receita_id uuid, _criterio text, _destinos jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_obra uuid; d jsonb;
begin
  select obra_id into v_obra from public.item_orcamentario where id = _receita_id and tipo = 'receita';
  if v_obra is null then raise exception 'Receita não encontrada'; end if;
  if _criterio not in ('percentual', 'peso', 'venda') then raise exception 'Critério inválido: %', _criterio; end if;

  delete from public.item_orc_alocacao where receita_id = _receita_id;
  for d in select e.value from jsonb_array_elements(coalesce(_destinos, '[]'::jsonb)) e loop
    insert into public.item_orc_alocacao (obra_id, grupo_id, receita_id, criterio, valor, compoe_qtd, bases)
    values (v_obra, (d->>'grupo_id')::uuid, _receita_id, _criterio,
            nullif(d->>'valor', '')::numeric,
            coalesce((d->>'compoe_qtd')::boolean, false),
            case when jsonb_typeof(d->'bases') = 'array'
                 then (select array_agg(x::uuid) from jsonb_array_elements_text(d->'bases') x) end);
  end loop;

  perform public.fn_item_orc_aloc_sync_modo(v_obra);
  perform public.recalcular_orcamento(v_obra);
end $$;

-- ─── Remover alocações (por id) ───────────────────────────────────────────
create or replace function public.remover_alocacoes(_ids uuid[])
returns int language plpgsql security invoker set search_path = public as $$
declare
  v_obra uuid; n int;
begin
  select obra_id into v_obra from public.item_orc_alocacao where id = any(_ids) limit 1;
  if v_obra is null then return 0; end if;
  delete from public.item_orc_alocacao where id = any(_ids);
  get diagnostics n = row_count;
  perform public.fn_item_orc_aloc_sync_modo(v_obra);
  perform public.recalcular_orcamento(v_obra);
  return n;
end $$;

-- ─── Compõe a quantidade (liga/desliga) ───────────────────────────────────
create or replace function public.set_alocacao_compoe(_id uuid, _compoe boolean)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_obra uuid;
begin
  update public.item_orc_alocacao set compoe_qtd = _compoe where id = _id
  returning obra_id into v_obra;
  if v_obra is null then raise exception 'Alocação não encontrada'; end if;
  perform public.fn_item_orc_aloc_sync_modo(v_obra);
  perform public.recalcular_orcamento(v_obra);
end $$;

grant execute on function public.alocar_receitas(uuid, uuid[]) to authenticated;
grant execute on function public.salvar_rateio_receita(uuid, text, jsonb) to authenticated;
grant execute on function public.remover_alocacoes(uuid[]) to authenticated;
grant execute on function public.set_alocacao_compoe(uuid, boolean) to authenticated;
