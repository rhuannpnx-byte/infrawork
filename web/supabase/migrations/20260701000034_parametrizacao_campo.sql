-- InfraWork Web — parametrização dos serviços, frota, viagens e o app de campo.
--
--   1. servico_parametro            por agrupador do orçamento: modo de lançamento (quantidade | viagens), controle de
--                                   material (qual recurso e unidade), observação, local obrigatório.
--   2. material aplicado            acompanhamento_producao_material.recurso_id + vw_servico_consumo_material (média
--                                   de material por unidade produzida).
--   3. regras no lançamento         serviço de viagens só recebe produção das viagens; observação desligada; local
--                                   obrigatório; origem 'campo'/'viagens'; app_uuid (idempotência do app).
--   4. frota_veiculo                da empresa (circula entre obras).
--   5. transporte_local / _rota     origens e destinos da obra + DMT por rota.
--   6. viagem_ficha / viagem        registro de viagens; o gatilho recompõe a produção do dia (Σ das viagens) por
--                                   (obra, data, serviço, local) — o cronograma continua lendo acompanhamento_producao.
--   7. papel apontador              lança nas obras liberadas; só mexe no que criou.
--   8. RPCs campo_*                 catálogo enxuto e sincronização do app de campo (sem preços nem custos).
--
-- Fora da trava da cadeia (como servico_dependencia): parametrizar não mexe em custo.

-- ═══ 1. servico_parametro ════════════════════════════════════════════════════════════════════════
create table if not exists public.servico_parametro (
  item_orcamentario_id uuid primary key references public.item_orcamentario(id) on delete cascade,
  obra_id              uuid not null references public.obras(id) on delete cascade,
  modo_lancamento      text not null default 'quantidade',
  controla_material    boolean not null default false,
  material_recurso_id  uuid references public.recurso(id) on delete restrict,
  material_unidade     text,
  material_obrigatorio boolean not null default true,
  habilita_obs         boolean not null default true,
  exige_local          boolean not null default false,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.profiles(id) on delete set null,
  constraint chk_sp_modo check (modo_lancamento in ('quantidade', 'viagens'))
);
comment on table public.servico_parametro is
  'Parametrização do serviço (agrupador) para o lançamento: modo, material controlado, observação, local obrigatório. Sem linha = padrão.';
create index if not exists idx_servico_parametro_obra on public.servico_parametro(obra_id);

create or replace function public.fn_servico_parametro_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_item record; v_rec record;
begin
  select obra_id, tipo into v_item from public.item_orcamentario where id = new.item_orcamentario_id;
  if v_item.obra_id is null then raise exception 'Serviço do orçamento inexistente'; end if;
  if v_item.tipo <> 'servico_grupo' then raise exception 'Só serviços (agrupadores) são parametrizados'; end if;
  new.obra_id := v_item.obra_id;
  if new.controla_material then
    if new.material_recurso_id is null then
      raise exception 'Escolha o material controlado do serviço';
    end if;
    select obra_id, grupo, unidade into v_rec from public.recurso where id = new.material_recurso_id;
    if v_rec.obra_id is distinct from new.obra_id then raise exception 'Material de outra obra'; end if;
    if v_rec.grupo <> 'MATERIAL' then raise exception 'O recurso escolhido não é um material'; end if;
    new.material_unidade := coalesce(nullif(trim(new.material_unidade), ''), v_rec.unidade);
  else
    new.material_recurso_id := null;
    new.material_unidade := null;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
alter function public.fn_servico_parametro_antes() owner to postgres;
drop trigger if exists trg_servico_parametro_antes on public.servico_parametro;
create trigger trg_servico_parametro_antes before insert or update on public.servico_parametro
  for each row execute function public.fn_servico_parametro_antes();

alter table public.servico_parametro enable row level security;
drop policy if exists sp_select on public.servico_parametro;
create policy sp_select on public.servico_parametro for select to authenticated
  using (public.pode_ver_obra(obra_id) or public.pode_lancar_producao(obra_id));
drop policy if exists sp_write on public.servico_parametro;
create policy sp_write on public.servico_parametro for all to authenticated
  using (public.pode_planejar_obra(obra_id)) with check (public.pode_planejar_obra(obra_id));
grant select, insert, update, delete on public.servico_parametro to authenticated;

-- ═══ 2. material aplicado estruturado ════════════════════════════════════════════════════════════
alter table public.acompanhamento_producao_material
  add column if not exists recurso_id uuid references public.recurso(id) on delete set null;
create index if not exists idx_acomp_prod_mat_recurso on public.acompanhamento_producao_material(recurso_id)
  where recurso_id is not null;

create or replace function public.fn_acomp_prod_mat_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rec record;
begin
  if new.recurso_id is not null then
    select nome, unidade into v_rec from public.recurso where id = new.recurso_id;
    new.nome := coalesce(v_rec.nome, new.nome);
    new.unidade := coalesce(nullif(trim(new.unidade), ''), v_rec.unidade);
  end if;
  if new.nome is null or trim(new.nome) = '' then raise exception 'Material sem nome'; end if;
  return new;
end $$;
alter function public.fn_acomp_prod_mat_antes() owner to postgres;
drop trigger if exists trg_acomp_prod_mat_antes on public.acompanhamento_producao_material;
create trigger trg_acomp_prod_mat_antes before insert or update on public.acompanhamento_producao_material
  for each row execute function public.fn_acomp_prod_mat_antes();

-- Média de material por unidade produzida: Σ material ÷ Σ produção (só os lançamentos que informaram o material).
create or replace view public.vw_servico_consumo_material with (security_invoker = true) as
with por_lancamento as (
  select p.obra_id, p.item_orcamentario_id, m.recurso_id, p.id as producao_id,
         p.quantidade * p.fator_conversao as producao,
         sum(m.quantidade) as material,
         max(m.unidade) as unidade
    from public.acompanhamento_producao p
    join public.acompanhamento_producao_material m on m.producao_id = p.id
   where m.recurso_id is not null and m.quantidade is not null and p.item_orcamentario_id is not null
   group by p.obra_id, p.item_orcamentario_id, m.recurso_id, p.id, p.quantidade, p.fator_conversao
)
select obra_id, item_orcamentario_id, recurso_id,
       max(unidade)               as unidade,
       count(*)                   as lancamentos,
       sum(material)              as material_total,
       sum(producao)              as producao_total,
       case when sum(producao) > 0 then sum(material) / sum(producao) end as media_por_unidade
  from por_lancamento
 group by obra_id, item_orcamentario_id, recurso_id;
grant select on public.vw_servico_consumo_material to authenticated;

-- ═══ 3. regras no lançamento ═════════════════════════════════════════════════════════════════════
alter table public.acompanhamento_producao drop constraint if exists chk_acomp_prod_origem;
alter table public.acompanhamento_producao add constraint chk_acomp_prod_origem
  check (origem in ('app', 'importacao', 'campo', 'viagens'));
alter table public.acompanhamento_producao add column if not exists app_uuid uuid;
create unique index if not exists uq_acomp_prod_app_uuid on public.acompanhamento_producao(app_uuid)
  where app_uuid is not null;
alter table public.acompanhamento_foto add column if not exists app_uuid uuid;
create unique index if not exists uq_acomp_foto_app_uuid on public.acompanhamento_foto(app_uuid)
  where app_uuid is not null;

create or replace function public.fn_acomp_prod_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_item record; v_par record; v_tr record;
begin
  if new.item_orcamentario_id is not null then
    select i.obra_id, i.tipo, i.servico_id, i.descricao,
           coalesce(s.unidade, i.unidade_referencia) as unidade
      into v_item
      from public.item_orcamentario i
      left join public.servico s on s.id = i.servico_id
     where i.id = new.item_orcamentario_id;
    if v_item.obra_id is null then raise exception 'Item orçamentário inexistente'; end if;
    if v_item.obra_id <> new.obra_id then raise exception 'Item orçamentário de outra obra'; end if;
    if v_item.tipo <> 'servico_grupo' then raise exception 'Só itens com composição (servico_grupo) recebem produção'; end if;
    if v_item.servico_id is null then
      raise exception 'Agrupamento sem composição vinculada não recebe produção — vincule uma composição no orçamento';
    end if;
    new.servico_id   := coalesce(new.servico_id, v_item.servico_id);
    new.servico_nome := coalesce(nullif(trim(new.servico_nome), ''), v_item.descricao);
    new.unidade      := coalesce(new.unidade, v_item.unidade);

    -- parametrização do serviço (vale para lançamentos novos e para quem muda quantidade/serviço)
    select * into v_par from public.servico_parametro where item_orcamentario_id = new.item_orcamentario_id;
    if found then
      if v_par.modo_lancamento = 'viagens' and new.origem <> 'viagens'
         and (tg_op = 'INSERT' or new.quantidade is distinct from old.quantidade
              or new.item_orcamentario_id is distinct from old.item_orcamentario_id) then
        raise exception 'O serviço "%" é alimentado por viagens: lance as viagens do dia', v_item.descricao;
      end if;
      -- observação desligada vale para o apontador (a nota "N viagens" da produção das viagens fica)
      if not v_par.habilita_obs and new.origem <> 'viagens' then new.obs := null; end if;
      if v_par.exige_local and new.origem <> 'viagens' then
        if new.trecho_id is null then
          raise exception 'Informe o local do lançamento de "%"', v_item.descricao;
        end if;
        select tipo into v_tr from public.obra_trecho where id = new.trecho_id;
        if v_tr.tipo = 'eixo' and new.posicao_inicio_m is null then
          raise exception 'Informe as estacas inicial e final do lançamento de "%"', v_item.descricao;
        end if;
      end if;
    end if;
  end if;
  -- a produção das viagens só muda pelas viagens (exclusões em cascata — `set null` de item/equipe — passam)
  if new.origem = 'viagens' and coalesce(current_setting('infrawork.viagens_sync', true), '') <> '1'
     and (tg_op = 'INSERT' or new.origem is distinct from old.origem
          or new.quantidade is distinct from old.quantidade or new.data is distinct from old.data
          or new.trecho_id is distinct from old.trecho_id
          or new.posicao_inicio_m is distinct from old.posicao_inicio_m
          or new.posicao_fim_m is distinct from old.posicao_fim_m) then
    raise exception 'A produção das viagens é calculada pelas viagens do dia';
  end if;
  if new.servico_nome is null or trim(new.servico_nome) = '' then
    raise exception 'servico_nome obrigatório';
  end if;
  if new.equipe_id is not null and not exists (
    select 1 from public.equipe e where e.id = new.equipe_id and e.obra_id = new.obra_id
  ) then raise exception 'Equipe de outra obra'; end if;
  if new.encarregado_id is not null and not exists (
    select 1 from public.encarregado en where en.id = new.encarregado_id and en.obra_id = new.obra_id
  ) then raise exception 'Encarregado de outra obra'; end if;
  if new.data > current_date + 1 then raise exception 'Data no futuro'; end if;
  if tg_op = 'INSERT' then new.criado_por := coalesce(new.criado_por, auth.uid()); end if;
  new.updated_at := now();
  return new;
end $$;
alter function public.fn_acomp_prod_before_write() owner to postgres;

-- ═══ 4. frota (da empresa) ═══════════════════════════════════════════════════════════════════════
create table if not exists public.frota_veiculo (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  prefixo       text not null,
  placa         text,
  tipo          text not null default 'basculante',
  modelo        text,
  proprietario  text not null default 'proprio',
  fornecedor    text,
  capacidade_m3 numeric(10,2),
  capacidade_t  numeric(10,2),
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (empresa_id, prefixo),
  constraint chk_frota_tipo check (tipo in ('basculante', 'carreta', 'betoneira', 'pipa', 'caminhao', 'outro')),
  constraint chk_frota_prop check (proprietario in ('proprio', 'terceiro')),
  constraint chk_frota_cap  check (coalesce(capacidade_m3, 0) >= 0 and coalesce(capacidade_t, 0) >= 0)
);
create index if not exists idx_frota_empresa on public.frota_veiculo(empresa_id) where ativo;
drop trigger if exists trg_frota_touch on public.frota_veiculo;
create trigger trg_frota_touch before update on public.frota_veiculo
  for each row execute function public.fn_touch_updated_at();

alter table public.frota_veiculo enable row level security;
drop policy if exists frota_select on public.frota_veiculo;
create policy frota_select on public.frota_veiculo for select to authenticated
  using (public.auth_role() = 'god' or empresa_id = public.auth_empresa_id());
drop policy if exists frota_write on public.frota_veiculo;
create policy frota_write on public.frota_veiculo for all to authenticated
  using (public.auth_role() = 'god'
         or (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id()))
  with check (public.auth_role() = 'god'
              or (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id()));
grant select, insert, update, delete on public.frota_veiculo to authenticated;

-- ═══ 5. origens e destinos + rotas (DMT) ═════════════════════════════════════════════════════════
create table if not exists public.transporte_local (
  id         uuid primary key default gen_random_uuid(),
  obra_id    uuid not null references public.obras(id) on delete cascade,
  nome       text not null,
  tipo       text not null default 'outro',
  trecho_id  uuid references public.obra_trecho(id) on delete set null,
  lat        numeric(10,6),
  lng        numeric(10,6),
  ativo      boolean not null default true,
  created_at timestamptz not null default now(),
  unique (obra_id, nome),
  constraint chk_transp_local_tipo
    check (tipo in ('jazida', 'usina', 'central', 'bota_fora', 'deposito', 'pista', 'outro'))
);
comment on column public.transporte_local.trecho_id is
  'Local da obra (eixo/área) que este ponto representa — na pista, a viagem informa a estaca de descarga';

create table if not exists public.transporte_rota (
  id         uuid primary key default gen_random_uuid(),
  obra_id    uuid not null references public.obras(id) on delete cascade,
  origem_id  uuid not null references public.transporte_local(id) on delete cascade,
  destino_id uuid not null references public.transporte_local(id) on delete cascade,
  dmt_km     numeric(10,3) not null,
  unique (origem_id, destino_id),
  constraint chk_transp_rota_dmt check (dmt_km >= 0),
  constraint chk_transp_rota_par check (origem_id <> destino_id)
);

create or replace function public.fn_transporte_local_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.trecho_id is not null and not exists (
    select 1 from public.obra_trecho t where t.id = new.trecho_id and t.obra_id = new.obra_id
  ) then raise exception 'Local de outra obra'; end if;
  new.nome := trim(new.nome);
  if new.nome = '' then raise exception 'Informe o nome do local'; end if;
  return new;
end $$;
alter function public.fn_transporte_local_antes() owner to postgres;
drop trigger if exists trg_transporte_local_antes on public.transporte_local;
create trigger trg_transporte_local_antes before insert or update on public.transporte_local
  for each row execute function public.fn_transporte_local_antes();

create or replace function public.fn_transporte_rota_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare o1 uuid; o2 uuid;
begin
  select obra_id into o1 from public.transporte_local where id = new.origem_id;
  select obra_id into o2 from public.transporte_local where id = new.destino_id;
  if o1 is null or o1 <> o2 then raise exception 'Origem e destino precisam ser da mesma obra'; end if;
  new.obra_id := o1;
  return new;
end $$;
alter function public.fn_transporte_rota_antes() owner to postgres;
drop trigger if exists trg_transporte_rota_antes on public.transporte_rota;
create trigger trg_transporte_rota_antes before insert or update on public.transporte_rota
  for each row execute function public.fn_transporte_rota_antes();

alter table public.transporte_local enable row level security;
alter table public.transporte_rota enable row level security;
drop policy if exists transp_local_select on public.transporte_local;
create policy transp_local_select on public.transporte_local for select to authenticated
  using (public.pode_ver_acompanhamento(obra_id) or public.pode_lancar_producao(obra_id));
drop policy if exists transp_local_write on public.transporte_local;
create policy transp_local_write on public.transporte_local for all to authenticated
  using (public.auth_role() in ('god', 'adm', 'engenheiro') and public.pode_lancar_producao(obra_id))
  with check (public.auth_role() in ('god', 'adm', 'engenheiro') and public.pode_lancar_producao(obra_id));
drop policy if exists transp_rota_select on public.transporte_rota;
create policy transp_rota_select on public.transporte_rota for select to authenticated
  using (public.pode_ver_acompanhamento(obra_id) or public.pode_lancar_producao(obra_id));
drop policy if exists transp_rota_write on public.transporte_rota;
create policy transp_rota_write on public.transporte_rota for all to authenticated
  using (public.auth_role() in ('god', 'adm', 'engenheiro') and public.pode_lancar_producao(obra_id))
  with check (public.auth_role() in ('god', 'adm', 'engenheiro') and public.pode_lancar_producao(obra_id));
grant select, insert, update, delete on public.transporte_local, public.transporte_rota to authenticated;

-- ═══ 6. viagens ══════════════════════════════════════════════════════════════════════════════════
create table if not exists public.viagem_ficha (
  id             uuid primary key default gen_random_uuid(),
  obra_id        uuid not null references public.obras(id) on delete cascade,
  data           date not null,
  veiculo_id     uuid references public.frota_veiculo(id) on delete set null,
  motorista      text,
  encarregado_id uuid references public.encarregado(id) on delete set null,
  equipe_id      uuid references public.equipe(id) on delete set null,
  km_inicial     numeric(12,1),
  km_final       numeric(12,1),
  obs            text,
  origem         text not null default 'web',
  criado_por     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint chk_ficha_origem check (origem in ('web', 'campo')),
  constraint chk_ficha_km check (km_final is null or km_inicial is null or km_final >= km_inicial)
);
create index if not exists idx_viagem_ficha_obra_data on public.viagem_ficha(obra_id, data desc);

create table if not exists public.viagem (
  id                   uuid primary key default gen_random_uuid(),
  ficha_id             uuid not null references public.viagem_ficha(id) on delete cascade,
  obra_id              uuid not null references public.obras(id) on delete cascade,
  data                 date not null,
  item_orcamentario_id uuid not null references public.item_orcamentario(id),
  origem_id            uuid references public.transporte_local(id) on delete set null,
  destino_id           uuid references public.transporte_local(id) on delete set null,
  hora_carga           time,
  hora_descarga        time,
  quantidade           numeric(14,4) not null,
  material_qtd         numeric(14,4),
  dmt_km               numeric(10,3),
  nf_ticket            text,
  trecho_id            uuid references public.obra_trecho(id) on delete set null,
  posicao_inicio_m     numeric(14,3),
  posicao_fim_m        numeric(14,3),
  obs                  text,
  ordem                int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint chk_viagem_qtd check (quantidade > 0),
  constraint chk_viagem_mat check (material_qtd is null or material_qtd >= 0),
  constraint chk_viagem_dmt check (dmt_km is null or dmt_km >= 0)
);
create index if not exists idx_viagem_ficha on public.viagem(ficha_id, ordem);
create index if not exists idx_viagem_chave on public.viagem(obra_id, data, item_orcamentario_id);

-- uma produção 'viagens' por (obra, data, serviço, local)
create unique index if not exists uq_acomp_prod_viagens on public.acompanhamento_producao
  (obra_id, data, item_orcamentario_id, coalesce(trecho_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where origem = 'viagens';

create or replace function public.fn_viagem_ficha_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.veiculo_id is not null and not exists (
    select 1 from public.frota_veiculo v
     where v.id = new.veiculo_id and v.empresa_id = public.obra_empresa(new.obra_id)
  ) then raise exception 'Veículo de outra empresa'; end if;
  if new.equipe_id is not null and not exists (
    select 1 from public.equipe e where e.id = new.equipe_id and e.obra_id = new.obra_id
  ) then raise exception 'Equipe de outra obra'; end if;
  if new.encarregado_id is not null and not exists (
    select 1 from public.encarregado en where en.id = new.encarregado_id and en.obra_id = new.obra_id
  ) then raise exception 'Encarregado de outra obra'; end if;
  if new.data > current_date + 1 then raise exception 'Data no futuro'; end if;
  if tg_op = 'INSERT' then new.criado_por := coalesce(new.criado_por, auth.uid());
  elsif new.obra_id <> old.obra_id then raise exception 'A ficha não muda de obra';
  end if;
  new.updated_at := now();
  return new;
end $$;
alter function public.fn_viagem_ficha_antes() owner to postgres;
drop trigger if exists trg_viagem_ficha_antes on public.viagem_ficha;
create trigger trg_viagem_ficha_antes before insert or update on public.viagem_ficha
  for each row execute function public.fn_viagem_ficha_antes();

-- a data da ficha vale para as viagens (e recompõe a produção dos dois dias)
create or replace function public.fn_viagem_ficha_depois()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.data is distinct from old.data then
    update public.viagem set data = new.data where ficha_id = new.id;
  end if;
  return null;
end $$;
alter function public.fn_viagem_ficha_depois() owner to postgres;
drop trigger if exists trg_viagem_ficha_depois on public.viagem_ficha;
create trigger trg_viagem_ficha_depois after update of data on public.viagem_ficha
  for each row execute function public.fn_viagem_ficha_depois();

create or replace function public.fn_viagem_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_f record; v_item record; v_modo text; v_dest record; v_orig record; v_tr record;
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
    select obra_id, trecho_id into v_orig from public.transporte_local where id = new.origem_id;
    if v_orig.obra_id is distinct from new.obra_id then raise exception 'Origem de outra obra'; end if;
  end if;
  if new.destino_id is not null then
    select obra_id, trecho_id into v_dest from public.transporte_local where id = new.destino_id;
    if v_dest.obra_id is distinct from new.obra_id then raise exception 'Destino de outra obra'; end if;
  end if;
  -- o local da viagem é a ponta que está na obra (pista/área): o destino (aterro, base) ou, senão, a origem (corte)
  new.trecho_id := coalesce(new.trecho_id, v_dest.trecho_id, v_orig.trecho_id);
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
alter function public.fn_viagem_antes() owner to postgres;
drop trigger if exists trg_viagem_antes on public.viagem;
create trigger trg_viagem_antes before insert or update on public.viagem
  for each row execute function public.fn_viagem_antes();

-- Recompõe a produção 'viagens' de uma chave: total do dia = Σ das viagens; faixa = mín–máx das estacas.
create or replace function public.fn_viagens_recompor(_obra uuid, _data date, _item uuid, _trecho uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tot numeric; v_n int; v_ini numeric; v_fim numeric; v_mat numeric; v_unid text;
  v_prod uuid; v_par record; v_tem_mat boolean;
begin
  select sum(quantidade), count(*), min(posicao_inicio_m), max(posicao_fim_m)
    into v_tot, v_n, v_ini, v_fim
    from public.viagem
   where obra_id = _obra and data = _data and item_orcamentario_id = _item
     and trecho_id is not distinct from _trecho;
  select id into v_prod from public.acompanhamento_producao
   where obra_id = _obra and data = _data and item_orcamentario_id = _item and origem = 'viagens'
     and trecho_id is not distinct from _trecho;

  perform set_config('infrawork.viagens_sync', '1', true);
  if coalesce(v_tot, 0) <= 0 then
    if v_prod is not null then delete from public.acompanhamento_producao where id = v_prod; end if;
    perform set_config('infrawork.viagens_sync', '', true);
    return;
  end if;
  if v_prod is null then
    insert into public.acompanhamento_producao
      (obra_id, data, item_orcamentario_id, servico_nome, quantidade, origem, trecho_id,
       posicao_inicio_m, posicao_fim_m, obs, criado_por)
    values (_obra, _data, _item, '', v_tot, 'viagens', _trecho, v_ini, v_fim,
            v_n || case when v_n = 1 then ' viagem' else ' viagens' end, null)
    returning id into v_prod;
  else
    update public.acompanhamento_producao
       set quantidade = v_tot, posicao_inicio_m = v_ini, posicao_fim_m = v_fim,
           obs = v_n || case when v_n = 1 then ' viagem' else ' viagens' end
     where id = v_prod;
  end if;

  -- material controlado: Σ material das viagens (ou a própria quantidade, quando a unidade é a mesma do serviço)
  select material_recurso_id, material_unidade into v_par
    from public.servico_parametro
   where item_orcamentario_id = _item and controla_material;
  v_tem_mat := found and v_par.material_recurso_id is not null;
  delete from public.acompanhamento_producao_material where producao_id = v_prod;
  if v_tem_mat then
    select unidade into v_unid from public.acompanhamento_producao where id = v_prod;
    select sum(coalesce(material_qtd,
                        case when lower(coalesce(v_par.material_unidade, '')) = lower(coalesce(v_unid, ''))
                             then quantidade end))
      into v_mat
      from public.viagem
     where obra_id = _obra and data = _data and item_orcamentario_id = _item
       and trecho_id is not distinct from _trecho;
    if v_mat is not null then
      insert into public.acompanhamento_producao_material (producao_id, recurso_id, nome, quantidade, unidade)
      values (v_prod, v_par.material_recurso_id, '', v_mat, v_par.material_unidade);
    end if;
  end if;
  perform set_config('infrawork.viagens_sync', '', true);
end $$;
alter function public.fn_viagens_recompor(uuid, date, uuid, uuid) owner to postgres;
revoke all on function public.fn_viagens_recompor(uuid, date, uuid, uuid) from public;

create or replace function public.fn_viagem_depois()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.fn_viagens_recompor(old.obra_id, old.data, old.item_orcamentario_id, old.trecho_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.fn_viagens_recompor(new.obra_id, new.data, new.item_orcamentario_id, new.trecho_id);
  end if;
  return null;
end $$;
alter function public.fn_viagem_depois() owner to postgres;
drop trigger if exists trg_viagem_depois on public.viagem;
create trigger trg_viagem_depois after insert or update or delete on public.viagem
  for each row execute function public.fn_viagem_depois();

alter table public.viagem_ficha enable row level security;
alter table public.viagem enable row level security;
drop policy if exists ficha_select on public.viagem_ficha;
create policy ficha_select on public.viagem_ficha for select to authenticated
  using ((public.auth_role() <> 'cliente' and public.pode_ver_acompanhamento(obra_id))
         or (public.auth_role() = 'apontador' and criado_por = auth.uid()));
drop policy if exists ficha_insert on public.viagem_ficha;
create policy ficha_insert on public.viagem_ficha for insert to authenticated
  with check (public.pode_lancar_producao(obra_id) and (criado_por is null or criado_por = auth.uid()));
drop policy if exists ficha_update on public.viagem_ficha;
create policy ficha_update on public.viagem_ficha for update to authenticated
  using (public.pode_lancar_producao(obra_id)
         and (public.auth_role() not in ('apoio', 'apontador') or criado_por = auth.uid()))
  with check (public.pode_lancar_producao(obra_id));
drop policy if exists ficha_delete on public.viagem_ficha;
create policy ficha_delete on public.viagem_ficha for delete to authenticated
  using (public.pode_lancar_producao(obra_id)
         and (public.auth_role() not in ('apoio', 'apontador') or criado_por = auth.uid()));
drop policy if exists viagem_select on public.viagem;
create policy viagem_select on public.viagem for select to authenticated
  using (exists (select 1 from public.viagem_ficha f where f.id = ficha_id));
drop policy if exists viagem_write on public.viagem;
create policy viagem_write on public.viagem for all to authenticated
  using (exists (
    select 1 from public.viagem_ficha f
     where f.id = ficha_id and public.pode_lancar_producao(f.obra_id)
       and (public.auth_role() not in ('apoio', 'apontador') or f.criado_por = auth.uid())))
  with check (exists (
    select 1 from public.viagem_ficha f
     where f.id = ficha_id and public.pode_lancar_producao(f.obra_id)
       and (public.auth_role() not in ('apoio', 'apontador') or f.criado_por = auth.uid())));
grant select, insert, update, delete on public.viagem_ficha, public.viagem to authenticated;

-- excluir a obra: as viagens saem antes do orçamento (viagem → item é NO ACTION, para não perder viagens apagando um
-- item avulso)
create or replace function public.excluir_obra(_obra_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform set_config('infrawork.excluindo_obra', '1', true);
  -- ordem: as chaves NO ACTION entre ramos da cascata (tarefa → equipe, item de CPU → recurso, item do orçamento →
  -- serviço, foto da linha de base → plano, viagem → item) são conferidas no fim de cada comando aninhado da cascata
  delete from public.viagem_ficha where obra_id = _obra_id;
  delete from public.planejamento_baseline_snapshot where obra_id = _obra_id;
  delete from public.planejamento where obra_id = _obra_id;
  delete from public.cpu where obra_id = _obra_id;
  delete from public.item_orcamentario where obra_id = _obra_id;
  delete from public.obras where id = _obra_id;
  perform set_config('infrawork.excluindo_obra', '', true);
end $$;
revoke all on function public.excluir_obra(uuid) from public, anon, authenticated;
grant execute on function public.excluir_obra(uuid) to service_role;

-- ═══ 7. papel apontador ══════════════════════════════════════════════════════════════════════════
create or replace function public.pode_lancar_producao(_obra_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.auth_role()
    when 'god'        then true
    when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
    when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
    when 'apoio'      then public.has_obra_permissao(_obra_id, public.auth_engenheiro_id())
    when 'apontador'  then public.has_obra_permissao(_obra_id, auth.uid())
    else false
  end
$$;

-- apontador (como apoio) só altera e apaga o que lançou
drop policy if exists acomp_prod_update on public.acompanhamento_producao;
create policy acomp_prod_update on public.acompanhamento_producao
  for update to authenticated
  using (public.pode_lancar_producao(obra_id)
         and (public.auth_role() not in ('apoio', 'apontador') or criado_por = auth.uid()))
  with check (public.pode_lancar_producao(obra_id));
drop policy if exists acomp_prod_delete on public.acompanhamento_producao;
create policy acomp_prod_delete on public.acompanhamento_producao
  for delete to authenticated
  using (public.pode_lancar_producao(obra_id)
         and (public.auth_role() not in ('apoio', 'apontador') or criado_por = auth.uid()));
drop policy if exists acomp_foto_update on public.acompanhamento_foto;
create policy acomp_foto_update on public.acompanhamento_foto
  for update to authenticated
  using (public.pode_lancar_producao(obra_id)
         and (public.auth_role() not in ('apoio', 'apontador') or enviado_por = auth.uid()))
  with check (public.pode_lancar_producao(obra_id));

-- ═══ 8. RPCs do app de campo ═════════════════════════════════════════════════════════════════════
create or replace function public.campo_assert(_obra_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.pode_lancar_producao(_obra_id) then
    raise exception 'Sem permissão para lançar nesta obra';
  end if;
end $$;

create or replace function public.campo_obras()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'codigo', o.codigo, 'nome', o.nome, 'empresa_id', o.empresa_id, 'status', o.status)
           order by o.codigo), '[]'::jsonb)
    from public.obras o
   where auth.uid() is not null and public.pode_lancar_producao(o.id)
$$;

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
        from public.frota_veiculo v
       where v.empresa_id = public.obra_empresa(_obra_id) and v.ativo), '[]'::jsonb),
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

-- Lote de lançamentos do app (≤ 200), idempotente por app_uuid. Erro num registro não derruba os outros.
create or replace function public.campo_sync_producao(_registros jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_uuid uuid; v_obra uuid; v_id uuid; v_dono uuid; v_mat numeric;
  v_controla boolean; v_obrig boolean; v_rec uuid; v_unid text;
  aceitos jsonb := '[]'::jsonb; rejeitados jsonb := '[]'::jsonb; v_msg text;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if jsonb_typeof(_registros) <> 'array' or jsonb_array_length(_registros) > 200 then
    raise exception 'Envie de 1 a 200 registros';
  end if;
  for r in select * from jsonb_array_elements(_registros) loop
    begin
      v_uuid := (r->>'app_uuid')::uuid;
      v_obra := (r->>'obra_id')::uuid;
      if v_uuid is null or v_obra is null then raise exception 'app_uuid e obra_id são obrigatórios'; end if;
      perform public.campo_assert(v_obra);
      select id, criado_por into v_id, v_dono from public.acompanhamento_producao where app_uuid = v_uuid;
      if v_id is not null and public.auth_role() in ('apoio', 'apontador') and v_dono is distinct from auth.uid() then
        raise exception 'Lançamento de outro usuário';
      end if;

      if coalesce((r->>'excluir')::boolean, false) then
        if v_id is not null then delete from public.acompanhamento_producao where id = v_id; end if;
        aceitos := aceitos || to_jsonb(v_uuid::text);
        continue;
      end if;

      v_controla := false; v_obrig := false; v_rec := null; v_unid := null;
      select true, material_obrigatorio, material_recurso_id, material_unidade
        into v_controla, v_obrig, v_rec, v_unid
        from public.servico_parametro
       where item_orcamentario_id = (r->>'item_orcamentario_id')::uuid and controla_material;
      v_controla := coalesce(v_controla, false);
      v_mat := nullif(r->>'material_qtd', '')::numeric;
      if v_controla and v_obrig and v_mat is null then
        raise exception 'Informe a quantidade de material aplicado';
      end if;

      if v_id is null then
        insert into public.acompanhamento_producao
          (app_uuid, obra_id, data, item_orcamentario_id, servico_nome, equipe_id, encarregado_id, quantidade,
           frente, estaca_inicial, estaca_final, trecho_id, posicao_inicio_m, posicao_fim_m, obs, origem)
        values
          (v_uuid, v_obra, (r->>'data')::date, (r->>'item_orcamentario_id')::uuid, '',
           nullif(r->>'equipe_id', '')::uuid, nullif(r->>'encarregado_id', '')::uuid,
           (r->>'quantidade')::numeric, nullif(r->>'frente', ''), nullif(r->>'estaca_inicial', ''),
           nullif(r->>'estaca_final', ''), nullif(r->>'trecho_id', '')::uuid,
           nullif(r->>'posicao_inicio_m', '')::numeric, nullif(r->>'posicao_fim_m', '')::numeric,
           nullif(r->>'obs', ''), 'campo')
        returning id into v_id;
      else
        update public.acompanhamento_producao set
          data = (r->>'data')::date, item_orcamentario_id = (r->>'item_orcamentario_id')::uuid,
          servico_id = null, servico_nome = '', unidade = null,
          equipe_id = nullif(r->>'equipe_id', '')::uuid, encarregado_id = nullif(r->>'encarregado_id', '')::uuid,
          quantidade = (r->>'quantidade')::numeric, frente = nullif(r->>'frente', ''),
          estaca_inicial = nullif(r->>'estaca_inicial', ''), estaca_final = nullif(r->>'estaca_final', ''),
          trecho_id = nullif(r->>'trecho_id', '')::uuid,
          posicao_inicio_m = nullif(r->>'posicao_inicio_m', '')::numeric,
          posicao_fim_m = nullif(r->>'posicao_fim_m', '')::numeric,
          obs = nullif(r->>'obs', '')
         where id = v_id;
      end if;

      delete from public.acompanhamento_producao_material where producao_id = v_id;
      if v_controla and v_mat is not null then
        insert into public.acompanhamento_producao_material (producao_id, recurso_id, nome, quantidade, unidade)
        values (v_id, v_rec, '', v_mat, v_unid);
      end if;
      aceitos := aceitos || to_jsonb(v_uuid::text);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      rejeitados := rejeitados || jsonb_build_object('app_uuid', r->>'app_uuid', 'motivo', v_msg);
    end;
  end loop;
  return jsonb_build_object('aceitos', aceitos, 'rejeitados', rejeitados);
end $$;

-- Ficha + viagens numa transação, idempotente pelos ids gerados no aparelho (reenvio não duplica).
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
       quantidade, material_qtd, dmt_km, nf_ticket, trecho_id, posicao_inicio_m, posicao_fim_m, obs, ordem)
    values
      ((v->>'id')::uuid, v_id, v_obra, (_ficha->>'data')::date, (v->>'item_orcamentario_id')::uuid,
       nullif(v->>'origem_id', '')::uuid, nullif(v->>'destino_id', '')::uuid,
       nullif(v->>'hora_carga', '')::time, nullif(v->>'hora_descarga', '')::time,
       (v->>'quantidade')::numeric, nullif(v->>'material_qtd', '')::numeric, nullif(v->>'dmt_km', '')::numeric,
       nullif(v->>'nf_ticket', ''), nullif(v->>'trecho_id', '')::uuid,
       nullif(v->>'posicao_inicio_m', '')::numeric, nullif(v->>'posicao_fim_m', '')::numeric,
       nullif(v->>'obs', ''), n)
    on conflict (id) do update set
      item_orcamentario_id = excluded.item_orcamentario_id, origem_id = excluded.origem_id,
      destino_id = excluded.destino_id, hora_carga = excluded.hora_carga, hora_descarga = excluded.hora_descarga,
      quantidade = excluded.quantidade, material_qtd = excluded.material_qtd, dmt_km = excluded.dmt_km,
      nf_ticket = excluded.nf_ticket, trecho_id = excluded.trecho_id,
      posicao_inicio_m = excluded.posicao_inicio_m, posicao_fim_m = excluded.posicao_fim_m,
      obs = excluded.obs, ordem = excluded.ordem
    where public.viagem.ficha_id = v_id;
  end loop;
  delete from public.viagem where ficha_id = v_id and not (id = any (v_ids));
  return jsonb_build_object('ficha_id', v_id, 'viagens', n);
end $$;

-- Foto enviada pelo app (o arquivo já subiu ao bucket); idempotente por app_uuid.
create or replace function public.campo_registrar_foto(_meta jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uuid uuid := (_meta->>'app_uuid')::uuid; v_obra uuid := (_meta->>'obra_id')::uuid;
  v_id uuid; v_prod uuid; v_item uuid; v_nome text;
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if v_uuid is null or v_obra is null or nullif(_meta->>'storage_key', '') is null then
    raise exception 'app_uuid, obra_id e storage_key são obrigatórios';
  end if;
  perform public.campo_assert(v_obra);
  if split_part(_meta->>'storage_key', '/', 2) <> v_obra::text then
    raise exception 'Arquivo fora da pasta da obra';
  end if;
  select id into v_id from public.acompanhamento_foto where app_uuid = v_uuid;
  if v_id is not null then return jsonb_build_object('id', v_id, 'duplicada', true); end if;
  v_prod := coalesce(nullif(_meta->>'producao_id', '')::uuid,
                     (select id from public.acompanhamento_producao
                       where app_uuid = nullif(_meta->>'producao_app_uuid', '')::uuid));
  v_item := nullif(_meta->>'item_orcamentario_id', '')::uuid;
  if v_item is not null then
    select descricao into v_nome from public.item_orcamentario where id = v_item and obra_id = v_obra;
    if v_nome is null then raise exception 'Serviço de outra obra'; end if;
  end if;
  insert into public.acompanhamento_foto
    (app_uuid, obra_id, producao_id, item_orcamentario_id, servico_nome, encarregado_id, lat, lng, captured_at,
     storage_key, mime, size_bytes, width, height, obs)
  values
    (v_uuid, v_obra, v_prod, v_item, v_nome, nullif(_meta->>'encarregado_id', '')::uuid,
     nullif(_meta->>'lat', '')::numeric, nullif(_meta->>'lng', '')::numeric,
     coalesce(nullif(_meta->>'captured_at', '')::timestamptz, now()),
     _meta->>'storage_key', nullif(_meta->>'mime', ''), nullif(_meta->>'size_bytes', '')::bigint,
     nullif(_meta->>'width', '')::int, nullif(_meta->>'height', '')::int, nullif(_meta->>'obs', ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'duplicada', false);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'campo_assert(uuid)', 'campo_obras()', 'campo_catalogo(uuid)', 'campo_sync_producao(jsonb)',
    'campo_sync_ficha(jsonb)', 'campo_registrar_foto(jsonb)'
  ] loop
    execute format('alter function public.%s owner to postgres', f);
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ═══ 9. produção enriquecida: resumo do material aplicado e o uuid do app (colunas novas no fim) ═════════════════
create or replace view public.vw_acompanhamento_producao_enriquecida with (security_invoker = true) as
SELECT p.id,
    p.obra_id,
    p.data,
    p.item_orcamentario_id,
    p.servico_id,
    p.servico_id AS servico_planejamento_id,
    p.servico_nome,
    p.quantidade AS qtd,
    (p.quantidade * p.fator_conversao)::numeric(14,4) AS qtd_convertida,
    p.fator_conversao,
    p.unidade,
    COALESCE(s.unidade, io.unidade_referencia, p.unidade) AS unidade_plano,
    COALESCE(NULLIF(TRIM(BOTH FROM p.frente), ''::text), '(sem frente)'::text) AS frente,
    p.frente AS frente_raw,
    p.estaca_inicial,
    p.estaca_final,
    p.obs,
    p.origem,
    p.importacao_id,
    p.criado_por,
    pr.nome AS criado_por_nome,
    p.created_at,
    p.updated_at,
    p.equipe_id,
    p.equipe_id AS equipe_planejamento_id,
    COALESCE(e.nome, '—'::text) AS equipe_display_nome,
    COALESCE(e.cor, '#94a3b8'::text) AS equipe_display_cor,
    e.tipo AS equipe_tipo,
    p.encarregado_id,
    COALESCE(en.apelido, en.nome) AS encarregado_display_nome,
    s.codigo AS servico_codigo,
    COALESCE(s.nome, p.servico_nome) AS servico_display_nome,
    s.unidade AS servico_unidade,
    io.codigo AS servico_grupo_codigo,
    io.descricao AS servico_grupo_descricao,
    pta.tarefa_id AS tarefa_baseline_id,
    pta.data_inicio AS tarefa_data_inicio,
    pta.data_fim AS tarefa_data_fim,
    ( SELECT count(*) AS count
           FROM acompanhamento_foto f
          WHERE f.producao_id = p.id AND f.excluida_em IS NULL) AS fotos_count,
    p.trecho_id,
    p.posicao_inicio_m,
    p.posicao_fim_m,
    tr.nome AS trecho_nome,
    tr.tipo AS trecho_tipo,
    ( SELECT string_agg(trim(both from concat_ws(' ', to_char(m.quantidade, 'FM999999990.####'), m.unidade, m.nome)), '; ' ORDER BY m.nome)
           FROM acompanhamento_producao_material m
          WHERE m.producao_id = p.id) AS material_resumo,
    p.app_uuid
   FROM acompanhamento_producao p
     LEFT JOIN equipe e ON e.id = p.equipe_id
     LEFT JOIN encarregado en ON en.id = p.encarregado_id
     LEFT JOIN item_orcamentario io ON io.id = p.item_orcamentario_id
     LEFT JOIN servico s ON s.id = p.servico_id
     LEFT JOIN profiles pr ON pr.id = p.criado_por
     LEFT JOIN obra_trecho tr ON tr.id = p.trecho_id
     LEFT JOIN planejamento pl ON pl.obra_id = p.obra_id AND pl.id = planejamento_referencia(p.obra_id)
     LEFT JOIN ( SELECT pt.planejamento_id,
            pt.item_orcamentario_id,
            min(pt.data_inicio) AS data_inicio,
            max(pt.data_fim) AS data_fim,
            (array_agg(pt.id ORDER BY pt.data_inicio))[1] AS tarefa_id
           FROM planejamento_tarefa pt
          WHERE pt.item_orcamentario_id IS NOT NULL
          GROUP BY pt.planejamento_id, pt.item_orcamentario_id) pta ON pta.planejamento_id = pl.id AND pta.item_orcamentario_id = p.item_orcamentario_id;

grant select on public.vw_acompanhamento_producao_enriquecida to authenticated;

notify pgrst, 'reload schema';
