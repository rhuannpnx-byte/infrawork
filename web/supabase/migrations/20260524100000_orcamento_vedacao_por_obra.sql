-- InfraWork — Orçamento (Revisão Maior): vedação 100% entre obras
--
-- Mudança estrutural: catálogos (recurso, servico, cpu, encargos_sociais_regime,
-- template_importacao) deixam de ser por empresa e passam a ser por obra.
-- Importação cross-obra fica como feature futura (sempre criando cópia local).
--
-- Esta migration:
--   1. Limpa todos os dados existentes do módulo orçamento (dev/teste).
--   2. Dropa view vw_recurso_com_preco (recria no fim).
--   3. Dropa helpers SECURITY DEFINER baseados em empresa_id (recurso_empresa,
--      servico_empresa, cpu_empresa, item_orc_empresa, cpu_snap_empresa,
--      indireto_empresa, template_empresa).
--   4. ALTER TABLE em cada catálogo: drop empresa_id, add obra_id + FK + UNIQUE.
--   5. Cria helpers novos: recurso_obra, servico_obra, cpu_obra, template_obra.
--   6. Atualiza trigger fn_servico_nivel_calc para validar obra (não empresa).
--   7. Drop obras.bdi_padrao_perc (BDI já vem no preço de venda, fim do conceito).
--   8. Recria view vw_recurso_com_preco com obra_id.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Limpeza dos dados em ordem topológica
-- ─────────────────────────────────────────────────────────────────────────

-- Desabilita trigger de imutabilidade do cpu_snapshot durante a limpeza
drop trigger if exists trg_cpu_snapshot_imutavel on public.cpu_snapshot;

-- Fase 4 (importação)
delete from public.import_match_fraco;
delete from public.import_job;
delete from public.template_importacao;

-- Fase 3 (revisões + anexos + comentários + memória)
delete from public.anexo;
delete from public.memoria_calculo_item;
delete from public.comentario_item;
delete from public.revisao_orcamento;

-- Fase 2 (plan_orc + indireto + snapshots)
delete from public.indireto_item;
delete from public.item_orcamentario;
delete from public.cpu_snapshot;

-- Fase 1 (catálogos)
delete from public.cpu_item;
delete from public.cpu;
delete from public.recurso_preco;
delete from public.recurso;
delete from public.servico;
delete from public.encargos_sociais_regime;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Drop view dependente
-- ─────────────────────────────────────────────────────────────────────────
drop view if exists public.vw_recurso_com_preco;

-- ─────────────────────────────────────────────────────────────────────────
-- 3a. Drop policies que referenciam helpers de empresa (recriadas na mig 2)
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists encargos_god_all       on public.encargos_sociais_regime;
drop policy if exists encargos_adm_eng_all   on public.encargos_sociais_regime;
drop policy if exists encargos_apoio_select  on public.encargos_sociais_regime;

drop policy if exists recurso_god_all        on public.recurso;
drop policy if exists recurso_adm_eng_all    on public.recurso;
drop policy if exists recurso_apoio_select   on public.recurso;

drop policy if exists recurso_preco_god_all      on public.recurso_preco;
drop policy if exists recurso_preco_adm_eng_all  on public.recurso_preco;
drop policy if exists recurso_preco_apoio_select on public.recurso_preco;

drop policy if exists servico_god_all        on public.servico;
drop policy if exists servico_adm_eng_all    on public.servico;
drop policy if exists servico_apoio_select   on public.servico;

drop policy if exists cpu_god_all            on public.cpu;
drop policy if exists cpu_adm_eng_all        on public.cpu;
drop policy if exists cpu_apoio_select       on public.cpu;

drop policy if exists cpu_item_god_all       on public.cpu_item;
drop policy if exists cpu_item_adm_eng_all   on public.cpu_item;
drop policy if exists cpu_item_apoio_select  on public.cpu_item;

drop policy if exists cpu_snap_god_select    on public.cpu_snapshot;
drop policy if exists cpu_snap_adm_select    on public.cpu_snapshot;
drop policy if exists cpu_snap_eng_select    on public.cpu_snapshot;
drop policy if exists cpu_snap_apoio_select  on public.cpu_snapshot;

drop policy if exists template_god_all       on public.template_importacao;
drop policy if exists template_adm_eng_all   on public.template_importacao;
drop policy if exists template_apoio_select  on public.template_importacao;

-- ─────────────────────────────────────────────────────────────────────────
-- 3b. Drop helpers/triggers que referenciam empresa nos catálogos
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists public.recurso_empresa(uuid);
drop function if exists public.servico_empresa(uuid);
drop function if exists public.cpu_empresa(uuid);
drop function if exists public.item_orc_empresa(uuid);
drop function if exists public.cpu_snap_empresa(uuid);
drop function if exists public.indireto_empresa(uuid);
drop function if exists public.template_empresa(uuid);

drop trigger if exists trg_servico_nivel_calc on public.servico;
drop function if exists public.fn_servico_nivel_calc();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. ALTER TABLEs — catálogos passam de empresa_id para obra_id
-- ─────────────────────────────────────────────────────────────────────────

-- encargos_sociais_regime
alter table public.encargos_sociais_regime
  drop constraint if exists encargos_sociais_regime_empresa_id_fkey,
  drop constraint if exists encargos_sociais_regime_empresa_id_nome_key;
drop index if exists idx_encargos_empresa;
alter table public.encargos_sociais_regime drop column if exists empresa_id;
alter table public.encargos_sociais_regime
  add column obra_id uuid not null references public.obras(id) on delete cascade;
alter table public.encargos_sociais_regime
  add constraint encargos_obra_nome_key unique (obra_id, nome);
create index idx_encargos_obra on public.encargos_sociais_regime(obra_id);

-- recurso
alter table public.recurso
  drop constraint if exists recurso_empresa_id_fkey,
  drop constraint if exists recurso_empresa_id_grupo_nome_key;
drop index if exists idx_recurso_empresa;
drop index if exists idx_recurso_grupo;
drop index if exists uq_recurso_empresa_codigo;
alter table public.recurso drop column if exists empresa_id;
alter table public.recurso
  add column obra_id uuid not null references public.obras(id) on delete cascade;
alter table public.recurso
  add constraint recurso_obra_grupo_nome_key unique (obra_id, grupo, nome);
create unique index uq_recurso_obra_codigo
  on public.recurso(obra_id, codigo) where codigo is not null;
create index idx_recurso_obra on public.recurso(obra_id);
create index idx_recurso_obra_grupo on public.recurso(obra_id, grupo);

-- servico
alter table public.servico
  drop constraint if exists servico_empresa_id_fkey,
  drop constraint if exists servico_empresa_id_codigo_key;
drop index if exists idx_servico_empresa;
drop index if exists idx_servico_empresa_codigo;
alter table public.servico drop column if exists empresa_id;
alter table public.servico
  add column obra_id uuid not null references public.obras(id) on delete cascade;
alter table public.servico
  add constraint servico_obra_codigo_key unique (obra_id, codigo);
create index idx_servico_obra on public.servico(obra_id);
create index idx_servico_obra_codigo on public.servico(obra_id, codigo);

-- cpu
alter table public.cpu
  drop constraint if exists cpu_empresa_id_fkey;
drop index if exists idx_cpu_empresa;
alter table public.cpu drop column if exists empresa_id;
alter table public.cpu
  add column obra_id uuid not null references public.obras(id) on delete cascade;
create index idx_cpu_obra on public.cpu(obra_id);

-- cpu_snapshot — já tem obra_id, só remove empresa_id residual
alter table public.cpu_snapshot
  drop constraint if exists cpu_snapshot_empresa_id_fkey;
drop index if exists idx_cpu_snap_empresa;
alter table public.cpu_snapshot drop column if exists empresa_id;

-- template_importacao
alter table public.template_importacao
  drop constraint if exists template_importacao_empresa_id_fkey,
  drop constraint if exists template_importacao_empresa_id_nome_key;
drop index if exists idx_template_empresa;
drop index if exists idx_template_default;
alter table public.template_importacao drop column if exists empresa_id;
alter table public.template_importacao
  add column obra_id uuid not null references public.obras(id) on delete cascade;
alter table public.template_importacao
  add constraint template_obra_nome_key unique (obra_id, nome);
create index idx_template_obra on public.template_importacao(obra_id);
create index idx_template_default_obra on public.template_importacao(obra_id) where eh_default = true;

-- import_job — já tem obra_id, mas pode ter empresa_id; vamos remover
alter table public.import_job
  drop constraint if exists import_job_empresa_id_fkey;
drop index if exists idx_import_job_empresa;
alter table public.import_job drop column if exists empresa_id;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Helpers novos baseados em obra_id
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.recurso_obra(_recurso_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select obra_id from public.recurso where id = _recurso_id
$$;

create or replace function public.servico_obra(_servico_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select obra_id from public.servico where id = _servico_id
$$;

create or replace function public.cpu_obra(_cpu_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select obra_id from public.cpu where id = _cpu_id
$$;

create or replace function public.encargos_obra(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select obra_id from public.encargos_sociais_regime where id = _id
$$;

create or replace function public.template_obra(_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select obra_id from public.template_importacao where id = _id
$$;

alter function public.recurso_obra(uuid)   owner to postgres;
alter function public.servico_obra(uuid)   owner to postgres;
alter function public.cpu_obra(uuid)       owner to postgres;
alter function public.encargos_obra(uuid)  owner to postgres;
alter function public.template_obra(uuid)  owner to postgres;

revoke all on function public.recurso_obra(uuid)   from public;
revoke all on function public.servico_obra(uuid)   from public;
revoke all on function public.cpu_obra(uuid)       from public;
revoke all on function public.encargos_obra(uuid)  from public;
revoke all on function public.template_obra(uuid)  from public;

grant execute on function public.recurso_obra(uuid)   to authenticated;
grant execute on function public.servico_obra(uuid)   to authenticated;
grant execute on function public.cpu_obra(uuid)       to authenticated;
grant execute on function public.encargos_obra(uuid)  to authenticated;
grant execute on function public.template_obra(uuid)  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Trigger nova de servico.nivel — valida obra (não empresa)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_servico_nivel_calc()
returns trigger
language plpgsql
as $$
declare
  parent_obra  uuid;
  parent_nivel smallint;
begin
  if new.parent_id is null then
    new.nivel := 1;
  else
    select obra_id, nivel into parent_obra, parent_nivel
      from public.servico
     where id = new.parent_id;
    if parent_obra is null then
      raise exception 'parent_id inexistente: %', new.parent_id;
    end if;
    if parent_obra <> new.obra_id then
      raise exception 'servico.parent precisa ser da mesma obra';
    end if;
    new.nivel := parent_nivel + 1;
  end if;
  return new;
end
$$;

create trigger trg_servico_nivel_calc
  before insert or update of parent_id, obra_id on public.servico
  for each row execute function public.fn_servico_nivel_calc();

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Drop obras.bdi_padrao_perc (BDI eliminado — preço de venda já vem com BDI)
-- ─────────────────────────────────────────────────────────────────────────
alter table public.obras drop column if exists bdi_padrao_perc;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Recria view vw_recurso_com_preco com obra_id
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.vw_recurso_com_preco
with (security_invoker = true)
as
select
  r.id,
  r.obra_id,
  r.codigo,
  r.grupo,
  r.nome,
  r.unidade,
  r.ativo,
  r.fonte,
  r.observacao,
  r.created_at,
  r.updated_at,
  public.preco_vigente_recurso(r.id) as preco_vigente
from public.recurso r;

comment on view public.vw_recurso_com_preco is
  'Recurso + preço vigente em current_date. RLS herda da tabela recurso (security_invoker).';

-- Recria a trigger de imutabilidade do cpu_snapshot
create trigger trg_cpu_snapshot_imutavel
  before update or delete on public.cpu_snapshot
  for each row execute function public.fn_cpu_snapshot_imutavel();
