-- InfraWork — Trechos: templates de quantidades versionadas
--
-- 5 tabelas:
--   trecho_quantidade_template       — container estavel (nome+modo nao mudam apos criacao)
--   trecho_quantidade_versao         — snapshot completo; sempre exatamente 1 is_atual por template
--   trecho_quantidade_coluna         — POR VERSAO (cada versao tem suas proprias colunas)
--   trecho_quantidade_segmento       — POR VERSAO (1 linha por unidade minima da grade)
--   trecho_quantidade_celula         — valor numerico (segmento × coluna; mesma versao)
--
-- Triggers:
--   fn_tqv_numero_auto    — auto-incrementa numero da versao por template (BEFORE INSERT)
--   fn_tqv_promote        — ao setar is_atual=true, desmarca outras versoes (BEFORE UPDATE)
--   fn_tqv_imutavel       — bloqueia UPDATE/DELETE em coluna/segmento/celula de versao nao-atual
--
-- RLS: 5 tabelas × 4 policies (god/adm/eng/apoio-readonly) = 20 policies total.
-- Cadeia: template→trecho→obra via helpers SECURITY DEFINER ja existentes
--         + 3 novos helpers (tqt_obra, tqv_obra, tqseg_obra).

-- ─── Tabelas ────────────────────────────────────────────────────────────

create table if not exists public.trecho_quantidade_template (
  id          uuid primary key default gen_random_uuid(),
  trecho_id   uuid not null references public.obra_trecho(id) on delete cascade,
  nome        text not null,
  modo        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
do $$ begin
  alter table public.trecho_quantidade_template add constraint chk_tqt_modo
    check (modo in ('analitico', 'simplificado'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.trecho_quantidade_template add constraint chk_tqt_nome
    check (length(trim(nome)) > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.trecho_quantidade_template add constraint uq_tqt_trecho_nome
    unique (trecho_id, nome);
exception when duplicate_object then null; end $$;
create index if not exists idx_tqt_trecho on public.trecho_quantidade_template(trecho_id);

drop trigger if exists trg_tqt_updated_at on public.trecho_quantidade_template;
create trigger trg_tqt_updated_at before update on public.trecho_quantidade_template
  for each row execute function public.fn_touch_updated_at();

create table if not exists public.trecho_quantidade_versao (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.trecho_quantidade_template(id) on delete cascade,
  numero      integer not null,
  is_atual    boolean not null default true,
  comentario  text,
  criado_por  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
do $$ begin
  alter table public.trecho_quantidade_versao add constraint chk_tqv_numero_pos
    check (numero >= 1);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.trecho_quantidade_versao add constraint uq_tqv_template_numero
    unique (template_id, numero);
exception when duplicate_object then null; end $$;
create unique index if not exists uq_tqv_template_atual
  on public.trecho_quantidade_versao(template_id)
  where is_atual = true;
create index if not exists idx_tqv_template on public.trecho_quantidade_versao(template_id);

drop trigger if exists trg_tqv_updated_at on public.trecho_quantidade_versao;
create trigger trg_tqv_updated_at before update on public.trecho_quantidade_versao
  for each row execute function public.fn_touch_updated_at();

create table if not exists public.trecho_quantidade_coluna (
  id         uuid primary key default gen_random_uuid(),
  versao_id  uuid not null references public.trecho_quantidade_versao(id) on delete cascade,
  nome       text not null,
  unidade    text not null,
  ordem      integer not null default 0
);
do $$ begin
  alter table public.trecho_quantidade_coluna add constraint chk_tqc_nome
    check (length(trim(nome)) > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.trecho_quantidade_coluna add constraint chk_tqc_unidade
    check (length(trim(unidade)) > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.trecho_quantidade_coluna add constraint uq_tqc_versao_nome
    unique (versao_id, nome);
exception when duplicate_object then null; end $$;
create index if not exists idx_tqc_versao on public.trecho_quantidade_coluna(versao_id);

create table if not exists public.trecho_quantidade_segmento (
  id                   uuid primary key default gen_random_uuid(),
  versao_id            uuid not null references public.trecho_quantidade_versao(id) on delete cascade,
  ordem                integer not null,
  posicao_inicio_m     numeric(14, 2) not null,
  posicao_fim_m        numeric(14, 2) not null,
  unidade_inicio_label text,
  unidade_fim_label    text
);
do $$ begin
  alter table public.trecho_quantidade_segmento add constraint chk_tqs_ordem
    check (posicao_fim_m >= posicao_inicio_m);
exception when duplicate_object then null; end $$;
create index if not exists idx_tqs_versao on public.trecho_quantidade_segmento(versao_id, ordem);

create table if not exists public.trecho_quantidade_celula (
  segmento_id  uuid not null references public.trecho_quantidade_segmento(id) on delete cascade,
  coluna_id    uuid not null references public.trecho_quantidade_coluna(id) on delete cascade,
  valor        numeric(18, 3) not null,
  primary key (segmento_id, coluna_id)
);
create index if not exists idx_tqcel_segmento on public.trecho_quantidade_celula(segmento_id);
create index if not exists idx_tqcel_coluna on public.trecho_quantidade_celula(coluna_id);

-- ─── Triggers ──────────────────────────────────────────────────────────

create or replace function public.fn_tqv_numero_auto()
returns trigger language plpgsql as $$
begin
  if new.numero is null then
    select coalesce(max(numero), 0) + 1 into new.numero
      from public.trecho_quantidade_versao where template_id = new.template_id;
  end if;
  return new;
end $$;
alter function public.fn_tqv_numero_auto() owner to postgres;

drop trigger if exists trg_tqv_numero_auto on public.trecho_quantidade_versao;
create trigger trg_tqv_numero_auto before insert on public.trecho_quantidade_versao
  for each row execute function public.fn_tqv_numero_auto();

create or replace function public.fn_tqv_promote()
returns trigger language plpgsql as $$
begin
  if new.is_atual = true and (old.is_atual is null or old.is_atual = false) then
    update public.trecho_quantidade_versao
       set is_atual = false, updated_at = now()
     where template_id = new.template_id and id <> new.id and is_atual = true;
  end if;
  return new;
end $$;
alter function public.fn_tqv_promote() owner to postgres;

drop trigger if exists trg_tqv_promote on public.trecho_quantidade_versao;
create trigger trg_tqv_promote before update of is_atual on public.trecho_quantidade_versao
  for each row execute function public.fn_tqv_promote();

create or replace function public.fn_tqv_imutavel()
returns trigger language plpgsql as $$
declare
  v_versao uuid;
  v_atual  boolean;
begin
  if tg_table_name = 'trecho_quantidade_coluna' then
    v_versao := coalesce(new.versao_id, old.versao_id);
  elsif tg_table_name = 'trecho_quantidade_segmento' then
    v_versao := coalesce(new.versao_id, old.versao_id);
  elsif tg_table_name = 'trecho_quantidade_celula' then
    select s.versao_id into v_versao from public.trecho_quantidade_segmento s
      where s.id = coalesce(new.segmento_id, old.segmento_id);
  end if;
  select is_atual into v_atual from public.trecho_quantidade_versao where id = v_versao;
  if coalesce(v_atual, false) = true then return coalesce(new, old); end if;
  raise exception 'Versão de quantidade não-atual é imutável. Crie uma nova versão para editar.';
end $$;
alter function public.fn_tqv_imutavel() owner to postgres;

drop trigger if exists trg_tqv_coluna_imutavel on public.trecho_quantidade_coluna;
create trigger trg_tqv_coluna_imutavel
  before update or delete on public.trecho_quantidade_coluna
  for each row execute function public.fn_tqv_imutavel();

drop trigger if exists trg_tqv_segmento_imutavel on public.trecho_quantidade_segmento;
create trigger trg_tqv_segmento_imutavel
  before update or delete on public.trecho_quantidade_segmento
  for each row execute function public.fn_tqv_imutavel();

drop trigger if exists trg_tqv_celula_imutavel on public.trecho_quantidade_celula;
create trigger trg_tqv_celula_imutavel
  before update or delete on public.trecho_quantidade_celula
  for each row execute function public.fn_tqv_imutavel();

-- ─── Helpers SECURITY DEFINER (resolve obra para RLS) ──────────────────

create or replace function public.tqt_obra(_template_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select public.trecho_obra(trecho_id)
    from public.trecho_quantidade_template where id = _template_id
$$;

create or replace function public.tqv_obra(_versao_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select public.tqt_obra(template_id)
    from public.trecho_quantidade_versao where id = _versao_id
$$;

create or replace function public.tqseg_obra(_seg_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select public.tqv_obra(versao_id)
    from public.trecho_quantidade_segmento where id = _seg_id
$$;

alter function public.tqt_obra(uuid)   owner to postgres;
alter function public.tqv_obra(uuid)   owner to postgres;
alter function public.tqseg_obra(uuid) owner to postgres;
revoke all on function public.tqt_obra(uuid)   from public;
revoke all on function public.tqv_obra(uuid)   from public;
revoke all on function public.tqseg_obra(uuid) from public;
grant execute on function public.tqt_obra(uuid)   to authenticated;
grant execute on function public.tqv_obra(uuid)   to authenticated;
grant execute on function public.tqseg_obra(uuid) to authenticated;

-- ─── RLS ────────────────────────────────────────────────────────────────

alter table public.trecho_quantidade_template enable row level security;
alter table public.trecho_quantidade_versao   enable row level security;
alter table public.trecho_quantidade_coluna   enable row level security;
alter table public.trecho_quantidade_segmento enable row level security;
alter table public.trecho_quantidade_celula   enable row level security;

-- template (resolve via trecho_obra)
drop policy if exists tqt_god_all on public.trecho_quantidade_template;
create policy tqt_god_all on public.trecho_quantidade_template for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');
drop policy if exists tqt_adm_all on public.trecho_quantidade_template;
create policy tqt_adm_all on public.trecho_quantidade_template for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(public.trecho_obra(trecho_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(public.trecho_obra(trecho_id)) = public.auth_empresa_id());
drop policy if exists tqt_eng_all on public.trecho_quantidade_template;
create policy tqt_eng_all on public.trecho_quantidade_template for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(public.trecho_obra(trecho_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(public.trecho_obra(trecho_id), auth.uid()));
drop policy if exists tqt_apoio_select on public.trecho_quantidade_template;
create policy tqt_apoio_select on public.trecho_quantidade_template for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(public.trecho_obra(trecho_id), public.auth_engenheiro_id()));

-- versao (resolve via tqt_obra(template_id))
drop policy if exists tqv_god_all on public.trecho_quantidade_versao;
create policy tqv_god_all on public.trecho_quantidade_versao for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');
drop policy if exists tqv_adm_all on public.trecho_quantidade_versao;
create policy tqv_adm_all on public.trecho_quantidade_versao for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(public.tqt_obra(template_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(public.tqt_obra(template_id)) = public.auth_empresa_id());
drop policy if exists tqv_eng_all on public.trecho_quantidade_versao;
create policy tqv_eng_all on public.trecho_quantidade_versao for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(public.tqt_obra(template_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(public.tqt_obra(template_id), auth.uid()));
drop policy if exists tqv_apoio_select on public.trecho_quantidade_versao;
create policy tqv_apoio_select on public.trecho_quantidade_versao for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(public.tqt_obra(template_id), public.auth_engenheiro_id()));

-- coluna (resolve via tqv_obra(versao_id))
drop policy if exists tqc_god_all on public.trecho_quantidade_coluna;
create policy tqc_god_all on public.trecho_quantidade_coluna for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');
drop policy if exists tqc_adm_all on public.trecho_quantidade_coluna;
create policy tqc_adm_all on public.trecho_quantidade_coluna for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(public.tqv_obra(versao_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(public.tqv_obra(versao_id)) = public.auth_empresa_id());
drop policy if exists tqc_eng_all on public.trecho_quantidade_coluna;
create policy tqc_eng_all on public.trecho_quantidade_coluna for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(public.tqv_obra(versao_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(public.tqv_obra(versao_id), auth.uid()));
drop policy if exists tqc_apoio_select on public.trecho_quantidade_coluna;
create policy tqc_apoio_select on public.trecho_quantidade_coluna for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(public.tqv_obra(versao_id), public.auth_engenheiro_id()));

-- segmento (resolve via tqv_obra(versao_id))
drop policy if exists tqs_god_all on public.trecho_quantidade_segmento;
create policy tqs_god_all on public.trecho_quantidade_segmento for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');
drop policy if exists tqs_adm_all on public.trecho_quantidade_segmento;
create policy tqs_adm_all on public.trecho_quantidade_segmento for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(public.tqv_obra(versao_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(public.tqv_obra(versao_id)) = public.auth_empresa_id());
drop policy if exists tqs_eng_all on public.trecho_quantidade_segmento;
create policy tqs_eng_all on public.trecho_quantidade_segmento for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(public.tqv_obra(versao_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(public.tqv_obra(versao_id), auth.uid()));
drop policy if exists tqs_apoio_select on public.trecho_quantidade_segmento;
create policy tqs_apoio_select on public.trecho_quantidade_segmento for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(public.tqv_obra(versao_id), public.auth_engenheiro_id()));

-- celula (resolve via tqseg_obra(segmento_id))
drop policy if exists tqcel_god_all on public.trecho_quantidade_celula;
create policy tqcel_god_all on public.trecho_quantidade_celula for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');
drop policy if exists tqcel_adm_all on public.trecho_quantidade_celula;
create policy tqcel_adm_all on public.trecho_quantidade_celula for all to authenticated
  using      (public.auth_role() = 'adm' and public.obra_empresa(public.tqseg_obra(segmento_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.obra_empresa(public.tqseg_obra(segmento_id)) = public.auth_empresa_id());
drop policy if exists tqcel_eng_all on public.trecho_quantidade_celula;
create policy tqcel_eng_all on public.trecho_quantidade_celula for all to authenticated
  using      (public.auth_role() = 'engenheiro' and public.has_obra_permissao(public.tqseg_obra(segmento_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro' and public.has_obra_permissao(public.tqseg_obra(segmento_id), auth.uid()));
drop policy if exists tqcel_apoio_select on public.trecho_quantidade_celula;
create policy tqcel_apoio_select on public.trecho_quantidade_celula for select to authenticated
  using (public.auth_role() = 'apoio' and public.has_obra_permissao(public.tqseg_obra(segmento_id), public.auth_engenheiro_id()));

grant select, insert, update, delete on public.trecho_quantidade_template to authenticated;
grant select, insert, update, delete on public.trecho_quantidade_versao   to authenticated;
grant select, insert, update, delete on public.trecho_quantidade_coluna   to authenticated;
grant select, insert, update, delete on public.trecho_quantidade_segmento to authenticated;
grant select, insert, update, delete on public.trecho_quantidade_celula   to authenticated;
