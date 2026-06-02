-- InfraWork — Trechos: cor + geometria geografica + sistema de marcadores
--
-- Adiciona ao obra_trecho:
--   * cor (hex, obrigatorio, default azul) — pra diferenciar trechos em viz multi-trecho
--   * geometria opcional (GeoJSON LineString + bounds + comprimento + sentido)
--   * sistema de unidades de referencia estendido: enum aceita 'custom' + colunas auxiliares
--
-- Decisoes do plano:
--   - Sem bucket de storage. KMZ original e descartado apos parse client-side.
--   - Geometria geojson direto em jsonb (consultas SQL não precisam dela; UI le inteira).
--   - 'custom' no enum vs schema paralelo: unificado.
--
-- RLS herda automaticamente — colunas vivem em obra_trecho que ja tem 4 policies.

-- ─── Cor ────────────────────────────────────────────────────────────────
alter table public.obra_trecho
  add column if not exists cor text not null default '#3b82f6';

do $$ begin
  alter table public.obra_trecho add constraint chk_obra_trecho_cor_hex
    check (cor ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null; end $$;

-- ─── Geometria (opcional) ───────────────────────────────────────────────
alter table public.obra_trecho
  add column if not exists geometry_geojson        jsonb,
  add column if not exists geometry_bounds         jsonb,
  add column if not exists geometry_comprimento_m  numeric(14, 2),
  add column if not exists geometry_sentido        text not null default 'natural',
  add column if not exists geometry_importado_em   timestamptz;

do $$ begin
  alter table public.obra_trecho add constraint chk_obra_trecho_sentido
    check (geometry_sentido in ('natural', 'invertido'));
exception when duplicate_object then null; end $$;

-- ─── Sistema de unidades de referencia ─────────────────────────────────
-- Enum estende com 'custom'. Quando custom: label + divisor obrigatorios.
-- marcador_valor_inicial e o valor da unidade no inicio da polilinha
-- (ex: trecho que comeca no km 5 → valor_inicial = 5).
alter table public.obra_trecho
  add column if not exists unidade_custom_label     text,
  add column if not exists unidade_custom_divisor_m numeric(10, 3),
  add column if not exists marcador_valor_inicial   numeric(10, 3) not null default 0;

-- Drop CHECK antiga e recria com 'custom' (idempotente).
alter table public.obra_trecho drop constraint if exists chk_obra_trecho_unidade;
do $$ begin
  alter table public.obra_trecho add constraint chk_obra_trecho_unidade
    check (unidade_espaco_padrao in ('km', 'm', 'estaca', 'custom'));
exception when duplicate_object then null; end $$;

-- Integridade do custom: se enum = 'custom', label + divisor sao obrigatorios.
do $$ begin
  alter table public.obra_trecho add constraint chk_obra_trecho_custom_coerencia
    check (
      (unidade_espaco_padrao <> 'custom')
      or (
        unidade_custom_label is not null
        and length(trim(unidade_custom_label)) > 0
        and unidade_custom_divisor_m is not null
        and unidade_custom_divisor_m > 0
      )
    );
exception when duplicate_object then null; end $$;
