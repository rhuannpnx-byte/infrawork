-- ─────────────────────────────────────────────────────────────────────────
-- cpu.nome: nome próprio da CPU (desacopla de servico-dono)
-- ─────────────────────────────────────────────────────────────────────────
-- Contexto: até agora a CPU não tinha nome próprio — quem dava nome era o
-- servico-dono (via FK cpu.servico_id). Isso amarrava criação de CPU à
-- criação de servico. Com cpu.servico_id virando opcional, precisamos de um
-- nome próprio pra identificar a CPU.
--
-- Backfill em ordem de prioridade:
--   1) Se a CPU tem servico-dono → copia servico.nome (com codigo prefixado).
--   2) Senão, tenta extrair "nome original: \"...\"" de cpu.notas (formato
--      novo da importação).
--   3) Senão, tenta extrair "Importada de X" de cpu.notas (formato antigo).
--   4) Senão, fica NULL — frontend mostra fallback "CPU {id-prefix}".

alter table public.cpu
  add column if not exists nome text;

comment on column public.cpu.nome is
  'Nome legível da CPU, independente do servico-dono. NULL = sem nome explícito (UI usa fallback).';

create index if not exists idx_cpu_obra_nome on public.cpu(obra_id, nome);

-- ─── Backfill ────────────────────────────────────────────────────────────
-- 1) CPUs com servico-dono: copia servico.nome.
update public.cpu c
   set nome = s.nome
  from public.servico s
 where c.nome is null
   and c.servico_id = s.id
   and s.nome is not null;

-- 2) CPUs órfãs com `nome original: "X"` nas notas (importação nova).
update public.cpu
   set nome = substring(notas from 'nome original:\s*"([^"]+)"')
 where nome is null
   and notas ~ 'nome original:\s*"[^"]+"';

-- 3) CPUs órfãs com `Importada de X` nas notas (importação antiga).
--    Captura até " —", "(", ou fim da string.
update public.cpu
   set nome = trim(substring(notas from '^Importada de\s+([^—(]+?)(?:\s*[—(]|$)'))
 where nome is null
   and notas ~ '^Importada de\s+';
