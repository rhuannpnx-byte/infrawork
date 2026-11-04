-- InfraWork Web — Importação da planilha orçamentária v3: modo da quantidade
-- do agrupador vindo da planilha, igual à tela de agrupar.
--
-- Cada agrupamento pode trazer:
--   * modo: 'manual' | 'heranca' | 'soma_filhos' (vazio = automático: manual se
--     houver quantidade; senão herança com 1 receita ou soma com várias);
--   * receitas_ref: códigos das receitas que compõem a quantidade
--     (coluna "Compõe a quantidade" do modelo). Vazio = todas as receitas.
-- Grava qtd_ref_modo + qtd_ref_filhos como a tela, então a quantidade de
-- referência acompanha as mudanças das receitas (recalcular_orcamento).

create or replace function public.importar_orcamento(
  _obra_id       uuid,
  _itens         jsonb,
  _agrupamentos  jsonb default '[]'::jsonb,
  _opcoes        jsonb default '{}'::jsonb
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
  it jsonb; ag jsonb;
  v_row int; v_codigo text; v_desc text; v_unid text; v_qtd numeric; v_venda numeric;
  prefixo text; v_parent_id uuid; existente_id uuid; existente_tipo text; v_tipo text;
  -- agrupamentos
  v_chave text; v_serv_cod text; v_qtd_manual numeric; v_codigos text[];
  v_servico_id uuid; v_serv_unid text; v_ids uuid[]; n_achadas int; n_agrupadas int;
  v_modo text; v_qtd_ref numeric; grupo_id uuid; grupo_codigo text;
  v_ref_cod text[]; v_ref_ids uuid[];
  n_etapas int := 0; n_receitas int := 0; n_atualizados int := 0; n_pulados int := 0;
  n_agr_criados int := 0; n_agr_pulados int := 0;
  grupos jsonb := '[]'::jsonb; erros jsonb := '[]'::jsonb;
begin
  if existentes not in ('pular', 'atualizar') then
    raise exception 'opção existentes inválida: %', existentes;
  end if;
  perform pg_advisory_xact_lock(hashtext('import:' || _obra_id::text));

  -- ── 1. Etapas e receitas ────────────────────────────────────────────────
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
         where obra_id = _obra_id and codigo = prefixo;
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

  -- ── 2. Agrupamentos (opcional) ──────────────────────────────────────────
  for ag in select e.value from jsonb_array_elements(coalesce(_agrupamentos, '[]'::jsonb)) e
  loop
    begin
      v_row      := coalesce((ag->>'row')::int, 0);
      v_chave    := trim(ag->>'chave');
      v_desc     := trim(ag->>'descricao');
      v_serv_cod := nullif(trim(ag->>'servico_codigo'), '');
      v_qtd_manual := nullif(ag->>'quantidade_referencia', '')::numeric;
      v_modo     := nullif(trim(ag->>'modo'), '');
      select coalesce(array_agg(trim(x)), '{}') into v_ref_cod
        from jsonb_array_elements_text(coalesce(ag->'receitas_ref', '[]'::jsonb)) x;
      if v_modo is not null and v_modo not in ('manual', 'heranca', 'soma_filhos') then
        raise exception 'Modo da quantidade inválido: %', v_modo;
      end if;
      select coalesce(array_agg(trim(x)), '{}') into v_codigos
        from jsonb_array_elements_text(coalesce(ag->'receitas', '[]'::jsonb)) x;

      if v_desc is null or v_desc = '' then raise exception 'Descrição do agrupamento obrigatória'; end if;
      if array_length(v_codigos, 1) is null then raise exception 'Agrupamento sem receitas'; end if;
      if not (v_ref_cod <@ v_codigos) then
        raise exception 'Receita de referência fora do agrupamento';
      end if;
      if v_qtd_manual is not null and v_qtd_manual <= 0 then
        raise exception 'Quantidade de referência deve ser > 0';
      end if;

      v_servico_id := null; v_serv_unid := null;
      if v_serv_cod is not null then
        select s.id, s.unidade into v_servico_id, v_serv_unid
          from public.servico s
         where s.obra_id = _obra_id and s.codigo = v_serv_cod and s.unidade is not null;
        if v_servico_id is null then raise exception 'Composição não encontrada: %', v_serv_cod; end if;
      end if;

      select coalesce(array_agg(i.id order by i.codigo), '{}'),
             count(*),
             count(*) filter (where p.tipo = 'servico_grupo')
        into v_ids, n_achadas, n_agrupadas
        from public.item_orcamentario i
        left join public.item_orcamentario p on p.id = i.parent_id
       where i.obra_id = _obra_id and i.tipo = 'receita' and i.codigo = any(v_codigos);

      if n_achadas <> array_length(v_codigos, 1) then
        raise exception 'Receitas não encontradas na planilha: %',
          (select string_agg(c, ', ') from unnest(v_codigos) c
            where not exists (select 1 from public.item_orcamentario i
                               where i.obra_id = _obra_id and i.tipo = 'receita' and i.codigo = c));
      end if;
      if n_agrupadas = n_achadas then
        -- reimportação: as receitas já estão agrupadas — mantém como está
        n_agr_pulados := n_agr_pulados + 1;
        continue;
      end if;
      if n_agrupadas > 0 then
        raise exception 'Parte das receitas já pertence a outro agrupamento';
      end if;

      -- sem composição: unidade de referência = a das receitas, se for uma só
      if v_servico_id is null then
        select case when count(distinct lower(trim(unidade))) = 1 then min(unidade) end
          into v_serv_unid
          from public.item_orcamentario where id = any(v_ids);
      end if;

      -- Modo (iguais aos da tela de agrupar). Sem modo informado: manual se
      -- houver quantidade; senão herança (1 receita) ou soma (várias).
      if v_modo is null then
        v_modo := case when v_qtd_manual is not null then 'manual'
                       when n_achadas = 1 then 'heranca'
                       else 'soma_filhos' end;
      end if;

      -- Receitas de referência (qtd_ref_filhos): as marcadas; nenhuma = todas.
      if array_length(v_ref_cod, 1) is null then
        v_ref_ids := v_ids;
      else
        select coalesce(array_agg(id order by codigo), '{}') into v_ref_ids
          from public.item_orcamentario
         where obra_id = _obra_id and tipo = 'receita' and codigo = any(v_ref_cod);
      end if;

      if v_modo = 'manual' then
        if v_qtd_manual is null then raise exception 'Modo Manual exige a quantidade de referência'; end if;
        v_qtd_ref := v_qtd_manual;
        v_ref_ids := '{}';
      elsif v_modo = 'heranca' then
        if coalesce(array_length(v_ref_ids, 1), 0) <> 1 then
          raise exception 'Modo Herdar exige exatamente 1 receita de referência (há %)',
            coalesce(array_length(v_ref_ids, 1), 0);
        end if;
        select quantidade into v_qtd_ref from public.item_orcamentario where id = v_ref_ids[1];
      else
        select coalesce(sum(quantidade), 0) into v_qtd_ref
          from public.item_orcamentario where id = any(v_ref_ids);
      end if;

      insert into public.item_orcamentario (obra_id, parent_id, codigo, descricao, tipo, servico_id,
                                            unidade_referencia, qtd_ref_modo, quantidade_referencia,
                                            qtd_ref_filhos)
      values (_obra_id, null, null, v_desc, 'servico_grupo', v_servico_id,
              v_serv_unid, v_modo, v_qtd_ref,
              v_ref_ids)
      returning id, codigo into grupo_id, grupo_codigo;

      update public.item_orcamentario set parent_id = grupo_id where id = any(v_ids);

      n_agr_criados := n_agr_criados + 1;
      if v_servico_id is not null then
        grupos := grupos || jsonb_build_object('item_id', grupo_id, 'servico_id', v_servico_id,
                                               'codigo', grupo_codigo, 'resnapshot', true);
      end if;
    exception when others then
      if tudo_ou_nada then raise; end if;
      erros := erros || jsonb_build_object('row', v_row, 'msg', sqlerrm, 'codigo', v_chave);
    end;
  end loop;

  perform public.recalcular_orcamento(_obra_id);

  return jsonb_build_object(
    'ok', jsonb_array_length(erros) = 0,
    'stats', jsonb_build_object(
      'etapas_criadas', n_etapas, 'receitas_criadas', n_receitas,
      'atualizados', n_atualizados, 'pulados', n_pulados,
      'agrupamentos_criados', n_agr_criados, 'agrupamentos_pulados', n_agr_pulados),
    'grupos', grupos,
    'erros', erros,
    'duracao_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int
  );
end
$$;
alter function public.importar_orcamento(uuid, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.importar_orcamento(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.importar_orcamento(uuid, jsonb, jsonb, jsonb) to service_role;
