-- InfraWork Web — papel de campo `apontador` (app de campo: produção, viagens e fotos das obras liberadas).
-- Migração isolada: `alter type … add value` não pode ser usada na mesma transação que adiciona o valor.
--   - chk_god_no_empresa       → apontador tem empresa_id NOT NULL (não-god)
--   - chk_apoio_has_engenheiro → apontador tem engenheiro_id NULL (não-apoio)
-- Permissão por obra: linha direta em obra_permissoes (como engenheiro/cliente). Regras em 0034.

alter type public.role_enum add value if not exists 'apontador';
