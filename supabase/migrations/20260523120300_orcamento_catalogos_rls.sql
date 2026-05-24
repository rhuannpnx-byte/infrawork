-- InfraWork — Orçamento (Fase 1.3): RLS dos catálogos
--
-- Matriz acordada:
--   - God        → all (qualquer empresa)
--   - Adm        → all  na própria empresa
--   - Engenheiro → all  na própria empresa (decisão fechada: pode editar catálogo)
--   - Apoio      → select-only na própria empresa
--
-- Tabelas com `empresa_id` direto: filtro pela coluna.
-- Tabelas-filhas (recurso_preco, cpu_item): usam helpers SECURITY DEFINER
--   recurso_empresa() / cpu_empresa() (criados na migration 120200).

alter table public.encargos_sociais_regime enable row level security;
alter table public.recurso                  enable row level security;
alter table public.recurso_preco            enable row level security;
alter table public.servico                  enable row level security;
alter table public.cpu                      enable row level security;
alter table public.cpu_item                 enable row level security;

-- =========================================================================
-- encargos_sociais_regime
-- =========================================================================
drop policy if exists encargos_god_all       on public.encargos_sociais_regime;
create policy encargos_god_all on public.encargos_sociais_regime
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists encargos_adm_eng_all   on public.encargos_sociais_regime;
create policy encargos_adm_eng_all on public.encargos_sociais_regime
  for all
  to authenticated
  using      (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id())
  with check (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id());

drop policy if exists encargos_apoio_select  on public.encargos_sociais_regime;
create policy encargos_apoio_select on public.encargos_sociais_regime
  for select
  to authenticated
  using (public.auth_role() = 'apoio' and empresa_id = public.auth_empresa_id());

-- =========================================================================
-- recurso
-- =========================================================================
drop policy if exists recurso_god_all       on public.recurso;
create policy recurso_god_all on public.recurso
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists recurso_adm_eng_all   on public.recurso;
create policy recurso_adm_eng_all on public.recurso
  for all
  to authenticated
  using      (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id())
  with check (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id());

drop policy if exists recurso_apoio_select  on public.recurso;
create policy recurso_apoio_select on public.recurso
  for select
  to authenticated
  using (public.auth_role() = 'apoio' and empresa_id = public.auth_empresa_id());

-- =========================================================================
-- recurso_preco — herda empresa via recurso_empresa()
-- =========================================================================
drop policy if exists recurso_preco_god_all       on public.recurso_preco;
create policy recurso_preco_god_all on public.recurso_preco
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists recurso_preco_adm_eng_all   on public.recurso_preco;
create policy recurso_preco_adm_eng_all on public.recurso_preco
  for all
  to authenticated
  using      (public.auth_role() in ('adm', 'engenheiro')
              and public.recurso_empresa(recurso_id) = public.auth_empresa_id())
  with check (public.auth_role() in ('adm', 'engenheiro')
              and public.recurso_empresa(recurso_id) = public.auth_empresa_id());

drop policy if exists recurso_preco_apoio_select  on public.recurso_preco;
create policy recurso_preco_apoio_select on public.recurso_preco
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.recurso_empresa(recurso_id) = public.auth_empresa_id());

-- =========================================================================
-- servico
-- =========================================================================
drop policy if exists servico_god_all       on public.servico;
create policy servico_god_all on public.servico
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists servico_adm_eng_all   on public.servico;
create policy servico_adm_eng_all on public.servico
  for all
  to authenticated
  using      (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id())
  with check (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id());

drop policy if exists servico_apoio_select  on public.servico;
create policy servico_apoio_select on public.servico
  for select
  to authenticated
  using (public.auth_role() = 'apoio' and empresa_id = public.auth_empresa_id());

-- =========================================================================
-- cpu
-- =========================================================================
drop policy if exists cpu_god_all       on public.cpu;
create policy cpu_god_all on public.cpu
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists cpu_adm_eng_all   on public.cpu;
create policy cpu_adm_eng_all on public.cpu
  for all
  to authenticated
  using      (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id())
  with check (public.auth_role() in ('adm', 'engenheiro') and empresa_id = public.auth_empresa_id());

drop policy if exists cpu_apoio_select  on public.cpu;
create policy cpu_apoio_select on public.cpu
  for select
  to authenticated
  using (public.auth_role() = 'apoio' and empresa_id = public.auth_empresa_id());

-- =========================================================================
-- cpu_item — herda empresa via cpu_empresa()
-- =========================================================================
drop policy if exists cpu_item_god_all       on public.cpu_item;
create policy cpu_item_god_all on public.cpu_item
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

drop policy if exists cpu_item_adm_eng_all   on public.cpu_item;
create policy cpu_item_adm_eng_all on public.cpu_item
  for all
  to authenticated
  using      (public.auth_role() in ('adm', 'engenheiro')
              and public.cpu_empresa(cpu_id) = public.auth_empresa_id())
  with check (public.auth_role() in ('adm', 'engenheiro')
              and public.cpu_empresa(cpu_id) = public.auth_empresa_id());

drop policy if exists cpu_item_apoio_select  on public.cpu_item;
create policy cpu_item_apoio_select on public.cpu_item
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.cpu_empresa(cpu_id) = public.auth_empresa_id());
