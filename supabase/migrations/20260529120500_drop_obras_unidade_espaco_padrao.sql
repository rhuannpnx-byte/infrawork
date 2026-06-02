-- InfraWork — Remove obras.unidade_espaco_padrao (movido pra obra_trecho)
--
-- Pre-requisito: view v3 (migration 120400) ja recriada sem referencia a
-- obras.unidade_espaco_padrao. Trechos default ja foram criados em 120200
-- herdando o valor dessa coluna.

-- Drop constraint check primeiro (se existir).
alter table public.obras drop constraint if exists chk_obras_unidade_espaco;

-- Drop coluna. Se algum objeto ainda depende dela, falha (intencional —
-- forca a investigar antes de remover).
alter table public.obras drop column if exists unidade_espaco_padrao;
