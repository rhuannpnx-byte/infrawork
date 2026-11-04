-- InfraWork — Acompanhamento (Fase B): fator de conversão + unidades no servico_match
--
-- Casos reais: SIGA registra "CBUQ (Aplicacao)" em m², mas o orçamento espera
-- a quantidade em Toneladas. Usuário escolhe um fator (ex: 2.4 T/m²) que
-- multiplica `qtd` real do SIGA antes de comparar com o plano.
--
-- Também capturamos as unidades vindas do SIGA por linha de produção, para
-- mostrar na UI e ajudar a calibração.

alter table public.acompanhamento_servico_match
  add column if not exists fator_conversao numeric(14,6) not null default 1,
  add column if not exists siga_unidade_id int,
  add column if not exists siga_unidade_nome text;

do $$ begin
  alter table public.acompanhamento_servico_match
    add constraint chk_acomp_serv_match_fator_pos check (fator_conversao > 0);
exception when duplicate_object then null; end $$;

-- Cache da unidade SIGA por linha de produção (capturada no sync)
alter table public.acompanhamento_producao
  add column if not exists siga_unidade_id int,
  add column if not exists siga_unidade_nome text;

-- Backfill: tenta extrair da payload_bruto
update public.acompanhamento_producao p
   set siga_unidade_id   = (p.payload_bruto->>'controle_producao_servico_executado_unidade_id')::int,
       siga_unidade_nome = p.payload_bruto->>'controle_producao_servico_executado_unidade_nome'
 where p.siga_unidade_id is null
   and p.payload_bruto ? 'controle_producao_servico_executado_unidade_id';

-- Propaga unidade do SIGA para o match (caso já exista match sem unidade)
update public.acompanhamento_servico_match sm
   set siga_unidade_id   = sub.unidade_id,
       siga_unidade_nome = sub.unidade_nome
  from (
    select distinct on (obra_id, servico_id)
           p.obra_id,
           p.servico_id,
           p.siga_unidade_id   as unidade_id,
           p.siga_unidade_nome as unidade_nome
      from public.acompanhamento_producao p
     where p.siga_unidade_id is not null
     order by obra_id, servico_id, p.sincronizado_em desc
  ) sub
 where sm.obra_id = sub.obra_id
   and sm.siga_servico_executado_id = sub.servico_id
   and sm.siga_unidade_id is null;
