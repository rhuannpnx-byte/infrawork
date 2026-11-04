-- ─────────────────────────────────────────────────────────────────────────
-- cpu.servico_id passa a ser nullable + ON DELETE SET NULL
-- ─────────────────────────────────────────────────────────────────────────
-- Contexto: até agora toda CPU tinha 1 servico-dono (FK NOT NULL RESTRICT).
-- A importação criava 1 servico por CPU automaticamente — o que enchia a
-- árvore de serviços de entradas técnicas (IMP-001, IMP-002...) que não
-- correspondem a itens orçamentários reais.
--
-- Nova arquitetura:
--   - CPU é uma entidade técnica autônoma (composição de custo unitário).
--   - Servico é um conceito orçamentário, que pode agregar N CPUs com fator
--     de conversão (via servico_cpu_link).
--   - Uma CPU PODE não ter servico-dono direto — é convertida em servico
--     via UI quando o usuário decide (promover ou vincular).
--
-- Mudanças:
--   1) cpu.servico_id passa de NOT NULL → nullable.
--   2) FK passa de ON DELETE RESTRICT → SET NULL (apagar servico não
--      bloqueia CPUs; só zera a referência).
--   3) Unique (servico_id, versao) é preservada — NULLs não conflitam em
--      Postgres por padrão. Múltiplas CPUs órfãs podem ter versao=1.
--   4) Trigger fn_cpu_demarcar_outras: tolerar servico_id=null (não tenta
--      demarcar outras quando não há servico).

alter table public.cpu
  drop constraint if exists cpu_servico_id_fkey;

alter table public.cpu
  alter column servico_id drop not null;

alter table public.cpu
  add constraint cpu_servico_id_fkey
  foreign key (servico_id) references public.servico(id)
  on delete set null;

-- Trigger de "demarcar outras vigentes" precisa tolerar servico_id null.
-- Função original em 20260523120200_orcamento_calc_triggers.sql.
create or replace function public.fn_cpu_demarcar_outras()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_vigente = true and new.servico_id is not null then
    update public.cpu
       set is_vigente = false
     where servico_id = new.servico_id
       and id <> new.id
       and is_vigente = true;
  end if;
  return new;
end
$$;
