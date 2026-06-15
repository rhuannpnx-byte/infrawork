-- InfraWork — RLS de leitura do vínculo SIGA para o papel 'cliente'.
--
-- A página de Produção (e outras do acompanhamento) checa
-- obra_acompanhamento_link para saber se a obra está vinculada ao SIGA. Sem
-- policy de SELECT, o cliente lê NULL e a tela mostra "Obra não vinculada ao
-- SIGA" mesmo quando está. A tabela só contém metadados do vínculo (código/nome
-- do projeto SIGA, status/horário de sync) — sem preço/custo, exposição segura.
-- Espelha acomp_link_eng_select: leitura apenas, e só para obras concedidas.

drop policy if exists acomp_link_cliente_select on public.obra_acompanhamento_link;
create policy acomp_link_cliente_select on public.obra_acompanhamento_link
  for select
  to authenticated
  using (
    public.auth_role() = 'cliente'
    and public.has_obra_permissao(obra_id, auth.uid())
  );
