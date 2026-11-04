-- Remove o módulo antigo de revisões do orçamento (snapshot + restaurar).
-- Substituído por aditivos (Planilha Inicial arquivada no 1º aditivo),
-- reajustes datados e linhas de base do planejamento.

drop table if exists public.revisao_orcamento cascade;

drop function if exists public.vw_orcamento_consolidado_revisao(uuid);
drop function if exists public.revisao_obra(uuid);
drop function if exists public.revisao_empresa(uuid);
drop function if exists public.fn_revisao_imutavel();
drop function if exists public.fn_revisao_versao_auto();
