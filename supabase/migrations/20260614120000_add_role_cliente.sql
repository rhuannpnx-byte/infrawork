-- InfraWork — adiciona o papel 'cliente' ao enum de papéis.
--
-- O 'cliente' é o usuário final da obra: acesso somente leitura a um subconjunto
-- do módulo Acompanhamento (calendário planejado × executado, fotos/mapa,
-- produção e previsto × realizado sem projeções). Vincula-se a uma empresa e a
-- obras específicas pelo mesmo mecanismo do engenheiro (obra_permissoes).
--
-- ⚠️ Adicionar um valor a um enum NÃO pode ser usado como literal na mesma
-- transação em que é criado. Por isso este ALTER TYPE fica ISOLADO nesta
-- migration; as policies que referenciam 'cliente' como literal ficam na
-- migration seguinte (20260614120100_rls_cliente.sql).
--
-- As constraints existentes em profiles já são compatíveis com cliente:
--   - chk_god_no_empresa     → cliente tem empresa_id NOT NULL (não-god)
--   - chk_apoio_has_engenheiro → cliente tem engenheiro_id NULL (não-apoio)

alter type public.role_enum add value if not exists 'cliente';
