-- InfraWork Web — Produção NATIVA (módulo de lançamento) no lugar do sync SIGA.
--
--   encarregado                      pessoa de campo (sem login obrigatório).
--   acompanhamento_producao          1 lançamento = (data, item do orçamento, equipe, encarregado, quantidade).
--   acompanhamento_producao_material materiais aplicados (alimenta a medição).
--   acompanhamento_foto              foto nativa (upload do browser/celular), ligada ao lançamento.
--
-- A identidade do serviço é o `item_orcamentario` (tipo servico_grupo): é por
-- ele que a curva S e o previsto × realizado comparam plano × real.
-- `servico_id`/`servico_nome`/`unidade` são snapshots (sobrevivem a revisões).
--
-- RLS: god/adm/engenheiro/apoio lançam nas obras que acessam; apoio só edita e
-- apaga os próprios lançamentos; cliente lê via RPCs cliente_* (0008).

-- ─── encarregado ──────────────────────────────────────────────────────────
create table if not exists public.encarregado (
  id          uuid        primary key default gen_random_uuid(),
  obra_id     uuid        not null references public.obras(id) on delete cascade,
  nome        text        not null,
  apelido     text,
  telefone    text,
  profile_id  uuid        references public.profiles(id) on delete set null,
  ativo       boolean     not null default true,
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (obra_id, nome)
);
create index if not exists idx_encarregado_obra on public.encarregado(obra_id) where ativo;

drop trigger if exists trg_encarregado_touch on public.encarregado;
create trigger trg_encarregado_touch
  before update on public.encarregado
  for each row execute function public.fn_touch_updated_at();

-- ─── acompanhamento_producao ──────────────────────────────────────────────
create table if not exists public.acompanhamento_producao (
  id                   uuid          primary key default gen_random_uuid(),
  obra_id              uuid          not null references public.obras(id) on delete cascade,
  data                 date          not null,
  item_orcamentario_id uuid          references public.item_orcamentario(id) on delete set null,
  servico_id           uuid          references public.servico(id) on delete set null,
  servico_nome         text          not null,
  unidade              text,
  equipe_id            uuid          references public.equipe(id) on delete set null,
  encarregado_id       uuid          references public.encarregado(id) on delete set null,
  quantidade           numeric(14,4) not null,
  fator_conversao      numeric(14,6) not null default 1,
  frente               text,
  estaca_inicial       text,
  estaca_final         text,
  obs                  text,
  origem               text          not null default 'app',
  importacao_id        uuid,
  criado_por           uuid          references public.profiles(id) on delete set null,
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now(),
  constraint chk_acomp_prod_qtd    check (quantidade >= 0),
  constraint chk_acomp_prod_fator  check (fator_conversao > 0),
  constraint chk_acomp_prod_origem check (origem in ('app', 'importacao'))
);
create index if not exists idx_acomp_prod_obra_data   on public.acompanhamento_producao(obra_id, data desc);
create index if not exists idx_acomp_prod_obra_item   on public.acompanhamento_producao(obra_id, item_orcamentario_id, data);
create index if not exists idx_acomp_prod_obra_equipe on public.acompanhamento_producao(obra_id, equipe_id, data);
create index if not exists idx_acomp_prod_obra_enc    on public.acompanhamento_producao(obra_id, encarregado_id);
create index if not exists idx_acomp_prod_servico     on public.acompanhamento_producao(servico_id);
create index if not exists idx_acomp_prod_importacao  on public.acompanhamento_producao(importacao_id) where importacao_id is not null;

create or replace function public.fn_acomp_prod_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_item record;
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
    new.servico_id   := coalesce(new.servico_id, v_item.servico_id);
    new.servico_nome := coalesce(nullif(trim(new.servico_nome), ''), v_item.descricao);
    new.unidade      := coalesce(new.unidade, v_item.unidade);
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

drop trigger if exists trg_acomp_prod_before_write on public.acompanhamento_producao;
create trigger trg_acomp_prod_before_write
  before insert or update on public.acompanhamento_producao
  for each row execute function public.fn_acomp_prod_before_write();

-- ─── materiais do lançamento ──────────────────────────────────────────────
create table if not exists public.acompanhamento_producao_material (
  id          uuid          primary key default gen_random_uuid(),
  producao_id uuid          not null references public.acompanhamento_producao(id) on delete cascade,
  nome        text          not null,
  quantidade  numeric(14,4),
  unidade     text
);
create index if not exists idx_acomp_prod_mat on public.acompanhamento_producao_material(producao_id);

-- ─── acompanhamento_foto ──────────────────────────────────────────────────
create table if not exists public.acompanhamento_foto (
  id                   uuid          primary key default gen_random_uuid(),
  obra_id              uuid          not null references public.obras(id) on delete cascade,
  producao_id          uuid          references public.acompanhamento_producao(id) on delete set null,
  item_orcamentario_id uuid          references public.item_orcamentario(id) on delete set null,
  servico_nome         text,
  encarregado_id       uuid          references public.encarregado(id) on delete set null,
  lat                  numeric(10,6),
  lng                  numeric(10,6),
  captured_at          timestamptz,
  storage_bucket       text          not null default 'acompanhamento-fotos',
  storage_key          text          not null,
  mime                 text,
  size_bytes           bigint,
  width                int,
  height               int,
  obs                  text,
  enviado_por          uuid          references public.profiles(id) on delete set null,
  excluida_em          timestamptz,
  excluida_por         uuid          references public.profiles(id) on delete set null,
  created_at           timestamptz   not null default now()
);
create index if not exists idx_acomp_foto_obra_data on public.acompanhamento_foto(obra_id, captured_at desc);
create index if not exists idx_acomp_foto_producao  on public.acompanhamento_foto(producao_id);
create index if not exists idx_acomp_foto_geo       on public.acompanhamento_foto(obra_id)
  where lat is not null and lng is not null and excluida_em is null;
create index if not exists idx_acomp_foto_viva      on public.acompanhamento_foto(obra_id) where excluida_em is null;

create or replace function public.fn_acomp_foto_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.producao_id is not null then
    select p.obra_id, p.item_orcamentario_id, p.servico_nome, p.encarregado_id
      into new.obra_id, new.item_orcamentario_id, new.servico_nome, new.encarregado_id
      from public.acompanhamento_producao p
     where p.id = new.producao_id;
    if new.obra_id is null then raise exception 'Lançamento inexistente'; end if;
  end if;
  if new.captured_at is null then new.captured_at := now(); end if;
  new.enviado_por := coalesce(new.enviado_por, auth.uid());
  return new;
end $$;
alter function public.fn_acomp_foto_before_insert() owner to postgres;

drop trigger if exists trg_acomp_foto_before_insert on public.acompanhamento_foto;
create trigger trg_acomp_foto_before_insert
  before insert on public.acompanhamento_foto
  for each row execute function public.fn_acomp_foto_before_insert();

-- Usuários só podem alterar `obs` (soft delete é via edge function/service_role).
create or replace function public.fn_acomp_foto_update_whitelist()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.auth_role() in ('god', 'adm') or auth.uid() is null then
    return new;
  end if;
  if new.storage_key <> old.storage_key or new.producao_id is distinct from old.producao_id
     or new.obra_id <> old.obra_id or new.excluida_em is distinct from old.excluida_em
     or new.lat is distinct from old.lat or new.lng is distinct from old.lng
     or new.captured_at is distinct from old.captured_at then
    raise exception 'Só a observação da foto pode ser alterada';
  end if;
  return new;
end $$;
alter function public.fn_acomp_foto_update_whitelist() owner to postgres;

drop trigger if exists trg_acomp_foto_update_whitelist on public.acompanhamento_foto;
create trigger trg_acomp_foto_update_whitelist
  before update on public.acompanhamento_foto
  for each row execute function public.fn_acomp_foto_update_whitelist();

-- ─── Helpers SECURITY DEFINER ─────────────────────────────────────────────
create or replace function public.acomp_producao_obra(_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select obra_id from public.acompanhamento_producao where id = _id
$$;
create or replace function public.acomp_foto_obra(_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select obra_id from public.acompanhamento_foto where id = _id
$$;
create or replace function public.encarregado_obra(_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select obra_id from public.encarregado where id = _id
$$;

-- Quem pode lançar produção numa obra.
create or replace function public.pode_lancar_producao(_obra_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.auth_role()
    when 'god'        then true
    when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
    when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
    when 'apoio'      then public.has_obra_permissao(_obra_id, public.auth_engenheiro_id())
    else false
  end
$$;

-- Quem pode LER acompanhamento de uma obra (4 personas; cliente via RPC).
create or replace function public.pode_ver_acompanhamento(_obra_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.auth_role()
    when 'god'        then true
    when 'adm'        then public.obra_empresa(_obra_id) = public.auth_empresa_id()
    when 'engenheiro' then public.has_obra_permissao(_obra_id, auth.uid())
    when 'apoio'      then public.has_obra_permissao(_obra_id, public.auth_engenheiro_id())
    when 'cliente'    then public.has_obra_permissao(_obra_id, auth.uid())
    else false
  end
$$;

alter function public.acomp_producao_obra(uuid)      owner to postgres;
alter function public.acomp_foto_obra(uuid)          owner to postgres;
alter function public.encarregado_obra(uuid)         owner to postgres;
alter function public.pode_lancar_producao(uuid)     owner to postgres;
alter function public.pode_ver_acompanhamento(uuid)  owner to postgres;
revoke all on function public.acomp_producao_obra(uuid)     from public;
revoke all on function public.acomp_foto_obra(uuid)         from public;
revoke all on function public.encarregado_obra(uuid)        from public;
revoke all on function public.pode_lancar_producao(uuid)    from public;
revoke all on function public.pode_ver_acompanhamento(uuid) from public;
grant execute on function public.acomp_producao_obra(uuid)     to authenticated;
grant execute on function public.acomp_foto_obra(uuid)         to authenticated;
grant execute on function public.encarregado_obra(uuid)        to authenticated;
grant execute on function public.pode_lancar_producao(uuid)    to authenticated;
grant execute on function public.pode_ver_acompanhamento(uuid) to authenticated;

-- ─── RLS ──────────────────────────────────────────────────────────────────
alter table public.encarregado                      enable row level security;
alter table public.acompanhamento_producao          enable row level security;
alter table public.acompanhamento_producao_material enable row level security;
alter table public.acompanhamento_foto              enable row level security;

-- encarregado
drop policy if exists encarregado_select on public.encarregado;
create policy encarregado_select on public.encarregado
  for select to authenticated
  using (public.auth_role() <> 'cliente' and public.pode_ver_acompanhamento(obra_id));
drop policy if exists encarregado_insert on public.encarregado;
create policy encarregado_insert on public.encarregado
  for insert to authenticated
  with check (public.pode_lancar_producao(obra_id));
drop policy if exists encarregado_update on public.encarregado;
create policy encarregado_update on public.encarregado
  for update to authenticated
  using (public.pode_lancar_producao(obra_id))
  with check (public.pode_lancar_producao(obra_id));
drop policy if exists encarregado_delete on public.encarregado;
create policy encarregado_delete on public.encarregado
  for delete to authenticated
  using (public.auth_role() in ('god', 'adm', 'engenheiro') and public.pode_lancar_producao(obra_id));

-- acompanhamento_producao
drop policy if exists acomp_prod_select on public.acompanhamento_producao;
create policy acomp_prod_select on public.acompanhamento_producao
  for select to authenticated
  using (public.auth_role() <> 'cliente' and public.pode_ver_acompanhamento(obra_id));
drop policy if exists acomp_prod_insert on public.acompanhamento_producao;
create policy acomp_prod_insert on public.acompanhamento_producao
  for insert to authenticated
  with check (public.pode_lancar_producao(obra_id) and (criado_por is null or criado_por = auth.uid()));
drop policy if exists acomp_prod_update on public.acompanhamento_producao;
create policy acomp_prod_update on public.acompanhamento_producao
  for update to authenticated
  using (public.pode_lancar_producao(obra_id) and (public.auth_role() <> 'apoio' or criado_por = auth.uid()))
  with check (public.pode_lancar_producao(obra_id));
drop policy if exists acomp_prod_delete on public.acompanhamento_producao;
create policy acomp_prod_delete on public.acompanhamento_producao
  for delete to authenticated
  using (public.pode_lancar_producao(obra_id) and (public.auth_role() <> 'apoio' or criado_por = auth.uid()));

-- materiais (espelham o lançamento)
drop policy if exists acomp_prod_mat_select on public.acompanhamento_producao_material;
create policy acomp_prod_mat_select on public.acompanhamento_producao_material
  for select to authenticated
  using (public.auth_role() <> 'cliente' and public.pode_ver_acompanhamento(public.acomp_producao_obra(producao_id)));
drop policy if exists acomp_prod_mat_write on public.acompanhamento_producao_material;
create policy acomp_prod_mat_write on public.acompanhamento_producao_material
  for all to authenticated
  using (public.pode_lancar_producao(public.acomp_producao_obra(producao_id)))
  with check (public.pode_lancar_producao(public.acomp_producao_obra(producao_id)));

-- fotos
drop policy if exists acomp_foto_select on public.acompanhamento_foto;
create policy acomp_foto_select on public.acompanhamento_foto
  for select to authenticated
  using (public.pode_ver_acompanhamento(obra_id));
drop policy if exists acomp_foto_insert on public.acompanhamento_foto;
create policy acomp_foto_insert on public.acompanhamento_foto
  for insert to authenticated
  with check (public.pode_lancar_producao(obra_id) and (enviado_por is null or enviado_por = auth.uid()));
drop policy if exists acomp_foto_update on public.acompanhamento_foto;
create policy acomp_foto_update on public.acompanhamento_foto
  for update to authenticated
  using (public.pode_lancar_producao(obra_id) and (public.auth_role() <> 'apoio' or enviado_por = auth.uid()))
  with check (public.pode_lancar_producao(obra_id));

-- ─── Storage: bucket acompanhamento-fotos (path <empresa_id>/<obra_id>/…) ─
drop policy if exists acomp_fotos_storage_select on storage.objects;
create policy acomp_fotos_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'acompanhamento-fotos'
         and public.pode_ver_acompanhamento((split_part(name, '/', 2))::uuid));

drop policy if exists acomp_fotos_storage_insert on storage.objects;
create policy acomp_fotos_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'acompanhamento-fotos'
              and public.pode_lancar_producao((split_part(name, '/', 2))::uuid));

drop policy if exists acomp_fotos_storage_delete on storage.objects;
create policy acomp_fotos_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'acompanhamento-fotos'
         and public.auth_role() in ('god', 'adm')
         and public.pode_lancar_producao((split_part(name, '/', 2))::uuid));

-- ─── Alertas: a tabela sobrevive; só muda o CHECK de tipos (0009) ─────────
