-- InfraWork Web — Importação por modelo padrão (templates XLSX do sistema).
--
--   norm_txt(text)            normalização (lower + sem acento + espaços) — mesma regra do cliente.
--   importar_recursos         upsert de recursos + preço vigente.
--   importar_composicoes      upsert de serviços (hierarquia por código) + CPU vigente + itens.
--                             Também é o "salvar" da tela Nova composição (array de 1).
--   importar_orcamento        itens da planilha orçamentária (etapa / receita / servico_grupo+receita).
--                             Só service_role — chamada pela edge function import-orcamento,
--                             que em seguida cria os snapshots de CPU (service_role).
--
-- Todas SECURITY DEFINER (owner postgres): primeira coisa é checar
-- pode_editar_orcamento(_obra_id); ids recebidos são validados contra a obra.
-- Savepoint por linha (bloco BEGIN/EXCEPTION) + opção tudo_ou_nada.

-- ─────────────────────────────────────────────────────────────────────────
-- norm_txt
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.norm_txt(_s text)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select lower(regexp_replace(trim(extensions.unaccent(coalesce(_s, ''))), '\s+', ' ', 'g'))
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Helpers internos
-- ─────────────────────────────────────────────────────────────────────────

-- Grupo de recurso correspondente ao grupo do item de CPU.
create or replace function public.imp_grupo_recurso(_grupo_item text)
returns text
language sql
immutable
as $$
  select case _grupo_item
    when 'EQUIPAMENTO' then 'MVE'
    when 'MO' then 'MO'
    when 'MATERIAL' then 'MATERIAL'
    when 'COMBUSTIVEL' then 'COMBUSTIVEL'
    else null end
$$;

-- Marca um preço como vigente (zera os demais do recurso). Sem checagem de
-- papel: uso interno das RPCs (já validadas por pode_editar_orcamento).
create or replace function public.imp_definir_preco_vigente(_recurso_id uuid, _preco numeric, _origem text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  atual numeric;
  novo_id uuid;
begin
  if _preco is null then return false; end if;
  atual := public.preco_vigente_recurso(_recurso_id);
  if atual is not null and atual = _preco then return false; end if;
  update public.recurso_preco set is_vigente = false
   where recurso_id = _recurso_id and is_vigente = true;
  insert into public.recurso_preco (recurso_id, custo_unitario, vigencia_inicio, origem, is_vigente, criado_por)
  values (_recurso_id, _preco, current_date, coalesce(_origem, 'importacao_modelo'), true, auth.uid())
  returning id into novo_id;
  return true;
end
$$;
alter function public.imp_definir_preco_vigente(uuid, numeric, text) owner to postgres;
revoke all on function public.imp_definir_preco_vigente(uuid, numeric, text) from public;

-- ─────────────────────────────────────────────────────────────────────────
-- importar_recursos
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.importar_recursos(
  _obra_id uuid,
  _linhas  jsonb,
  _opcoes  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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
alter function public.importar_recursos(uuid, jsonb, jsonb) owner to postgres;
revoke all on function public.importar_recursos(uuid, jsonb, jsonb) from public;
grant execute on function public.importar_recursos(uuid, jsonb, jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- importar_composicoes
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.importar_composicoes(
  _obra_id      uuid,
  _composicoes  jsonb,
  _opcoes       jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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
  it_row int; it_grupo text; it_grupo_rec text; it_ref text; it_unid text; it_preco numeric;
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
          if rec_id is null then
            if it_ref is null then raise exception 'Recurso obrigatório'; end if;
            if not criar_recursos then
              raise exception 'Recurso não encontrado: % (%)', it_ref, it_grupo_rec;
            end if;
            insert into public.recurso (obra_id, grupo, nome, unidade, ativo, fonte, observacao)
            values (_obra_id, it_grupo_rec, it_ref, coalesce(it_unid, 'un'), true, 'importacao_modelo',
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
$$;
alter function public.importar_composicoes(uuid, jsonb, jsonb) owner to postgres;
revoke all on function public.importar_composicoes(uuid, jsonb, jsonb) from public;
grant execute on function public.importar_composicoes(uuid, jsonb, jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- importar_orcamento (service_role; snapshots são feitos pela edge function)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.importar_orcamento(
  _obra_id uuid,
  _itens   jsonb,
  _opcoes  jsonb default '{}'::jsonb
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
  it jsonb;
  v_row int; v_codigo text; v_desc text; v_unid text; v_qtd numeric; v_venda numeric;
  v_serv_cod text; v_fator numeric;
  prefixo text; v_parent_id uuid; existente_id uuid; existente_tipo text; existente_serv uuid;
  v_servico_id uuid; v_serv_unid text; wrapper_id uuid; child_id uuid; v_tipo text;
  n_etapas int := 0; n_receitas int := 0; n_grupos int := 0; n_atualizados int := 0; n_pulados int := 0;
  grupos jsonb := '[]'::jsonb; erros jsonb := '[]'::jsonb;
begin
  if existentes not in ('pular', 'atualizar') then
    raise exception 'opção existentes inválida: %', existentes;
  end if;
  perform pg_advisory_xact_lock(hashtext('import:' || _obra_id::text));

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
      v_serv_cod := nullif(trim(it->>'servico_codigo'), '');
      v_fator  := coalesce(nullif(it->>'fator', '')::numeric, 1);
      if v_codigo is null or v_codigo !~ '^[0-9]+(\.[0-9]+)*$' then
        raise exception 'Código inválido: %', coalesce(v_codigo, '(vazio)');
      end if;
      if v_desc is null or v_desc = '' then raise exception 'Descrição obrigatória'; end if;

      -- tipo da linha
      if v_unid is null and v_qtd is null then
        v_tipo := 'etapa';
      else
        if v_unid is null then raise exception 'Unidade obrigatória quando há quantidade'; end if;
        if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade deve ser > 0'; end if;
        if v_venda is null then raise exception 'Preço unitário de venda obrigatório'; end if;
        if v_fator <= 0 then raise exception 'Fator de conversão deve ser > 0'; end if;
        v_tipo := case when v_serv_cod is not null then 'servico_grupo' else 'receita' end;
      end if;

      -- pai pelo prefixo do código (se existir)
      v_parent_id := null;
      if position('.' in v_codigo) > 0 then
        prefixo := left(v_codigo, length(v_codigo) - position('.' in reverse(v_codigo)));
        select id into v_parent_id from public.item_orcamentario
         where obra_id = _obra_id and codigo = prefixo;
      end if;

      -- composição alvo (folha com CPU vigente)
      v_servico_id := null; v_serv_unid := null;
      if v_tipo = 'servico_grupo' then
        select s.id, s.unidade into v_servico_id, v_serv_unid
          from public.servico s where s.obra_id = _obra_id and s.codigo = v_serv_cod;
        if v_servico_id is null then
          raise exception 'Composição não encontrada: %', v_serv_cod;
        end if;
      end if;

      select id, tipo, servico_id into existente_id, existente_tipo, existente_serv
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
        elsif v_tipo = 'receita' then
          update public.item_orcamentario
             set descricao = v_desc, unidade = v_unid, quantidade = v_qtd, venda_unitaria = v_venda
           where id = existente_id;
        else
          update public.item_orcamentario
             set descricao = v_desc,
                 servico_id = v_servico_id,
                 cpu_snapshot_id = case when servico_id is distinct from v_servico_id then null else cpu_snapshot_id end,
                 unidade_referencia = coalesce(v_serv_unid, v_unid),
                 qtd_ref_modo = case when v_fator = 1 then 'heranca' else 'manual' end,
                 quantidade_referencia = v_qtd * v_fator
           where id = existente_id;
          -- receita filha (primeira)
          select id into child_id from public.item_orcamentario
           where parent_id = existente_id and tipo = 'receita' order by ordem, codigo limit 1;
          if child_id is not null then
            update public.item_orcamentario
               set descricao = v_desc, unidade = v_unid, quantidade = v_qtd, venda_unitaria = v_venda
             where id = child_id;
          end if;
          grupos := grupos || jsonb_build_object('item_id', existente_id, 'servico_id', v_servico_id, 'codigo', v_codigo, 'resnapshot', existente_serv is distinct from v_servico_id);
        end if;
        n_atualizados := n_atualizados + 1;
        continue;
      end if;

      if v_tipo = 'etapa' then
        insert into public.item_orcamentario (obra_id, parent_id, codigo, descricao, tipo)
        values (_obra_id, v_parent_id, v_codigo, v_desc, 'etapa');
        n_etapas := n_etapas + 1;
      elsif v_tipo = 'receita' then
        insert into public.item_orcamentario (obra_id, parent_id, codigo, descricao, tipo, unidade, quantidade, venda_unitaria)
        values (_obra_id, v_parent_id, v_codigo, v_desc, 'receita', v_unid, v_qtd, v_venda);
        n_receitas := n_receitas + 1;
      else
        insert into public.item_orcamentario (obra_id, parent_id, codigo, descricao, tipo, servico_id,
                                              unidade_referencia, qtd_ref_modo, quantidade_referencia)
        values (_obra_id, v_parent_id, v_codigo, v_desc, 'servico_grupo', v_servico_id,
                coalesce(v_serv_unid, v_unid),
                case when v_fator = 1 then 'heranca' else 'manual' end,
                v_qtd * v_fator)
        returning id into wrapper_id;
        insert into public.item_orcamentario (obra_id, parent_id, codigo, descricao, tipo, unidade, quantidade, venda_unitaria)
        values (_obra_id, wrapper_id, null, v_desc, 'receita', v_unid, v_qtd, v_venda)
        returning id into child_id;
        update public.item_orcamentario set qtd_ref_filhos = array[child_id] where id = wrapper_id;
        n_grupos := n_grupos + 1;
        grupos := grupos || jsonb_build_object('item_id', wrapper_id, 'servico_id', v_servico_id, 'codigo', v_codigo, 'resnapshot', true);
      end if;
    exception when others then
      if tudo_ou_nada then raise; end if;
      erros := erros || jsonb_build_object('row', v_row, 'msg', sqlerrm, 'codigo', v_codigo);
    end;
  end loop;

  perform public.recalcular_orcamento(_obra_id);

  return jsonb_build_object(
    'ok', jsonb_array_length(erros) = 0,
    'stats', jsonb_build_object(
      'etapas_criadas', n_etapas, 'receitas_criadas', n_receitas, 'grupos_criados', n_grupos,
      'atualizados', n_atualizados, 'pulados', n_pulados),
    'grupos', grupos,
    'erros', erros,
    'duracao_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int
  );
end
$$;
alter function public.importar_orcamento(uuid, jsonb, jsonb) owner to postgres;
revoke all on function public.importar_orcamento(uuid, jsonb, jsonb) from public;
grant execute on function public.importar_orcamento(uuid, jsonb, jsonb) to service_role;
