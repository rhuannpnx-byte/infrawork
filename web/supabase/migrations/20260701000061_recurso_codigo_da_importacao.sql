-- 0061 — Recurso criado pela importação de composições guardava a referência (ex.: código SICRO "E9571") como
-- nome e ficava sem código; histogramas e listas mostravam só o código.
--   importar_composicoes: referência sem espaço vira o código do recurso; a coluna opcional "Nome do recurso"
--     (recurso_nome) dá o nome, inclusive a um recurso já criado só com o código.
--   importar_recursos: acha pelo código também o recurso que tem o código no nome (sem código), e grava os dois.
--   Dados: recursos assim ganham o código (o nome fica até a importação de recursos ou a edição dar o nome).

update public.recurso r
   set codigo = r.nome, updated_at = now()
 where r.codigo is null
   and r.observacao like 'Criado pela importação de composições%'
   and r.nome !~ '\s'
   and not exists (select 1 from public.recurso o where o.obra_id = r.obra_id and o.codigo = r.nome);

CREATE OR REPLACE FUNCTION public.importar_composicoes(_obra_id uuid, _composicoes jsonb, _opcoes jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $_$
declare
  t0 timestamptz := clock_timestamp();
  modo_existente text := coalesce(_opcoes->>'modo_existente', 'substituir_itens');
  criar_recursos boolean := coalesce((_opcoes->>'criar_recursos_faltantes')::boolean, true);
  comb_padrao uuid := nullif(_opcoes->>'combustivel_padrao_recurso_id', '')::uuid;
  tudo_ou_nada boolean := coalesce((_opcoes->>'tudo_ou_nada')::boolean, false);
  c jsonb; it jsonb;
  v_row int; v_codigo text; v_nome text; v_unidade text; v_prod numeric; v_obs text;
  partes text[]; prefixo text; v_parent_id uuid; p_id uuid; i int;
  v_servico_id uuid; v_cpu_id uuid; v_cpu_antiga uuid; v_versao int;
  eh_grupo boolean;
  -- itens
  it_row int; it_grupo text; it_grupo_rec text; it_ref text; it_nome text; it_unid text; it_preco numeric;
  it_qtd numeric; it_horas numeric; it_cons_lh numeric; it_idx numeric; it_cons_mat numeric;
  rec_id uuid; ordem int; tem_comb boolean; soma_lh numeric; custo numeric;
  n_grupos int := 0; n_serv_criados int := 0; n_serv_atualizados int := 0;
  n_cpus_criadas int := 0; n_cpus_atualizadas int := 0; n_cpus_puladas int := 0;
  n_itens int := 0; n_rec_criados int := 0; n_precos int := 0;
  erros jsonb := '[]'::jsonb; avisos jsonb := '[]'::jsonb; resultados jsonb := '[]'::jsonb;
begin
  if not public.pode_editar_orcamento(_obra_id) then
    raise exception 'Sem permissão para editar o orçamento desta obra' using errcode = '42501';
  end if;
  if modo_existente not in ('substituir_itens', 'nova_versao', 'pular', 'erro') then
    raise exception 'modo_existente inválido: %', modo_existente;
  end if;
  if comb_padrao is not null and not exists (
    select 1 from public.recurso where id = comb_padrao and obra_id = _obra_id and grupo = 'COMBUSTIVEL'
  ) then
    raise exception 'combustivel_padrao_recurso_id não é um combustível desta obra';
  end if;
  perform pg_advisory_xact_lock(hashtext('import:' || _obra_id::text));

  -- ordena por profundidade do código e depois pelo código
  for c in
    select e.value
      from jsonb_array_elements(coalesce(_composicoes, '[]'::jsonb)) e
     order by array_length(string_to_array(e.value->>'codigo', '.'), 1), e.value->>'codigo'
  loop
    begin
      v_row     := coalesce((c->>'row')::int, 0);
      v_codigo  := trim(c->>'codigo');
      v_nome    := trim(c->>'nome');
      v_unidade := nullif(trim(c->>'unidade'), '');
      v_prod    := nullif(c->>'producao_qtde', '')::numeric;
      v_obs     := nullif(trim(c->>'observacao'), '');
      if v_codigo is null or v_codigo !~ '^[0-9]{1,3}(\.[0-9]{1,3})*$' then
        raise exception 'Código inválido: %', coalesce(v_codigo, '(vazio)');
      end if;
      if v_nome is null or v_nome = '' then raise exception 'Nome obrigatório'; end if;
      eh_grupo := v_unidade is null;
      if not eh_grupo and upper(v_unidade) = 'DIA' then
        raise exception 'Unidade "DIA" não é permitida para composição';
      end if;
      if not eh_grupo and (v_prod is null or v_prod <= 0) then
        raise exception 'Produção por dia deve ser > 0';
      end if;

      -- pais implícitos (grupos) pelos prefixos do código
      partes := string_to_array(v_codigo, '.');
      v_parent_id := null;
      for i in 1 .. array_length(partes, 1) - 1 loop
        prefixo := array_to_string(partes[1:i], '.');
        select id into p_id from public.servico where obra_id = _obra_id and codigo = prefixo;
        if p_id is null then
          insert into public.servico (obra_id, codigo, nome, parent_id, unidade, ativo)
          values (_obra_id, prefixo, 'Grupo ' || prefixo, v_parent_id, null, true)
          returning id into p_id;
          n_grupos := n_grupos + 1;
        end if;
        v_parent_id := p_id;
      end loop;

      -- serviço (grupo ou folha)
      select id into v_servico_id from public.servico where obra_id = _obra_id and codigo = v_codigo;
      if v_servico_id is null then
        insert into public.servico (obra_id, codigo, nome, parent_id, unidade, ativo, descricao)
        values (_obra_id, v_codigo, v_nome, v_parent_id, v_unidade, true, null)
        returning id into v_servico_id;
        n_serv_criados := n_serv_criados + 1;
      else
        update public.servico
           set nome = v_nome, parent_id = v_parent_id, unidade = v_unidade, ativo = true
         where id = v_servico_id;
        n_serv_atualizados := n_serv_atualizados + 1;
      end if;

      if eh_grupo then
        continue;
      end if;

      -- CPU vigente
      select id into v_cpu_antiga from public.cpu where servico_id = v_servico_id and is_vigente = true;
      v_cpu_id := null;
      if v_cpu_antiga is null then
        select coalesce(max(versao), 0) + 1 into v_versao from public.cpu where servico_id = v_servico_id;
        insert into public.cpu (obra_id, servico_id, versao, nome, producao_diaria_qtde, producao_diaria_unidade, notas, is_vigente, criado_por)
        values (_obra_id, v_servico_id, v_versao, v_nome, v_prod, v_unidade, v_obs, true, auth.uid())
        returning id into v_cpu_id;
        n_cpus_criadas := n_cpus_criadas + 1;
      else
        if modo_existente = 'pular' then
          n_cpus_puladas := n_cpus_puladas + 1;
          resultados := resultados || jsonb_build_object('row', v_row, 'codigo', v_codigo, 'servico_id', v_servico_id, 'cpu_id', v_cpu_antiga, 'acao', 'pular');
          continue;
        elsif modo_existente = 'erro' then
          raise exception 'Composição % já existe', v_codigo;
        elsif modo_existente = 'substituir_itens' then
          v_cpu_id := v_cpu_antiga;
          update public.cpu
             set nome = v_nome, producao_diaria_qtde = v_prod, producao_diaria_unidade = v_unidade,
                 notas = coalesce(v_obs, notas)
           where id = v_cpu_id;
          delete from public.cpu_item where cpu_id = v_cpu_id;
          n_cpus_atualizadas := n_cpus_atualizadas + 1;
        else -- nova_versao
          select coalesce(max(versao), 0) + 1 into v_versao from public.cpu where servico_id = v_servico_id;
          insert into public.cpu (obra_id, servico_id, versao, nome, producao_diaria_qtde, producao_diaria_unidade, notas, is_vigente, criado_por)
          values (_obra_id, v_servico_id, v_versao, v_nome, v_prod, v_unidade, v_obs, true, auth.uid())
          returning id into v_cpu_id;
          update public.servico_cpu_link set cpu_id = v_cpu_id
           where servico_id = v_servico_id and cpu_id = v_cpu_antiga;
          n_cpus_criadas := n_cpus_criadas + 1;
        end if;
      end if;

      -- itens: EQ/MO/MAT primeiro, COMBUSTIVEL por último (o cálculo do
      -- combustível agrega os equipamentos já inseridos)
      ordem := 0; tem_comb := false; soma_lh := 0;
      for it in
        select e.value
          from jsonb_array_elements(coalesce(c->'itens', '[]'::jsonb)) with ordinality e(value, ordinality)
         order by case upper(e.value->>'grupo') when 'COMBUSTIVEL' then 1 else 0 end, e.ordinality
      loop
        begin
          it_row   := coalesce((it->>'row')::int, 0);
          it_grupo := upper(trim(it->>'grupo'));
          it_grupo_rec := public.imp_grupo_recurso(it_grupo);
          if it_grupo_rec is null then raise exception 'Tipo inválido: %', it_grupo; end if;
          it_ref   := nullif(trim(it->>'recurso_ref'), '');
          it_nome  := nullif(trim(it->>'recurso_nome'), '');
          it_unid  := nullif(trim(it->>'recurso_unidade'), '');
          it_preco := nullif(it->>'preco', '')::numeric;
          it_qtd   := nullif(it->>'quantidade', '')::numeric;
          it_horas := nullif(it->>'horas_dia', '')::numeric;
          it_cons_lh := nullif(it->>'consumo_combustivel_lh', '')::numeric;
          it_idx   := nullif(it->>'indice_produtividade', '')::numeric;
          it_cons_mat := nullif(it->>'consumo_material_por_unid', '')::numeric;

          -- resolve recurso: id → código → (grupo, nome normalizado)
          rec_id := nullif(it->>'recurso_id', '')::uuid;
          if rec_id is not null and not exists (
            select 1 from public.recurso where id = rec_id and obra_id = _obra_id
          ) then
            raise exception 'recurso_id de outra obra';
          end if;
          if rec_id is null and it_ref is not null then
            select id into rec_id from public.recurso
             where obra_id = _obra_id and codigo = it_ref limit 1;
            if rec_id is null then
              select id into rec_id from public.recurso
               where obra_id = _obra_id and grupo = it_grupo_rec
                 and public.norm_txt(nome) = public.norm_txt(it_ref)
               limit 1;
            end if;
          end if;
          if rec_id is not null and it_nome is not null then
            update public.recurso set nome = it_nome, updated_at = now()
             where id = rec_id and codigo is not null and nome = codigo
               and not exists (select 1 from public.recurso o
                                where o.obra_id = _obra_id and o.grupo = it_grupo_rec and o.id <> rec_id
                                  and public.norm_txt(o.nome) = public.norm_txt(it_nome));
          end if;
          if rec_id is null then
            if it_ref is null then raise exception 'Recurso obrigatório'; end if;
            if not criar_recursos then
              raise exception 'Recurso não encontrado: % (%)', it_ref, it_grupo_rec;
            end if;
            -- referência sem espaço é código (SICRO, SINAPI, próprio): vira o código do recurso, e o nome vem da
            -- coluna "Nome do recurso" (sem ela, fica o código até uma importação de recursos dar o nome)
            insert into public.recurso (obra_id, grupo, codigo, nome, unidade, ativo, fonte, observacao)
            values (_obra_id, it_grupo_rec,
                    case when it_ref !~ '\s' and not exists (
                           select 1 from public.recurso where obra_id = _obra_id and codigo = it_ref)
                         then it_ref end,
                    coalesce(it_nome, it_ref), coalesce(it_unid, 'un'), true, 'importacao_modelo',
                    'Criado pela importação de composições (' || v_codigo || ')')
            returning id into rec_id;
            n_rec_criados := n_rec_criados + 1;
            if it_preco is not null and public.imp_definir_preco_vigente(rec_id, it_preco, 'importacao_modelo') then
              n_precos := n_precos + 1;
            end if;
          end if;

          -- defaults por grupo
          if it_grupo in ('EQUIPAMENTO', 'MO') then
            it_qtd := coalesce(it_qtd, 1);
            it_horas := coalesce(it_horas, 8);
          elsif it_grupo = 'MATERIAL' then
            it_qtd := coalesce(it_qtd, 0);
            it_horas := null;
          else -- COMBUSTIVEL
            it_qtd := coalesce(it_qtd, 0);
            it_horas := null;
            tem_comb := true;
          end if;
          if it_idx is not null and it_idx > 1 and it_idx <= 100 then it_idx := it_idx / 100; end if;
          it_idx := coalesce(it_idx, 1);
          if it_idx < 0 or it_idx > 1 then raise exception 'Índice produtivo fora de 0..1'; end if;
          if it_grupo = 'EQUIPAMENTO' then soma_lh := soma_lh + coalesce(it_cons_lh, 0) * it_qtd; end if;

          insert into public.cpu_item (cpu_id, grupo, recurso_id, quantidade, horas_dia,
                                       consumo_combustivel_lh, indice_produtividade,
                                       consumo_material_por_unid, ordem)
          values (v_cpu_id, it_grupo, rec_id, it_qtd, it_horas,
                  case when it_grupo = 'EQUIPAMENTO' then it_cons_lh else null end,
                  it_idx,
                  case when it_grupo = 'MATERIAL' then it_cons_mat else null end,
                  ordem);
          ordem := ordem + 1;
          n_itens := n_itens + 1;
        exception when others then
          if tudo_ou_nada then raise; end if;
          erros := erros || jsonb_build_object('row', it_row, 'msg', sqlerrm, 'composicao', v_codigo);
        end;
      end loop;

      -- combustível automático
      if not tem_comb and soma_lh > 0 then
        if comb_padrao is not null then
          insert into public.cpu_item (cpu_id, grupo, recurso_id, quantidade, horas_dia, indice_produtividade, ordem)
          values (v_cpu_id, 'COMBUSTIVEL', comb_padrao, 0, null, 1, ordem);
          n_itens := n_itens + 1;
        else
          avisos := avisos || jsonb_build_object('row', v_row, 'code', 'COMBUSTIVEL_AUSENTE',
            'msg', 'Composição ' || v_codigo || ' tem equipamentos com consumo mas nenhuma linha de combustível');
        end if;
      end if;

      -- vínculo serviço ↔ CPU (fator 1) quando o serviço ainda não tem links
      if not exists (select 1 from public.servico_cpu_link where servico_id = v_servico_id) then
        insert into public.servico_cpu_link (servico_id, cpu_id, fator, operacao, ordem)
        values (v_servico_id, v_cpu_id, 1, 'dividir', 0);
      end if;

      -- garante recálculo (no-op) e coleta custo
      update public.cpu set notas = notas where id = v_cpu_id;
      perform public.fn_cpu_recalc(v_cpu_id);
      select custo_unit_calc into custo from public.cpu where id = v_cpu_id;
      resultados := resultados || jsonb_build_object(
        'row', v_row, 'codigo', v_codigo, 'servico_id', v_servico_id, 'cpu_id', v_cpu_id,
        'custo_unit', custo, 'acao', case when v_cpu_antiga is null then 'criar' else 'atualizar' end);
    exception when others then
      if tudo_ou_nada then raise; end if;
      erros := erros || jsonb_build_object('row', v_row, 'msg', sqlerrm, 'composicao', v_codigo);
    end;
  end loop;

  return jsonb_build_object(
    'ok', jsonb_array_length(erros) = 0,
    'stats', jsonb_build_object(
      'grupos_criados', n_grupos, 'servicos_criados', n_serv_criados,
      'servicos_atualizados', n_serv_atualizados, 'cpus_criadas', n_cpus_criadas,
      'cpus_atualizadas', n_cpus_atualizadas, 'cpus_puladas', n_cpus_puladas,
      'itens_criados', n_itens, 'recursos_criados', n_rec_criados, 'precos_criados', n_precos),
    'resultados', resultados,
    'erros', erros,
    'avisos', avisos,
    'duracao_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int
  );
end
$_$;

CREATE OR REPLACE FUNCTION public.importar_recursos(_obra_id uuid, _linhas jsonb, _opcoes jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  t0 timestamptz := clock_timestamp();
  atualizar_existentes boolean := coalesce((_opcoes->>'atualizar_existentes')::boolean, true);
  atualizar_precos     boolean := coalesce((_opcoes->>'atualizar_precos')::boolean, true);
  tudo_ou_nada         boolean := coalesce((_opcoes->>'tudo_ou_nada')::boolean, false);
  l jsonb;
  v_row int;
  v_grupo text; v_codigo text; v_nome text; v_unidade text; v_obs text;
  v_preco numeric;
  v_id uuid;
  n_criados int := 0; n_atualizados int := 0; n_inalterados int := 0; n_precos int := 0;
  erros jsonb := '[]'::jsonb;
begin
  if not public.pode_editar_orcamento(_obra_id) then
    raise exception 'Sem permissão para editar o orçamento desta obra' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('import:' || _obra_id::text));

  for l in select * from jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) loop
    begin
      v_row     := coalesce((l->>'row')::int, 0);
      v_grupo   := upper(trim(l->>'grupo'));
      v_codigo  := nullif(trim(l->>'codigo'), '');
      v_nome    := trim(l->>'nome');
      v_unidade := nullif(trim(l->>'unidade'), '');
      v_obs     := nullif(trim(l->>'observacao'), '');
      v_preco   := nullif(l->>'preco', '')::numeric;

      if v_grupo not in ('MO', 'MVE', 'COMBUSTIVEL', 'MATERIAL', 'ADM') then
        raise exception 'Grupo inválido: %', v_grupo;
      end if;
      if v_nome is null or v_nome = '' then raise exception 'Nome obrigatório'; end if;
      if v_unidade is null then raise exception 'Unidade obrigatória'; end if;
      if v_preco is not null and v_preco < 0 then raise exception 'Preço negativo'; end if;

      v_id := null;
      if v_codigo is not null then
        select id into v_id from public.recurso where obra_id = _obra_id and codigo = v_codigo;
        -- criado pela importação de composições só com o código, guardado no nome
        if v_id is null then
          select id into v_id from public.recurso
           where obra_id = _obra_id and grupo = v_grupo and codigo is null and nome = v_codigo
           limit 1;
        end if;
      end if;
      if v_id is null then
        select id into v_id from public.recurso
         where obra_id = _obra_id and grupo = v_grupo and public.norm_txt(nome) = public.norm_txt(v_nome)
         limit 1;
      end if;

      if v_id is null then
        insert into public.recurso (obra_id, grupo, codigo, nome, unidade, ativo, fonte, observacao)
        values (_obra_id, v_grupo, v_codigo, v_nome, v_unidade, true, 'importacao_modelo', v_obs)
        returning id into v_id;
        n_criados := n_criados + 1;
        if v_preco is not null and public.imp_definir_preco_vigente(v_id, v_preco, 'importacao_modelo') then
          n_precos := n_precos + 1;
        end if;
      else
        if atualizar_existentes then
          update public.recurso
             set grupo = v_grupo,
                 codigo = coalesce(v_codigo, codigo),
                 nome = v_nome,
                 unidade = v_unidade,
                 observacao = coalesce(v_obs, observacao),
                 ativo = true,
                 updated_at = now()
           where id = v_id;
        end if;
        if atualizar_precos and v_preco is not null
           and public.imp_definir_preco_vigente(v_id, v_preco, 'importacao_modelo') then
          n_precos := n_precos + 1;
          n_atualizados := n_atualizados + 1;
        elsif atualizar_existentes then
          n_inalterados := n_inalterados + 1;
        else
          n_inalterados := n_inalterados + 1;
        end if;
      end if;
    exception when others then
      if tudo_ou_nada then raise; end if;
      erros := erros || jsonb_build_object('row', v_row, 'msg', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'ok', jsonb_array_length(erros) = 0,
    'stats', jsonb_build_object(
      'criados', n_criados, 'atualizados', n_atualizados,
      'inalterados', n_inalterados, 'precos_criados', n_precos),
    'erros', erros,
    'duracao_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int
  );
end
$$;
