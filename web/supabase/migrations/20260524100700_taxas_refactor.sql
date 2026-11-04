-- Refactor "encargos_sociais_regime" → conceito de "Taxas" (impostos sobre
-- receita usados como deflator no cálculo de lucro).
--
-- Antes (encargos sobre folha): 10 colunas específicas (INSS, FGTS, SAT, etc.)
-- Agora (taxas sobre receita): impostos do orçamento de governo + outros.
--
-- Mantém o nome da tabela `encargos_sociais_regime` por consistência com
-- migrations existentes (renomear quebra FKs do CPU). O frontend chama de
-- "Taxas".

-- Bloqueia trigger temporariamente pra evitar problemas durante o ALTER
alter table public.encargos_sociais_regime disable trigger trg_encargos_total_calc;

-- ─── Drop colunas antigas (encargos sobre folha) ──────────────────────────
alter table public.encargos_sociais_regime
  drop column if exists inss_perc,
  drop column if exists sat_rat_perc,
  drop column if exists salario_educacao_perc,
  drop column if exists sesi_senai_sebrae_perc,
  drop column if exists incra_perc,
  drop column if exists fgts_perc,
  drop column if exists ferias_terco_perc,
  drop column if exists decimo_terceiro_perc,
  drop column if exists fgts_rescisao_perc;

-- outros_perc fica (já existe e continua sendo o catch-all)

-- ─── Adiciona colunas novas (impostos sobre receita) ──────────────────────
-- Defaults baseados em regime padrão (Lucro Real construção civil):
--   ISS 5%, PIS 0,65%, COFINS 3%, CSLL 1,08%, IRPJ 1,2%, CPRB 4,5% → ~15,43%
alter table public.encargos_sociais_regime
  add column if not exists iss_perc    numeric(7,4) not null default 0,
  add column if not exists pis_perc    numeric(7,4) not null default 0,
  add column if not exists cofins_perc numeric(7,4) not null default 0,
  add column if not exists csll_perc   numeric(7,4) not null default 0,
  add column if not exists irpj_perc   numeric(7,4) not null default 0,
  add column if not exists cprb_perc   numeric(7,4) not null default 0;

-- ─── Atualiza trigger de cálculo do total ─────────────────────────────────
create or replace function public.fn_encargos_total_calc()
returns trigger
language plpgsql
as $$
begin
  new.total_perc_calc :=
      coalesce(new.iss_perc, 0)
    + coalesce(new.pis_perc, 0)
    + coalesce(new.cofins_perc, 0)
    + coalesce(new.csll_perc, 0)
    + coalesce(new.irpj_perc, 0)
    + coalesce(new.cprb_perc, 0)
    + coalesce(new.outros_perc, 0);
  return new;
end
$$;

alter function public.fn_encargos_total_calc() owner to postgres;

alter table public.encargos_sociais_regime enable trigger trg_encargos_total_calc;

-- ─── Força recálculo dos registros existentes ─────────────────────────────
update public.encargos_sociais_regime set outros_perc = outros_perc;
