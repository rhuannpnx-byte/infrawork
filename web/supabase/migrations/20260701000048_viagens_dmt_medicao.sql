-- Viagens: DMT geométrica, medição por volume ou peso, caixa de empréstimo e sem hodômetro.
--
-- DMT = acesso(origem) + |estaca de carga − estaca de descarga| + acesso(destino), pelo eixo do trecho: um local na
-- pista (corte/aterro) entra com a estaca da própria viagem; os demais (jazida, caixa de empréstimo, bota-fora, usina…)
-- com a estaca onde o acesso encontra o eixo e a distância fixa do acesso. Distância fixa cadastrada para o par
-- (transporte_rota) prevalece — é o caminho real quando o par não se liga pelo eixo. Ajuste manual fica marcado.
-- Quantidade: o serviço define a medição da viagem — volume (m³ da caçamba; sem valor, a capacidade do caminhão) ou
-- peso (t do ticket, obrigatório) — e o fator converte para a unidade do serviço (empolamento, densidade).
-- O hodômetro sai do lançamento (as colunas km_inicial/km_final ficam, sem uso).

-- ── locais de carga e descarga ────────────────────────────────────────────────────────────────────────────────────
alter table public.transporte_local
  add column if not exists estaca_acesso_m     numeric(14,3),
  add column if not exists distancia_acesso_km numeric(10,3) not null default 0;
alter table public.transporte_local drop constraint if exists chk_transp_local_tipo;
alter table public.transporte_local add constraint chk_transp_local_tipo check (tipo = any (array[
  'jazida', 'caixa_emprestimo', 'bota_fora', 'usina', 'central', 'deposito', 'pista', 'outro']));
alter table public.transporte_local drop constraint if exists chk_transp_local_acesso;
alter table public.transporte_local add constraint chk_transp_local_acesso
  check (distancia_acesso_km >= 0 and (estaca_acesso_m is null or estaca_acesso_m >= 0));

create or replace function public.fn_transporte_local_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tr record;
begin
  if new.trecho_id is not null then
    select id, obra_id, tipo, nome, comprimento_m into v_tr from public.obra_trecho where id = new.trecho_id;
    if v_tr.id is null or v_tr.obra_id <> new.obra_id then raise exception 'Local de outra obra'; end if;
  end if;
  new.nome := trim(new.nome);
  if new.nome = '' then raise exception 'Informe o nome do local'; end if;
  if new.tipo = 'pista' then
    if new.trecho_id is null then raise exception 'Local na pista precisa do trecho (eixo ou área)'; end if;
    new.estaca_acesso_m := null;
    new.distancia_acesso_km := 0;
  else
    new.distancia_acesso_km := coalesce(new.distancia_acesso_km, 0);
    if new.estaca_acesso_m is not null then
      if new.trecho_id is null then raise exception 'Escolha o trecho onde fica a estaca de acesso'; end if;
      if v_tr.tipo = 'area' then raise exception 'Estaca de acesso só em eixo (não em área)'; end if;
      if new.estaca_acesso_m > coalesce(v_tr.comprimento_m, 0) + 0.005 then
        raise exception 'Estaca de acesso fora do trecho "%"', v_tr.nome;
      end if;
    end if;
  end if;
  return new;
end $$;

-- ── parametrização: como a viagem é medida ────────────────────────────────────────────────────────────────────────
alter table public.servico_parametro
  add column if not exists medicao_viagem text not null default 'volume',
  add column if not exists fator_viagem   numeric(12,6) not null default 1;
alter table public.servico_parametro drop constraint if exists chk_sp_medicao_viagem;
alter table public.servico_parametro add constraint chk_sp_medicao_viagem
  check (medicao_viagem in ('volume', 'peso') and fator_viagem > 0);

-- ── viagem ────────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.viagem
  add column if not exists estaca_carga_m    numeric(14,3),
  add column if not exists estaca_descarga_m numeric(14,3),
  add column if not exists volume_m3         numeric(14,4),
  add column if not exists peso_t            numeric(14,4),
  add column if not exists dmt_calculada_km  numeric(10,3),
  add column if not exists dmt_manual        boolean not null default false,
  add column if not exists dmt_origem        text;
alter table public.viagem drop constraint if exists chk_viagem_medidas;
alter table public.viagem add constraint chk_viagem_medidas check (
  (volume_m3 is null or volume_m3 > 0) and (peso_t is null or peso_t > 0)
  and (dmt_origem is null or dmt_origem in ('geometria', 'rota', 'manual')));

create or replace function public.fn_viagem_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f record; v_item record; v_par record; v_o record; v_d record; v_tro record; v_trd record;
  v_pc numeric; v_pd numeric; v_geo numeric; v_rota numeric; v_cap numeric; v_fator numeric;
begin
  select obra_id, data, veiculo_id into v_f from public.viagem_ficha where id = new.ficha_id;
  if v_f.obra_id is null then raise exception 'Ficha de viagens inexistente'; end if;
  new.obra_id := v_f.obra_id;
  new.data := v_f.data;
  select obra_id, tipo, descricao into v_item from public.item_orcamentario where id = new.item_orcamentario_id;
  if v_item.obra_id is distinct from new.obra_id or v_item.tipo <> 'servico_grupo' then
    raise exception 'Serviço inválido para a obra';
  end if;
  select modo_lancamento, medicao_viagem, fator_viagem into v_par
    from public.servico_parametro where item_orcamentario_id = new.item_orcamentario_id;
  if coalesce(v_par.modo_lancamento, 'quantidade') <> 'viagens' then
    raise exception 'O serviço "%" não está parametrizado para viagens', v_item.descricao;
  end if;

  -- origem e destino
  if new.origem_id is null or new.destino_id is null then
    raise exception 'Informe a origem e o destino da viagem';
  end if;
  select l.obra_id, l.tipo, l.nome, l.trecho_id, l.estaca_acesso_m, l.distancia_acesso_km into v_o
    from public.transporte_local l where l.id = new.origem_id;
  select l.obra_id, l.tipo, l.nome, l.trecho_id, l.estaca_acesso_m, l.distancia_acesso_km into v_d
    from public.transporte_local l where l.id = new.destino_id;
  if v_o.obra_id is distinct from new.obra_id then raise exception 'Origem de outra obra'; end if;
  if v_d.obra_id is distinct from new.obra_id then raise exception 'Destino de outra obra'; end if;
  select id, tipo, nome, comprimento_m into v_tro from public.obra_trecho where id = v_o.trecho_id;
  select id, tipo, nome, comprimento_m into v_trd from public.obra_trecho where id = v_d.trecho_id;

  -- estacas: na pista a viagem informa; fora dela vale a estaca de acesso do local
  if v_o.tipo = 'pista' and v_tro.tipo = 'eixo' then
    if new.estaca_carga_m is null then
      raise exception 'Informe a estaca de carga (a origem "%" é na pista)', v_o.nome;
    end if;
    if new.estaca_carga_m < 0 or new.estaca_carga_m > coalesce(v_tro.comprimento_m, 0) + 0.005 then
      raise exception 'Estaca de carga fora do trecho "%"', v_tro.nome;
    end if;
    v_pc := new.estaca_carga_m;
  else
    new.estaca_carga_m := null;
    v_pc := case when v_tro.tipo = 'eixo' then v_o.estaca_acesso_m end;
  end if;
  if v_d.tipo = 'pista' and v_trd.tipo = 'eixo' then
    if new.estaca_descarga_m is null then
      raise exception 'Informe a estaca de descarga (o destino "%" é na pista)', v_d.nome;
    end if;
    if new.estaca_descarga_m < 0 or new.estaca_descarga_m > coalesce(v_trd.comprimento_m, 0) + 0.005 then
      raise exception 'Estaca de descarga fora do trecho "%"', v_trd.nome;
    end if;
    v_pd := new.estaca_descarga_m;
  else
    new.estaca_descarga_m := null;
    v_pd := case when v_trd.tipo = 'eixo' then v_d.estaca_acesso_m end;
  end if;

  -- local da produção: a ponta na pista (o destino quando os dois são), senão o trecho de algum dos locais
  if v_d.tipo = 'pista' then
    new.trecho_id := v_d.trecho_id;
    new.posicao_inicio_m := new.estaca_descarga_m;
  elsif v_o.tipo = 'pista' then
    new.trecho_id := v_o.trecho_id;
    new.posicao_inicio_m := new.estaca_carga_m;
  else
    new.trecho_id := coalesce(v_d.trecho_id, v_o.trecho_id);
    new.posicao_inicio_m := null;
  end if;
  new.posicao_fim_m := new.posicao_inicio_m;

  -- quantidade na unidade do serviço
  v_fator := coalesce(v_par.fator_viagem, 1);
  if coalesce(v_par.medicao_viagem, 'volume') = 'peso' then
    new.volume_m3 := null;
    if new.peso_t is not null then
      if coalesce(trim(new.nf_ticket), '') = '' then
        raise exception 'Informe o ticket da balança (o serviço é medido por peso)';
      end if;
      new.quantidade := round(new.peso_t * v_fator, 4);
    elsif new.quantidade is null then
      raise exception 'Informe o peso líquido do ticket (t)';
    end if;
  else
    new.peso_t := null;
    if new.volume_m3 is null and new.quantidade is null then
      select capacidade_m3 into v_cap from public.frota_veiculo where id = v_f.veiculo_id;
      new.volume_m3 := v_cap;
    end if;
    if new.volume_m3 is not null then
      new.quantidade := round(new.volume_m3 * v_fator, 4);
    elsif new.quantidade is null then
      raise exception 'Informe o volume da caçamba (m³) — o caminhão não tem capacidade cadastrada';
    end if;
  end if;

  -- DMT
  if v_o.trecho_id is not null and v_o.trecho_id = v_d.trecho_id and v_pc is not null and v_pd is not null then
    v_geo := round(
      (case when v_o.tipo = 'pista' then 0 else coalesce(v_o.distancia_acesso_km, 0) end)
      + abs(v_pc - v_pd) / 1000.0
      + (case when v_d.tipo = 'pista' then 0 else coalesce(v_d.distancia_acesso_km, 0) end), 3);
  end if;
  select dmt_km into v_rota from public.transporte_rota
   where origem_id = new.origem_id and destino_id = new.destino_id;
  new.dmt_calculada_km := coalesce(v_rota, v_geo);
  if coalesce(new.dmt_manual, false) then
    if new.dmt_km is null then raise exception 'Informe a DMT ajustada (km)'; end if;
    new.dmt_origem := 'manual';
  elsif v_rota is not null then
    new.dmt_km := v_rota;
    new.dmt_origem := 'rota';
  elsif v_geo is not null then
    new.dmt_km := v_geo;
    new.dmt_origem := 'geometria';
  else
    raise exception 'Sem como calcular a DMT de "%" para "%": cadastre a estaca de acesso dos locais (no mesmo trecho) ou a distância fixa do par em Origens e destinos',
      v_o.nome, v_d.nome;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- ── sincronização (app e web): campos novos; o hodômetro deixa de ser gravado ────────────────────────────────────
create or replace function public.campo_sync_ficha(_ficha jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (_ficha->>'id')::uuid; v_obra uuid := (_ficha->>'obra_id')::uuid;
  v_atual record; v jsonb; v_ids uuid[] := '{}'; n int := 0;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if v_id is null or v_obra is null then raise exception 'id e obra_id são obrigatórios'; end if;
  perform public.campo_assert(v_obra);
  select obra_id, criado_por into v_atual from public.viagem_ficha where id = v_id;
  if v_atual.obra_id is not null then
    if v_atual.obra_id <> v_obra then raise exception 'Ficha de outra obra'; end if;
    if public.auth_role() in ('apoio', 'apontador') and v_atual.criado_por is distinct from auth.uid() then
      raise exception 'Ficha de outro usuário';
    end if;
  end if;

  if coalesce((_ficha->>'excluir')::boolean, false) then
    delete from public.viagem_ficha where id = v_id;
    return jsonb_build_object('ficha_id', v_id, 'viagens', 0, 'excluida', true);
  end if;

  insert into public.viagem_ficha
    (id, obra_id, data, veiculo_id, motorista, encarregado_id, equipe_id, obs, origem)
  values
    (v_id, v_obra, (_ficha->>'data')::date, nullif(_ficha->>'veiculo_id', '')::uuid,
     nullif(_ficha->>'motorista', ''), nullif(_ficha->>'encarregado_id', '')::uuid,
     nullif(_ficha->>'equipe_id', '')::uuid, nullif(_ficha->>'obs', ''),
     coalesce(nullif(_ficha->>'origem', ''), 'campo'))
  on conflict (id) do update set
    data = excluded.data, veiculo_id = excluded.veiculo_id, motorista = excluded.motorista,
    encarregado_id = excluded.encarregado_id, equipe_id = excluded.equipe_id, obs = excluded.obs;

  for v in select * from jsonb_array_elements(coalesce(_ficha->'viagens', '[]'::jsonb)) loop
    n := n + 1;
    v_ids := v_ids || (v->>'id')::uuid;
    insert into public.viagem
      (id, ficha_id, obra_id, data, item_orcamentario_id, origem_id, destino_id, hora_carga, hora_descarga,
       quantidade, volume_m3, peso_t, material_qtd, dmt_km, dmt_manual, nf_ticket, estaca_carga_m,
       estaca_descarga_m, obs, ordem, carregador_id)
    values
      ((v->>'id')::uuid, v_id, v_obra, (_ficha->>'data')::date, (v->>'item_orcamentario_id')::uuid,
       nullif(v->>'origem_id', '')::uuid, nullif(v->>'destino_id', '')::uuid,
       nullif(v->>'hora_carga', '')::time, nullif(v->>'hora_descarga', '')::time,
       nullif(v->>'quantidade', '')::numeric, nullif(v->>'volume_m3', '')::numeric,
       nullif(v->>'peso_t', '')::numeric, nullif(v->>'material_qtd', '')::numeric,
       nullif(v->>'dmt_km', '')::numeric, coalesce((v->>'dmt_manual')::boolean, false),
       nullif(v->>'nf_ticket', ''), nullif(v->>'estaca_carga_m', '')::numeric,
       nullif(v->>'estaca_descarga_m', '')::numeric, nullif(v->>'obs', ''), n,
       nullif(v->>'carregador_id', '')::uuid)
    on conflict (id) do update set
      item_orcamentario_id = excluded.item_orcamentario_id, origem_id = excluded.origem_id,
      destino_id = excluded.destino_id, hora_carga = excluded.hora_carga, hora_descarga = excluded.hora_descarga,
      quantidade = excluded.quantidade, volume_m3 = excluded.volume_m3, peso_t = excluded.peso_t,
      material_qtd = excluded.material_qtd, dmt_km = excluded.dmt_km, dmt_manual = excluded.dmt_manual,
      nf_ticket = excluded.nf_ticket, estaca_carga_m = excluded.estaca_carga_m,
      estaca_descarga_m = excluded.estaca_descarga_m, obs = excluded.obs, ordem = excluded.ordem,
      carregador_id = excluded.carregador_id
    where public.viagem.ficha_id = v_id;
  end loop;
  delete from public.viagem where ficha_id = v_id and not (id = any (v_ids));
  return jsonb_build_object('ficha_id', v_id, 'viagens', n);
end $$;

-- ── catálogo do app: medição do serviço e acesso dos locais ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.campo_catalogo(_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  perform public.campo_assert(_obra_id);
  select jsonb_build_object(
    'obra', (select jsonb_build_object('id', o.id, 'codigo', o.codigo, 'nome', o.nome, 'empresa_id', o.empresa_id)
               from public.obras o where o.id = _obra_id),
    'servicos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'codigo', i.codigo, 'descricao', i.descricao,
               'unidade', coalesce(s.unidade, i.unidade_referencia),
               'modo_lancamento', coalesce(p.modo_lancamento, 'quantidade'),
               'controla_material', coalesce(p.controla_material, false),
               'material', case when p.controla_material then jsonb_build_object(
                             'id', r.id, 'nome', r.nome, 'unidade', coalesce(p.material_unidade, r.unidade)) end,
               'material_obrigatorio', coalesce(p.material_obrigatorio, true),
               'habilita_obs', coalesce(p.habilita_obs, true),
               'exige_local', coalesce(p.exige_local, false),
               'medicao_viagem', coalesce(p.medicao_viagem, 'volume'),
               'fator_viagem', coalesce(p.fator_viagem, 1))
             order by i.ordem, i.codigo)
        from public.item_orcamentario i
        join public.servico s on s.id = i.servico_id
        left join public.servico_parametro p on p.item_orcamentario_id = i.id
        left join public.recurso r on r.id = p.material_recurso_id
       where i.obra_id = _obra_id and i.tipo = 'servico_grupo' and i.indireto_id is null), '[]'::jsonb),
    'equipes', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'encarregado_id', e.encarregado_id) order by e.ordem, e.nome)
        from public.equipe e where e.obra_id = _obra_id and e.ativo and not coalesce(e.is_sistema, false)), '[]'::jsonb),
    'encarregados', coalesce((
      select jsonb_agg(jsonb_build_object('id', en.id, 'nome', en.nome, 'apelido', en.apelido) order by en.nome)
        from public.encarregado en where en.obra_id = _obra_id and en.ativo), '[]'::jsonb),
    'locais', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'nome', t.nome, 'tipo', t.tipo, 'ordem', t.ordem,
               'comprimento_m', t.comprimento_m, 'geometry_comprimento_m', t.geometry_comprimento_m,
               'unidade_espaco_padrao', t.unidade_espaco_padrao, 'unidade_custom_label', t.unidade_custom_label,
               'unidade_custom_divisor_m', t.unidade_custom_divisor_m,
               'marcador_valor_inicial', t.marcador_valor_inicial, 'geometry_sentido', t.geometry_sentido)
             order by t.tipo, t.ordem, t.nome)
        from public.obra_trecho t where t.obra_id = _obra_id), '[]'::jsonb),
    'veiculos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'prefixo', v.prefixo, 'placa', v.placa, 'tipo', v.tipo, 'modelo', v.modelo,
               'proprietario', v.proprietario, 'capacidade_m3', v.capacidade_m3, 'capacidade_t', v.capacidade_t)
             order by v.prefixo)
        from public.veiculos_da_obra(_obra_id) v), '[]'::jsonb),
    'origens_destinos', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome, 'tipo', l.tipo, 'trecho_id', l.trecho_id,
                                       'estaca_acesso_m', l.estaca_acesso_m, 'distancia_acesso_km', l.distancia_acesso_km)
             order by l.nome)
        from public.transporte_local l where l.obra_id = _obra_id and l.ativo), '[]'::jsonb),
    'rotas', coalesce((
      select jsonb_agg(jsonb_build_object('origem_id', r.origem_id, 'destino_id', r.destino_id, 'dmt_km', r.dmt_km))
        from public.transporte_rota r where r.obra_id = _obra_id), '[]'::jsonb)
  ) into v;
  return v || jsonb_build_object('versao', md5(v::text));
end $function$;
