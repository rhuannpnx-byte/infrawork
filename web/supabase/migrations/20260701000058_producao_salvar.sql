-- 0058 — Lançamento de produção numa transação: a produção e os materiais dela gravam juntos ou nada grava.
-- Antes o web e o MCP gravavam em pedidos separados; na edição apagavam os materiais e regravavam, e uma falha no
-- meio deixava o lançamento sem material (ou o lote pela metade). Roda com as permissões de quem chama: as regras
-- de acesso e os gatilhos da produção valem como antes.

create function public.producao_salvar(_registros jsonb, _origem text default 'app', _importacao_id uuid default null)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  r jsonb;
  v_id uuid;
  ids uuid[] := '{}';
begin
  if jsonb_typeof(_registros) <> 'array' then
    raise exception '_registros deve ser uma lista de lançamentos';
  end if;
  if _origem not in ('app', 'importacao') then
    raise exception 'origem inválida: %', _origem;
  end if;

  for r in select * from jsonb_array_elements(_registros) loop
    v_id := nullif(r->>'id', '')::uuid;
    if v_id is null then
      insert into public.acompanhamento_producao
        (obra_id, data, item_orcamentario_id, equipe_id, encarregado_id, quantidade, frente, estaca_inicial,
         estaca_final, trecho_id, posicao_inicio_m, posicao_fim_m, obs, origem, importacao_id)
      values
        ((r->>'obra_id')::uuid, (r->>'data')::date, (r->>'item_orcamentario_id')::uuid,
         nullif(r->>'equipe_id', '')::uuid, nullif(r->>'encarregado_id', '')::uuid, (r->>'quantidade')::numeric,
         nullif(btrim(r->>'frente'), ''), nullif(btrim(r->>'estaca_inicial'), ''), nullif(btrim(r->>'estaca_final'), ''),
         nullif(r->>'trecho_id', '')::uuid,
         case when nullif(r->>'trecho_id', '') is not null then nullif(r->>'posicao_inicio_m', '')::numeric end,
         case when nullif(r->>'trecho_id', '') is not null then nullif(r->>'posicao_fim_m', '')::numeric end,
         nullif(btrim(r->>'obs'), ''), _origem, _importacao_id)
      returning id into v_id;
    else
      update public.acompanhamento_producao set
        data = (r->>'data')::date,
        item_orcamentario_id = (r->>'item_orcamentario_id')::uuid,
        equipe_id = nullif(r->>'equipe_id', '')::uuid,
        encarregado_id = nullif(r->>'encarregado_id', '')::uuid,
        quantidade = (r->>'quantidade')::numeric,
        frente = nullif(btrim(r->>'frente'), ''),
        estaca_inicial = nullif(btrim(r->>'estaca_inicial'), ''),
        estaca_final = nullif(btrim(r->>'estaca_final'), ''),
        trecho_id = nullif(r->>'trecho_id', '')::uuid,
        posicao_inicio_m = case when nullif(r->>'trecho_id', '') is not null then nullif(r->>'posicao_inicio_m', '')::numeric end,
        posicao_fim_m = case when nullif(r->>'trecho_id', '') is not null then nullif(r->>'posicao_fim_m', '')::numeric end,
        obs = nullif(btrim(r->>'obs'), '')
       where id = v_id;
      if not found then raise exception 'Lançamento não encontrado ou sem permissão para editar'; end if;
    end if;

    -- materiais: presentes = substituem os do lançamento; ausentes na edição = ficam como estão
    if r ? 'materiais' then
      if nullif(r->>'id', '') is not null then
        delete from public.acompanhamento_producao_material where producao_id = v_id;
      end if;
      insert into public.acompanhamento_producao_material (producao_id, nome, quantidade, unidade, recurso_id)
      select v_id, btrim(coalesce(m->>'nome', '')), nullif(m->>'quantidade', '')::numeric,
             nullif(btrim(m->>'unidade'), ''), nullif(m->>'recurso_id', '')::uuid
        from jsonb_array_elements(coalesce(r->'materiais', '[]'::jsonb)) m
       where btrim(coalesce(m->>'nome', '')) <> '' or nullif(m->>'recurso_id', '') is not null;
    end if;
    ids := ids || v_id;
  end loop;

  return jsonb_build_object('ids', to_jsonb(ids), 'importacao_id', _importacao_id);
end
$$;

-- Serviço novo a partir de uma composição: serviço, vínculo e dono da composição numa transação (antes, três
-- pedidos; uma falha no vínculo deixava o serviço órfão e a falha na troca de dono passava calada).
create function public.servico_criar_da_cpu(
  _obra_id uuid, _codigo text, _nome text, _unidade text, _cpu_id uuid,
  _fator numeric default 1, _operacao text default 'dividir', _parent_id uuid default null)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare v_id uuid;
begin
  insert into public.servico (obra_id, codigo, nome, unidade, parent_id)
  values (_obra_id, btrim(_codigo), btrim(_nome), _unidade, _parent_id)
  returning id into v_id;
  insert into public.servico_cpu_link (servico_id, cpu_id, fator, operacao, ordem)
  values (v_id, _cpu_id, coalesce(_fator, 1), coalesce(_operacao, 'dividir'), 0);
  update public.cpu set servico_id = v_id where id = _cpu_id and obra_id = _obra_id;
  if not found then raise exception 'Composição não encontrada nesta obra'; end if;
  return v_id;
end
$$;
