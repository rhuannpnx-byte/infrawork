-- InfraWork — Planejamento: remove validação de soma do perfil semanal.
--
-- Motivação:
--   * O trigger `trg_ptps_validar_soma` (constraint trigger DEFERRABLE)
--     causava falhas frustrantes em cenários comuns:
--     - Race entre recálculos paralelos (já mitigado client-side via
--       serialização, mas a fricção continuava).
--     - Tarefa com `usa_perfil_customizado=true` cuja qtd_alocada foi
--       alterada (sem regenerar o perfil), e algum recálculo posterior
--       tentava shift do perfil antigo → soma divergia.
--     - Falhas em INSERT bloqueavam TODA a transação de recálculo, mesmo
--       que apenas uma tarefa estivesse fora de tolerância.
--
--   * A integridade da Curva-S não depende desse trigger:
--     - calcular-cronograma SEMPRE faz DELETE + INSERT idempotente.
--     - PRIMARY KEY (tarefa_id, semana_segunda) já previne duplicatas.
--     - A função recriadora gera perfil que soma == quantidade_alocada por
--       construção (`gerarPerfilSemanal`). Soma errada só aparece em estado
--       legado/customizado, que o próximo recálculo conserta.
--
-- Mantemos a função `fn_ptps_validar_soma` no banco (sem trigger ligado) caso
-- alguém queira reabilitar manualmente em ambiente de auditoria.

drop trigger if exists trg_ptps_validar_soma on public.planejamento_tarefa_perfil_semana;

comment on function public.fn_ptps_validar_soma() is 'Validação de soma do perfil semanal vs quantidade_alocada. Trigger desligado em 2026-05-30 — manter função apenas para auditoria ad-hoc.';
