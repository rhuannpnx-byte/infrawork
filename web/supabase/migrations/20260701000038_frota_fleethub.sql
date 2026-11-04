-- InfraWork Web — frota sincronizada com a FleetHub (Edge Function fleethub-sync, só leitura na FleetHub).
-- A FleetHub é dona de código/placa/marca/modelo/ano/obra/status; o InfraWork, de capacidade/proprietário/tipo.

-- ═══ 1. obras da FleetHub ═════════════════════════════════════════════════════════════════════════
create table if not exists public.fleet_obra (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  fleet_id      integer not null,
  nome          text not null,
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, fleet_id)
);
comment on table public.fleet_obra is 'Obras cadastradas na FleetHub (lidas pela sincronização). Escrita só pelo serviço.';
alter table public.fleet_obra enable row level security;
drop policy if exists fleet_obra_select on public.fleet_obra;
create policy fleet_obra_select on public.fleet_obra for select to authenticated
  using (public.auth_role() = 'god' or empresa_id = public.auth_empresa_id());
grant select on public.fleet_obra to authenticated;

-- ═══ 2. vínculo obra ↔ obra FleetHub ═══════════════════════════════════════════════════════════════
create table if not exists public.obra_fleet_obra (
  obra_id       uuid not null references public.obras(id) on delete cascade,
  fleet_obra_id uuid not null references public.fleet_obra(id) on delete cascade,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null,
  primary key (obra_id, fleet_obra_id)
);
comment on table public.obra_fleet_obra is
  'Vínculo feito no InfraWork entre a obra e a(s) obra(s) da FleetHub: filtra os veículos da obra nas viagens.';
create index if not exists idx_obra_fleet_obra_fleet on public.obra_fleet_obra(fleet_obra_id);

create or replace function public.fn_obra_fleet_obra_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- a obra FleetHub tem de ser da mesma empresa da obra
  if not exists (select 1 from public.fleet_obra f
                  where f.id = new.fleet_obra_id and f.empresa_id = public.obra_empresa(new.obra_id)) then
    raise exception 'Obra da FleetHub de outra empresa';
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
drop trigger if exists trg_obra_fleet_obra_antes on public.obra_fleet_obra;
create trigger trg_obra_fleet_obra_antes before insert or update on public.obra_fleet_obra
  for each row execute function public.fn_obra_fleet_obra_antes();

alter table public.obra_fleet_obra enable row level security;
drop policy if exists obra_fleet_select on public.obra_fleet_obra;
create policy obra_fleet_select on public.obra_fleet_obra for select to authenticated
  using (public.pode_ver_obra(obra_id) or public.pode_lancar_producao(obra_id));
drop policy if exists obra_fleet_write on public.obra_fleet_obra;
create policy obra_fleet_write on public.obra_fleet_obra for all to authenticated
  using (public.pode_planejar_obra(obra_id)) with check (public.pode_planejar_obra(obra_id));
grant select, insert, update, delete on public.obra_fleet_obra to authenticated;

-- ═══ 3. frota: campos da FleetHub ═══════════════════════════════════════════════════════════════════
alter table public.frota_veiculo
  add column if not exists origem          text not null default 'manual',
  add column if not exists fleet_id        integer,
  add column if not exists fleet_tipo      text,
  add column if not exists marca           text,
  add column if not exists ano             integer,
  add column if not exists fleet_obra_id   uuid references public.fleet_obra(id) on delete set null,
  add column if not exists fleet_status    text,
  add column if not exists sincronizado_em timestamptz;
alter table public.frota_veiculo drop constraint if exists chk_frota_origem;
alter table public.frota_veiculo add constraint chk_frota_origem check (origem in ('manual', 'fleethub'));
create unique index if not exists uq_frota_fleet_id on public.frota_veiculo(empresa_id, fleet_id)
  where fleet_id is not null;
create index if not exists idx_frota_fleet_obra on public.frota_veiculo(fleet_obra_id) where ativo;

-- Campos da FleetHub só mudam pela sincronização (serviço, sem auth.uid()).
create or replace function public.fn_frota_fleethub_protege()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.origem = 'fleethub' then
      raise exception 'Veículo da FleetHub não pode ser excluído aqui (ele volta na próxima sincronização)';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.origem = 'fleethub' or new.fleet_id is not null then
      raise exception 'Veículos da FleetHub entram só pela sincronização';
    end if;
    return new;
  end if;
  if old.origem = 'fleethub' and (
       new.origem is distinct from old.origem or new.fleet_id is distinct from old.fleet_id
    or new.prefixo is distinct from old.prefixo or new.placa is distinct from old.placa
    or new.marca is distinct from old.marca or new.modelo is distinct from old.modelo
    or new.ano is distinct from old.ano or new.fleet_tipo is distinct from old.fleet_tipo
    or new.fleet_obra_id is distinct from old.fleet_obra_id or new.fleet_status is distinct from old.fleet_status
    or new.ativo is distinct from old.ativo or new.empresa_id is distinct from old.empresa_id) then
    raise exception 'Este campo vem da FleetHub — altere lá e sincronize';
  end if;
  if old.origem = 'manual' and (new.origem <> 'manual' or new.fleet_id is not null) then
    raise exception 'Veículos da FleetHub entram só pela sincronização';
  end if;
  return new;
end $$;
drop trigger if exists trg_frota_fleethub_protege on public.frota_veiculo;
create trigger trg_frota_fleethub_protege before insert or update or delete on public.frota_veiculo
  for each row execute function public.fn_frota_fleethub_protege();

-- ═══ 4. registro das rodadas ══════════════════════════════════════════════════════════════════════
create table if not exists public.fleet_sync_execucao (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  iniciado_em  timestamptz not null default now(),
  terminado_em timestamptz,
  ok           boolean,
  mensagem     text,
  novos        integer not null default 0,
  atualizados  integer not null default 0,
  inativados   integer not null default 0,
  lidos        integer not null default 0,
  obras        integer not null default 0,
  disparado_por uuid references public.profiles(id) on delete set null,
  origem       text not null default 'manual',
  constraint chk_fleet_sync_origem check (origem in ('manual', 'cron'))
);
create index if not exists idx_fleet_sync_empresa on public.fleet_sync_execucao(empresa_id, iniciado_em desc);
alter table public.fleet_sync_execucao enable row level security;
drop policy if exists fleet_sync_select on public.fleet_sync_execucao;
create policy fleet_sync_select on public.fleet_sync_execucao for select to authenticated
  using (public.auth_role() = 'god'
         or (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id()));
grant select on public.fleet_sync_execucao to authenticated;

-- ═══ 5. veículos que a obra enxerga ═══════════════════════════════════════════════════════════════
-- Obra vinculada: veículos FleetHub dessas obras + os manuais. Sem vínculo: todos os ativos da empresa.
create or replace function public.veiculos_da_obra(_obra_id uuid)
returns setof public.frota_veiculo language sql stable set search_path = public as $$
  select v.*
    from public.frota_veiculo v
   where v.ativo
     and v.empresa_id = public.obra_empresa(_obra_id)
     and (
       not exists (select 1 from public.obra_fleet_obra x where x.obra_id = _obra_id)
       or v.origem = 'manual'
       or v.fleet_obra_id in (select x.fleet_obra_id from public.obra_fleet_obra x where x.obra_id = _obra_id)
     )
$$;
revoke all on function public.veiculos_da_obra(uuid) from public, anon;
grant execute on function public.veiculos_da_obra(uuid) to authenticated;

-- catálogo do app (0034) com os veículos da obra
create or replace function public.campo_catalogo(_obra_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
               'exige_local', coalesce(p.exige_local, false))
             order by i.ordem, i.codigo)
        from public.item_orcamentario i
        join public.servico s on s.id = i.servico_id
        left join public.servico_parametro p on p.item_orcamentario_id = i.id
        left join public.recurso r on r.id = p.material_recurso_id
       where i.obra_id = _obra_id and i.tipo = 'servico_grupo' and i.indireto_id is null), '[]'::jsonb),
    'equipes', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome) order by e.ordem, e.nome)
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
      select jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome, 'tipo', l.tipo, 'trecho_id', l.trecho_id)
             order by l.nome)
        from public.transporte_local l where l.obra_id = _obra_id and l.ativo), '[]'::jsonb),
    'rotas', coalesce((
      select jsonb_agg(jsonb_build_object('origem_id', r.origem_id, 'destino_id', r.destino_id, 'dmt_km', r.dmt_km))
        from public.transporte_rota r where r.obra_id = _obra_id), '[]'::jsonb)
  ) into v;
  return v || jsonb_build_object('versao', md5(v::text));
end $$;

-- ═══ 6. máquinas de carga e "Carregado por" na viagem ═════════════════════════════════════════════
alter table public.frota_veiculo drop constraint if exists chk_frota_tipo;
alter table public.frota_veiculo add constraint chk_frota_tipo check (tipo in
  ('basculante', 'carreta', 'betoneira', 'pipa', 'caminhao', 'escavadeira', 'retroescavadeira', 'carregadeira', 'outro'));

alter table public.viagem add column if not exists carregador_id uuid references public.frota_veiculo(id) on delete set null;

create or replace function public.fn_viagem_carregador()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.carregador_id is not null and not exists (
    select 1 from public.frota_veiculo v
     where v.id = new.carregador_id and v.empresa_id = public.obra_empresa(new.obra_id)
  ) then raise exception 'Equipamento de carga de outra empresa'; end if;
  return new;
end $$;
drop trigger if exists trg_viagem_carregador on public.viagem;
create trigger trg_viagem_carregador before insert or update of carregador_id on public.viagem
  for each row execute function public.fn_viagem_carregador();

-- viagem sem origem/destino quebrava (record não atribuído) — variáveis simples
create or replace function public.fn_viagem_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_f record; v_item record; v_modo text; v_tr record;
  v_orig_obra uuid; v_orig_trecho uuid; v_dest_obra uuid; v_dest_trecho uuid;
begin
  select obra_id, data into v_f from public.viagem_ficha where id = new.ficha_id;
  if v_f.obra_id is null then raise exception 'Ficha de viagens inexistente'; end if;
  new.obra_id := v_f.obra_id;
  new.data := v_f.data;
  select obra_id, tipo, descricao into v_item from public.item_orcamentario where id = new.item_orcamentario_id;
  if v_item.obra_id is distinct from new.obra_id or v_item.tipo <> 'servico_grupo' then
    raise exception 'Serviço inválido para a obra';
  end if;
  select modo_lancamento into v_modo from public.servico_parametro where item_orcamentario_id = new.item_orcamentario_id;
  if coalesce(v_modo, 'quantidade') <> 'viagens' then
    raise exception 'O serviço "%" não está parametrizado para viagens', v_item.descricao;
  end if;
  if new.origem_id is not null then
    select obra_id, trecho_id into v_orig_obra, v_orig_trecho from public.transporte_local where id = new.origem_id;
    if v_orig_obra is distinct from new.obra_id then raise exception 'Origem de outra obra'; end if;
  end if;
  if new.destino_id is not null then
    select obra_id, trecho_id into v_dest_obra, v_dest_trecho from public.transporte_local where id = new.destino_id;
    if v_dest_obra is distinct from new.obra_id then raise exception 'Destino de outra obra'; end if;
  end if;
  -- o local da viagem é a ponta que está na obra (pista/área): o destino (aterro, base) ou, senão, a origem (corte)
  new.trecho_id := coalesce(new.trecho_id, v_dest_trecho, v_orig_trecho);
  -- DMT pela rota quando não informado
  if new.dmt_km is null and new.origem_id is not null and new.destino_id is not null then
    select dmt_km into new.dmt_km from public.transporte_rota
     where origem_id = new.origem_id and destino_id = new.destino_id;
  end if;
  -- estaca da viagem (descarga na pista ou corte): um ponto (inicio = fim) ou uma faixa, dentro do eixo
  if new.trecho_id is null then
    new.posicao_inicio_m := null; new.posicao_fim_m := null;
  else
    select * into v_tr from public.obra_trecho where id = new.trecho_id;
    if v_tr.id is null or v_tr.obra_id <> new.obra_id then raise exception 'Local de outra obra'; end if;
    if v_tr.tipo = 'area' then
      new.posicao_inicio_m := null; new.posicao_fim_m := null;
    else
      new.posicao_fim_m := coalesce(new.posicao_fim_m, new.posicao_inicio_m);
      new.posicao_inicio_m := coalesce(new.posicao_inicio_m, new.posicao_fim_m);
      if new.posicao_inicio_m > new.posicao_fim_m then
        select new.posicao_fim_m, new.posicao_inicio_m into new.posicao_inicio_m, new.posicao_fim_m;
      end if;
      if new.posicao_inicio_m < 0 or new.posicao_fim_m > v_tr.comprimento_m + 0.005 then
        raise exception 'Estaca fora do trecho "%"', v_tr.nome;
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ficha do app (0034) com carregador_id por viagem
create or replace function public.campo_sync_ficha(_ficha jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
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
    (id, obra_id, data, veiculo_id, motorista, encarregado_id, equipe_id, km_inicial, km_final, obs, origem)
  values
    (v_id, v_obra, (_ficha->>'data')::date, nullif(_ficha->>'veiculo_id', '')::uuid,
     nullif(_ficha->>'motorista', ''), nullif(_ficha->>'encarregado_id', '')::uuid,
     nullif(_ficha->>'equipe_id', '')::uuid, nullif(_ficha->>'km_inicial', '')::numeric,
     nullif(_ficha->>'km_final', '')::numeric, nullif(_ficha->>'obs', ''),
     coalesce(nullif(_ficha->>'origem', ''), 'campo'))
  on conflict (id) do update set
    data = excluded.data, veiculo_id = excluded.veiculo_id, motorista = excluded.motorista,
    encarregado_id = excluded.encarregado_id, equipe_id = excluded.equipe_id,
    km_inicial = excluded.km_inicial, km_final = excluded.km_final, obs = excluded.obs;

  for v in select * from jsonb_array_elements(coalesce(_ficha->'viagens', '[]'::jsonb)) loop
    n := n + 1;
    v_ids := v_ids || (v->>'id')::uuid;
    insert into public.viagem
      (id, ficha_id, obra_id, data, item_orcamentario_id, origem_id, destino_id, hora_carga, hora_descarga,
       quantidade, material_qtd, dmt_km, nf_ticket, trecho_id, posicao_inicio_m, posicao_fim_m, obs, ordem,
       carregador_id)
    values
      ((v->>'id')::uuid, v_id, v_obra, (_ficha->>'data')::date, (v->>'item_orcamentario_id')::uuid,
       nullif(v->>'origem_id', '')::uuid, nullif(v->>'destino_id', '')::uuid,
       nullif(v->>'hora_carga', '')::time, nullif(v->>'hora_descarga', '')::time,
       (v->>'quantidade')::numeric, nullif(v->>'material_qtd', '')::numeric, nullif(v->>'dmt_km', '')::numeric,
       nullif(v->>'nf_ticket', ''), nullif(v->>'trecho_id', '')::uuid,
       nullif(v->>'posicao_inicio_m', '')::numeric, nullif(v->>'posicao_fim_m', '')::numeric,
       nullif(v->>'obs', ''), n, nullif(v->>'carregador_id', '')::uuid)
    on conflict (id) do update set
      item_orcamentario_id = excluded.item_orcamentario_id, origem_id = excluded.origem_id,
      destino_id = excluded.destino_id, hora_carga = excluded.hora_carga, hora_descarga = excluded.hora_descarga,
      quantidade = excluded.quantidade, material_qtd = excluded.material_qtd, dmt_km = excluded.dmt_km,
      nf_ticket = excluded.nf_ticket, trecho_id = excluded.trecho_id,
      posicao_inicio_m = excluded.posicao_inicio_m, posicao_fim_m = excluded.posicao_fim_m,
      obs = excluded.obs, ordem = excluded.ordem, carregador_id = excluded.carregador_id
    where public.viagem.ficha_id = v_id;
  end loop;
  delete from public.viagem where ficha_id = v_id and not (id = any (v_ids));
  return jsonb_build_object('ficha_id', v_id, 'viagens', n);
end $$;

-- ═══ 7. rodada diária (05:00 de Brasília) ═════════════════════════════════════════════════════════
-- URL e service key do Vault, como em …0003_cron.sql.
select cron.unschedule(jobid) from cron.job where jobname = 'fleethub-sync-diario';
select cron.schedule(
  'fleethub-sync-diario',
  '0 8 * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/fleethub-sync',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{"origem":"cron"}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
  $$
);
