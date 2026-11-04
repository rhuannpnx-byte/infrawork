-- InfraWork Web — Reajustes contratuais (anuais, encadeados, por grupos).
--
--   * O usuário cria GRUPOS com índice anterior e índice atual; o fator do
--     grupo é atual ÷ anterior (encadeado: o "anterior" de um reajuste é o
--     "atual" do reajuste passado). Classifica as receitas nos grupos e, ao
--     aplicar, o preço de venda de cada receita é multiplicado pelo fator.
--   * Intervalo: o 1º reajuste ≥ 12 meses da data-base do orçamento; os
--     seguintes ≥ 12 meses do anterior.
--   * DATADO e prospectivo: o preço anterior fica registrado por receita, e
--     receita_preco_em(receita, data) devolve o preço vigente numa data — o
--     valor agregado e a curva planejada valoram cada período pelo preço da
--     época.
--   * Passa pela trava da cadeia (infrawork.via_aditivo), como o aditivo.

alter table public.obras add column if not exists data_base_orcamento date;

create table if not exists public.orcamento_reajuste (
  id           uuid primary key default gen_random_uuid(),
  obra_id      uuid not null references public.obras(id) on delete cascade,
  numero       int not null default 0,
  data         date not null,
  descricao    text,
  status       text not null default 'rascunho' check (status in ('rascunho', 'aplicado')),
  venda_antes  numeric(18,2),
  venda_depois numeric(18,2),
  criado_por   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  aplicado_em  timestamptz,
  aplicado_por uuid references public.profiles(id) on delete set null,
  unique (obra_id, numero)
);

create table if not exists public.orcamento_reajuste_grupo (
  id              uuid primary key default gen_random_uuid(),
  reajuste_id     uuid not null references public.orcamento_reajuste(id) on delete cascade,
  obra_id         uuid not null references public.obras(id) on delete cascade,
  ordem           int not null default 0,
  nome            text not null,
  indice_anterior numeric(18,6) not null check (indice_anterior > 0),
  indice_atual    numeric(18,6) not null check (indice_atual > 0),
  unique (reajuste_id, nome)
);

create table if not exists public.orcamento_reajuste_item (
  reajuste_id  uuid not null references public.orcamento_reajuste(id) on delete cascade,
  receita_id   uuid not null references public.item_orcamentario(id) on delete cascade,
  grupo_id     uuid not null references public.orcamento_reajuste_grupo(id) on delete cascade,
  obra_id      uuid not null references public.obras(id) on delete cascade,
  fator        numeric(18,8),
  preco_antes  numeric(18,4),
  preco_depois numeric(18,4),
  primary key (reajuste_id, receita_id)
);
create index if not exists idx_reajuste_item_receita on public.orcamento_reajuste_item (receita_id);

create or replace function public.fn_reajuste_before()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.numero is null or new.numero = 0 then
      perform pg_advisory_xact_lock(hashtext('reajuste:' || new.obra_id::text));
      select coalesce(max(numero), 0) + 1 into new.numero
        from public.orcamento_reajuste where obra_id = new.obra_id;
    end if;
    new.criado_por := coalesce(new.criado_por, auth.uid());
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'aplicado' then raise exception 'Reajuste aplicado não pode ser excluído'; end if;
    return old;
  end if;
  if old.status = 'aplicado'
     and coalesce(current_setting('infrawork.via_aditivo', true), '') <> '1'
     and (new.data is distinct from old.data or new.status is distinct from old.status) then
    raise exception 'Reajuste % já aplicado — só a descrição pode mudar', old.numero;
  end if;
  return new;
end $$;

drop trigger if exists trg_reajuste_before on public.orcamento_reajuste;
create trigger trg_reajuste_before
  before insert or update or delete on public.orcamento_reajuste
  for each row execute function public.fn_reajuste_before();

-- grupos e itens: só no rascunho
create or replace function public.fn_reajuste_filho_before()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare st text; ob uuid;
begin
  select status, obra_id into st, ob
    from public.orcamento_reajuste where id = coalesce(new.reajuste_id, old.reajuste_id);
  if st = 'aplicado' and coalesce(current_setting('infrawork.via_aditivo', true), '') <> '1' then
    raise exception 'Reajuste já aplicado — grupos e classificação não podem mudar';
  end if;
  if tg_op <> 'DELETE' then new.obra_id := ob; return new; end if;
  return old;
end $$;

drop trigger if exists trg_reajuste_grupo_before on public.orcamento_reajuste_grupo;
create trigger trg_reajuste_grupo_before
  before insert or update or delete on public.orcamento_reajuste_grupo
  for each row execute function public.fn_reajuste_filho_before();
drop trigger if exists trg_reajuste_item_before on public.orcamento_reajuste_item;
create trigger trg_reajuste_item_before
  before insert or update or delete on public.orcamento_reajuste_item
  for each row execute function public.fn_reajuste_filho_before();

alter table public.orcamento_reajuste enable row level security;
alter table public.orcamento_reajuste_grupo enable row level security;
alter table public.orcamento_reajuste_item enable row level security;
do $$
declare t text;
begin
  foreach t in array array['orcamento_reajuste', 'orcamento_reajuste_grupo', 'orcamento_reajuste_item'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$create policy %I on public.%I for select using (
        public.auth_role() = 'god'
        or (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id())
        or (public.auth_role() in ('engenheiro', 'cliente') and public.has_obra_permissao(obra_id, auth.uid()))
        or (public.auth_role() = 'apoio' and public.has_obra_permissao(obra_id, public.auth_engenheiro_id())))$p$,
      t || '_select', t);
    execute format('create policy %I on public.%I for all using (public.pode_editar_orcamento(obra_id)) with check (public.pode_editar_orcamento(obra_id))',
      t || '_write', t);
  end loop;
end $$;
grant select, insert, update, delete
  on public.orcamento_reajuste, public.orcamento_reajuste_grupo, public.orcamento_reajuste_item
  to authenticated;

-- ─── Data-base do orçamento ─────────────────────────────────────────────────
create or replace function public.definir_data_base(_obra_id uuid, _data date)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.pode_editar_orcamento(_obra_id) then raise exception 'Sem permissão'; end if;
  if exists (select 1 from public.orcamento_reajuste where obra_id = _obra_id and status = 'aplicado') then
    raise exception 'Já há reajuste aplicado — a data-base não pode mudar';
  end if;
  update public.obras set data_base_orcamento = _data where id = _obra_id;
end $$;
grant execute on function public.definir_data_base(uuid, date) to authenticated;

-- ─── Preço de uma receita numa data (reajustes são prospectivos) ───────────
create or replace function public.receita_preco_em(_receita_id uuid, _data date)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select ri.preco_antes
       from public.orcamento_reajuste_item ri
       join public.orcamento_reajuste re on re.id = ri.reajuste_id
      where ri.receita_id = _receita_id and re.status = 'aplicado' and re.data > _data
      order by re.data
      limit 1),
    (select venda_unitaria from public.item_orcamentario where id = _receita_id))
$$;
grant execute on function public.receita_preco_em(uuid, date) to authenticated, service_role;

-- ─── Aplicar ───────────────────────────────────────────────────────────────
create or replace function public.aplicar_reajuste(_reajuste_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r record; v_base date; v_prev date; venda0 numeric; venda1 numeric; n int;
begin
  select * into r from public.orcamento_reajuste where id = _reajuste_id for update;
  if r.id is null then raise exception 'Reajuste não encontrado'; end if;
  if not public.pode_editar_orcamento(r.obra_id) then raise exception 'Sem permissão'; end if;
  if r.status = 'aplicado' then raise exception 'Reajuste % já aplicado', r.numero; end if;

  select data_base_orcamento into v_base from public.obras where id = r.obra_id;
  select max(data) into v_prev from public.orcamento_reajuste
   where obra_id = r.obra_id and status = 'aplicado';
  if v_prev is not null then
    if r.data < (v_prev + interval '12 months')::date then
      raise exception 'O reajuste precisa de 12 meses do anterior (% → a partir de %)',
        to_char(v_prev, 'DD/MM/YYYY'), to_char((v_prev + interval '12 months')::date, 'DD/MM/YYYY');
    end if;
  else
    if v_base is null then raise exception 'Defina a data-base do orçamento antes do 1º reajuste'; end if;
    if r.data < (v_base + interval '12 months')::date then
      raise exception 'O 1º reajuste precisa de 12 meses da data-base (% → a partir de %)',
        to_char(v_base, 'DD/MM/YYYY'), to_char((v_base + interval '12 months')::date, 'DD/MM/YYYY');
    end if;
  end if;

  select count(*) into n from public.orcamento_reajuste_item where reajuste_id = r.id;
  if n = 0 then raise exception 'Classifique ao menos uma receita num grupo'; end if;
  if exists (select 1 from public.orcamento_reajuste_item ri
              join public.item_orcamentario i on i.id = ri.receita_id
             where ri.reajuste_id = r.id and i.tipo <> 'receita') then
    raise exception 'Só receitas podem ser reajustadas';
  end if;

  perform pg_advisory_xact_lock(hashtext('orc:' || r.obra_id::text));
  perform set_config('infrawork.via_aditivo', '1', true);

  select coalesce(sum(venda_total_calc), 0) into venda0
    from public.item_orcamentario
   where obra_id = r.obra_id and parent_id is null and tipo <> 'servico_grupo';

  update public.orcamento_reajuste_item ri
     set fator = g.indice_atual / g.indice_anterior,
         preco_antes = i.venda_unitaria,
         preco_depois = round(i.venda_unitaria * g.indice_atual / g.indice_anterior, 2)
    from public.orcamento_reajuste_grupo g, public.item_orcamentario i
   where ri.reajuste_id = r.id and g.id = ri.grupo_id and i.id = ri.receita_id;

  update public.item_orcamentario i
     set venda_unitaria = ri.preco_depois
    from public.orcamento_reajuste_item ri
   where ri.reajuste_id = r.id and i.id = ri.receita_id;

  perform public.recalcular_orcamento(r.obra_id);

  select coalesce(sum(venda_total_calc), 0) into venda1
    from public.item_orcamentario
   where obra_id = r.obra_id and parent_id is null and tipo <> 'servico_grupo';

  update public.orcamento_reajuste
     set status = 'aplicado', aplicado_em = now(), aplicado_por = auth.uid(),
         venda_antes = venda0, venda_depois = venda1
   where id = r.id;

  perform set_config('infrawork.via_aditivo', '', true);
  return jsonb_build_object('ok', true, 'numero', r.numero, 'receitas', n,
    'venda_antes', venda0, 'venda_depois', venda1);
end $$;
grant execute on function public.aplicar_reajuste(uuid) to authenticated;
