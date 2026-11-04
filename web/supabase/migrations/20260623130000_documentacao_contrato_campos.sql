-- InfraWork — Documentação Oficial: campos adicionais do contrato
--
-- A extração por IA passou a capturar prazo/fim de vigência calculados, janela
-- de execução das obras e a regra de reajuste (índice, periodicidade, data-base
-- e elegibilidade). Persistimos esses campos no contrato.

alter table public.contrato
  add column if not exists prazo_vigencia_meses          int,
  add column if not exists execucao_inicio               date,
  add column if not exists execucao_fim                  date,
  add column if not exists reajuste_indice               text,
  add column if not exists reajuste_periodicidade_meses  int,
  add column if not exists reajuste_data_base            date,
  add column if not exists reajuste_elegivel_em          date;

comment on column public.contrato.execucao_inicio is 'Início da execução das obras (OS/assinatura) — distinto da vigência contratual.';
comment on column public.contrato.reajuste_elegivel_em is 'Data a partir da qual o 1º reajuste é elegível (data-base + periodicidade).';
