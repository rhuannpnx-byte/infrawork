-- InfraWork — Orçamento (Revisão Maior): RLS dos catálogos por obra
--
-- Nova matriz (substitui filtro empresa_id por has_obra_permissao):
--   God:        tudo
--   Adm:        tudo nas obras da empresa do caller (obra_empresa(obra_id) = auth_empresa_id())
--   Engenheiro: tudo com has_obra_permissao(obra_id, auth.uid())
--   Apoio:      select-only com has_obra_permissao(obra_id, auth_engenheiro_id())
--
-- Tabelas afetadas: encargos_sociais_regime, recurso, recurso_preco, servico,
-- cpu, cpu_item, template_importacao.

-- =========================================================================
-- encargos_sociais_regime
-- =========================================================================
drop policy if exists encargos_god_all      on public.encargos_sociais_regime;
drop policy if exists encargos_adm_eng_all  on public.encargos_sociais_regime;
drop policy if exists encargos_apoio_select on public.encargos_sociais_regime;

create policy encargos_god_all on public.encargos_sociais_regime
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

create policy encargos_adm_all on public.encargos_sociais_regime
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id());

create policy encargos_eng_all on public.encargos_sociais_regime
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()));

create policy encargos_apoio_select on public.encargos_sociais_regime
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- =========================================================================
-- recurso
-- =========================================================================
drop policy if exists recurso_god_all      on public.recurso;
drop policy if exists recurso_adm_eng_all  on public.recurso;
drop policy if exists recurso_apoio_select on public.recurso;

create policy recurso_god_all on public.recurso
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

create policy recurso_adm_all on public.recurso
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id());

create policy recurso_eng_all on public.recurso
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()));

create policy recurso_apoio_select on public.recurso
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- =========================================================================
-- recurso_preco — via recurso_obra()
-- =========================================================================
drop policy if exists recurso_preco_god_all      on public.recurso_preco;
drop policy if exists recurso_preco_adm_eng_all  on public.recurso_preco;
drop policy if exists recurso_preco_apoio_select on public.recurso_preco;

create policy recurso_preco_god_all on public.recurso_preco
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

create policy recurso_preco_adm_all on public.recurso_preco
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(public.recurso_obra(recurso_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(public.recurso_obra(recurso_id)) = public.auth_empresa_id());

create policy recurso_preco_eng_all on public.recurso_preco
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.recurso_obra(recurso_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.recurso_obra(recurso_id), auth.uid()));

create policy recurso_preco_apoio_select on public.recurso_preco
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(public.recurso_obra(recurso_id), public.auth_engenheiro_id()));

-- =========================================================================
-- servico
-- =========================================================================
drop policy if exists servico_god_all      on public.servico;
drop policy if exists servico_adm_eng_all  on public.servico;
drop policy if exists servico_apoio_select on public.servico;

create policy servico_god_all on public.servico
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

create policy servico_adm_all on public.servico
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id());

create policy servico_eng_all on public.servico
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()));

create policy servico_apoio_select on public.servico
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- =========================================================================
-- cpu
-- =========================================================================
drop policy if exists cpu_god_all      on public.cpu;
drop policy if exists cpu_adm_eng_all  on public.cpu;
drop policy if exists cpu_apoio_select on public.cpu;

create policy cpu_god_all on public.cpu
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

create policy cpu_adm_all on public.cpu
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id());

create policy cpu_eng_all on public.cpu
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()));

create policy cpu_apoio_select on public.cpu
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));

-- =========================================================================
-- cpu_item — via cpu_obra()
-- =========================================================================
drop policy if exists cpu_item_god_all      on public.cpu_item;
drop policy if exists cpu_item_adm_eng_all  on public.cpu_item;
drop policy if exists cpu_item_apoio_select on public.cpu_item;

create policy cpu_item_god_all on public.cpu_item
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

create policy cpu_item_adm_all on public.cpu_item
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(public.cpu_obra(cpu_id)) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(public.cpu_obra(cpu_id)) = public.auth_empresa_id());

create policy cpu_item_eng_all on public.cpu_item
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.cpu_obra(cpu_id), auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(public.cpu_obra(cpu_id), auth.uid()));

create policy cpu_item_apoio_select on public.cpu_item
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(public.cpu_obra(cpu_id), public.auth_engenheiro_id()));

-- =========================================================================
-- template_importacao
-- =========================================================================
drop policy if exists template_god_all      on public.template_importacao;
drop policy if exists template_adm_eng_all  on public.template_importacao;
drop policy if exists template_apoio_select on public.template_importacao;

create policy template_god_all on public.template_importacao
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

create policy template_adm_all on public.template_importacao
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id());

create policy template_eng_all on public.template_importacao
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()));

create policy template_apoio_select on public.template_importacao
  for select
  to authenticated
  using (public.auth_role() = 'apoio'
         and public.has_obra_permissao(obra_id, public.auth_engenheiro_id()));
