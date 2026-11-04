-- InfraWork Web — Importação da planilha orçamentária v4 (rateio).
--
-- Tudo vem da aba "Orçamento" do modelo: a planilha de venda + em cada receita
-- o(s) serviço(s) de destino. A planilha de venda é gravada como está (as
-- receitas NUNCA mudam de pai); os serviços são criados pelo nome e as
-- receitas são ALOCADAS a eles (item_orc_alocacao), com rateio quando há mais
-- de um destino.
--
-- _alocacoes: [{ row, codigo, criterio: 'percentual'|'peso'|'venda',
--                compoe: bool, destinos: [{ servico: text, valor: numeric|null }] }]
--   * destino único = criterio 'percentual', valor 100;
--   * serviço novo: modo da quantidade pelo "compõe" das receitas
--     (nenhuma → manual 1 vb; uma → herdar; várias → somar).

drop function if exists public.importar_orcamento(uuid, jsonb, jsonb, jsonb);

create or replace function public.importar_orcamento(
  _obra_id    uuid,
  _itens      jsonb,
  _alocacoes  jsonb default '[]'::jsonb,
  _opcoes     jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t0 timestamptz := clock_timestamp();
  existentes text := coalesce(_opcoes->>'existentes', 'pular');
  tudo_ou_nada boolean := coalesce((_opcoes->>'tudo_ou_nada')::boolean, true);
  it jsonb; al jsonb; dst jsonb;
  v_row int; v_codigo text; v_desc text; v_unid text; v_qtd numeric; v_venda numeric;
  prefixo text; v_parent_id uuid; existente_id uuid; existente_tipo text; v_tipo text;
  v_receita_id uuid; v_criterio text; v_compoe boolean; v_servico text; v_valor numeric;
  v_grupo_id uuid; criados uuid[] := '{}'; n_dest int;
  n_etapas int := 0; n_receitas int := 0; n_atualizados int := 0; n_pulados int := 0;
  n_servicos int := 0; n_alocadas int := 0; n_rateadas int := 0; n_aloc_puladas int := 0;
  erros jsonb := '[]'::jsonb;
  g record; n_compoe int; v_unid_ref text;
begin
  if existentes not in ('pular', 'atualizar') then
    raise exception 'opção existentes inválida: %', existentes;
  end if;
  perform pg_advisory_xact_lock(hashtext('import:' || _obra_id::text));

  -- ── 1. Planilha de venda: etapas e receitas ─────────────────────────────
  for it in
    select e.value
      from jsonb_array_elements(coalesce(_itens, '[]'::jsonb)) e
     order by array_length(string_to_array(e.value->>'codigo', '.'), 1),
              string_to_array(e.value->>'codigo', '.')::int[]
  loop
    begin
      v_row    := coalesce((it->>'row')::int, 0);
      v_codigo := trim(it->>'codigo');
      v_desc   := trim(it->>'descricao');
      v_unid   := nullif(trim(it->>'unidade'), '');
      v_qtd    := nullif(it->>'quantidade', '')::numeric;
      v_venda  := nullif(it->>'venda_unitaria', '')::numeric;
      if v_codigo is null or v_codigo !~ '^[0-9]+(\.[0-9]+)*$' then
        raise exception 'Código inválido: %', coalesce(v_codigo, '(vazio)');
      end if;
      if v_desc is null or v_desc = '' then raise exception 'Descrição obrigatória'; end if;

      if v_unid is null and v_qtd is null then
        v_tipo := 'etapa';
      else
        if v_unid is null then raise exception 'Unidade obrigatória quando há quantidade'; end if;
        if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade deve ser > 0'; end if;
        if v_venda is null then raise exception 'Preço unitário de venda obrigatório'; end if;
        v_tipo := 'receita';
      end if;

      v_parent_id := null;
      if position('.' in v_codigo) > 0 then
        prefixo := left(v_codigo, length(v_codigo) - position('.' in reverse(v_codigo)));
        select id into v_parent_id from public.item_orcamentario
         where obra_id = _obra_id and codigo = prefixo and tipo = 'etapa';
      end if;

      select id, tipo into existente_id, existente_tipo
        from public.item_orcamentario where obra_id = _obra_id and codigo = v_codigo;

      if existente_id is not null then
        if existentes = 'pular' then
          n_pulados := n_pulados + 1;
          continue;
        end if;
        if existente_tipo <> v_tipo then
          raise exception 'Item % já existe com outro tipo (%)', v_codigo, existente_tipo;
        end if;
        if v_tipo = 'etapa' then
          update public.item_orcamentario set descricao = v_desc where id = existente_id;
        else
          update public.item_orcamentario
             set descricao = v_desc, unidade = v_unid, quantidade = v_qtd, venda_unitaria = v_venda
           where id = existente_id;
        end if;
        n_atualizados := n_atualizados + 1;
        continue;
      end if;

      if v_tipo = 'etapa' then
        insert into public.item_orcamentario (obra_id, parent_id, codigo, descricao, tipo)
        values (_obra_id, v_parent_id, v_codigo, v_desc, 'etapa');
        n_etapas := n_etapas + 1;
      else
        insert into public.item_orcamentario (obra_id, parent_id, codigo, descricao, tipo, unidade, quantidade, venda_unitaria)
        values (_obra_id, v_parent_id, v_codigo, v_desc, 'receita', v_unid, v_qtd, v_venda);
        n_receitas := n_receitas + 1;
      end if;
    exception when others then
      if tudo_ou_nada then raise; end if;
      erros := erros || jsonb_build_object('row', v_row, 'msg', sqlerrm, 'codigo', v_codigo);
    end;
  end loop;

  -- ── 2. Alocações (serviços e rateios) ───────────────────────────────────
  for al in select e.value from jsonb_array_elements(coalesce(_alocacoes, '[]'::jsonb)) e
  loop
    begin
      v_row      := coalesce((al->>'row')::int, 0);
      v_codigo   := trim(al->>'codigo');
      v_criterio := coalesce(nullif(trim(al->>'criterio'), ''), 'percentual');
      v_compoe   := coalesce((al->>'compoe')::boolean, false);
      n_dest     := jsonb_array_length(coalesce(al->'destinos', '[]'::jsonb));
      if n_dest = 0 then continue; end if;

      select id into v_receita_id from public.item_orcamentario
       where obra_id = _obra_id and codigo = v_codigo and tipo = 'receita';
      if v_receita_id is null then raise exception 'Receita % não encontrada', v_codigo; end if;

      if exists (select 1 from public.item_orc_alocacao where receita_id = v_receita_id) then
        if existentes = 'pular' then
          n_aloc_puladas := n_aloc_puladas + 1;
          continue;
        end if;
        delete from public.item_orc_alocacao where receita_id = v_receita_id;
      end if;

      for dst in select d.value from jsonb_array_elements(al->'destinos') d
      loop
        v_servico := trim(dst->>'servico');
        v_valor   := nullif(dst->>'valor', '')::numeric;
        if v_servico is null or v_servico = '' then raise exception 'Serviço vazio no rateio'; end if;

        select id into v_grupo_id from public.item_orcamentario
         where obra_id = _obra_id and tipo = 'servico_grupo'
           and lower(trim(descricao)) = lower(v_servico)
         order by codigo limit 1;
        if v_grupo_id is null then
          insert into public.item_orcamentario (obra_id, parent_id, codigo, descricao, tipo,
                                                qtd_ref_modo, quantidade_referencia)
          values (_obra_id, null, null, v_servico, 'servico_grupo', 'soma_filhos', 0)
          returning id into v_grupo_id;
          criados := criados || v_grupo_id;
          n_servicos := n_servicos + 1;
        end if;

        insert into public.item_orc_alocacao (obra_id, grupo_id, receita_id, criterio, valor, compoe_qtd)
        values (_obra_id, v_grupo_id, v_receita_id, v_criterio,
                case when v_criterio = 'venda' then null else v_valor end, v_compoe);
      end loop;

      n_alocadas := n_alocadas + 1;
      if n_dest > 1 then n_rateadas := n_rateadas + 1; end if;
    exception when others then
      if tudo_ou_nada then raise; end if;
      erros := erros || jsonb_build_object('row', v_row, 'msg', sqlerrm, 'codigo', v_codigo);
    end;
  end loop;

  -- ── 3. Serviços novos: modo/unidade da quantidade pelo "compõe" ─────────
  for g in select id from public.item_orcamentario where id = any(criados)
  loop
    select count(*),
           case when count(distinct lower(trim(r.unidade))) = 1 then min(r.unidade) end
      into n_compoe, v_unid_ref
      from public.item_orc_alocacao a
      join public.item_orcamentario r on r.id = a.receita_id
     where a.grupo_id = g.id and a.compoe_qtd;
    if n_compoe = 0 then
      update public.item_orcamentario
         set qtd_ref_modo = 'manual', quantidade_referencia = 1, unidade_referencia = 'vb'
       where id = g.id;
    else
      update public.item_orcamentario
         set qtd_ref_modo = case when n_compoe = 1 then 'heranca' else 'soma_filhos' end,
             unidade_referencia = v_unid_ref
       where id = g.id;
    end if;
  end loop;

  perform public.recalcular_orcamento(_obra_id);

  return jsonb_build_object(
    'ok', jsonb_array_length(erros) = 0,
    'stats', jsonb_build_object(
      'etapas_criadas', n_etapas, 'receitas_criadas', n_receitas,
      'atualizados', n_atualizados, 'pulados', n_pulados,
      'servicos_criados', n_servicos, 'receitas_alocadas', n_alocadas,
      'receitas_rateadas', n_rateadas, 'alocacoes_puladas', n_aloc_puladas),
    'grupos', '[]'::jsonb,
    'erros', erros,
    'duracao_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int
  );
end
$$;
alter function public.importar_orcamento(uuid, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.importar_orcamento(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.importar_orcamento(uuid, jsonb, jsonb, jsonb) to service_role;
