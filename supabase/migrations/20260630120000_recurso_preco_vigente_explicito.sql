-- Preço vigente do recurso passa a ser EXPLÍCITO (flag is_vigente), não mais
-- derivado de datas. Motivo: quando duas linhas tinham vigência aberta (ou a
-- mesma data), ambas apareciam como "vigente" e preco_vigente_recurso() ficava
-- ambíguo. Além disso, o unique (recurso_id, vigencia_inicio) gerava erro de
-- duplicação ao registrar preços com a mesma data.
--
-- Agora:
--   - O histórico é ordenado pela data de inserção (created_at) — a vigência
--     vira metadata informativa.
--   - Exatamente UM preço por recurso pode ser is_vigente = true (índice único
--     parcial); o usuário escolhe explicitamente qual na UI.
--   - preco_vigente_recurso() retorna o preço marcado, de forma determinística.

-- 1) Flag explícita
alter table public.recurso_preco
  add column if not exists is_vigente boolean not null default false;

-- 2) Remove o unique que bloqueava preços com a mesma vigência (fonte do erro
--    de duplicação). Mantém o índice de apoio idx_recurso_preco_recurso.
alter table public.recurso_preco
  drop constraint if exists recurso_preco_recurso_id_vigencia_inicio_key;

-- 3) No máximo um vigente por recurso
create unique index if not exists uq_recurso_preco_vigente
  on public.recurso_preco (recurso_id) where is_vigente;

-- 4) Índice para ordenar o histórico por data de inserção
create index if not exists idx_recurso_preco_created
  on public.recurso_preco (recurso_id, created_at desc);

-- 5) Backfill: marca como vigente o preço que a lógica antiga escolheria —
--    prioriza vigência aberta, depois maior vigencia_inicio, depois mais
--    recente por created_at. Um por recurso. Idempotente: só atua em recursos
--    que ainda NÃO têm nenhum vigente (re-rodar não conflita com o unique).
with sem_vig as (
  select recurso_id
    from public.recurso_preco
   group by recurso_id
  having bool_or(is_vigente) = false
),
ranked as (
  select rp.id,
         row_number() over (
           partition by rp.recurso_id
           order by (rp.vigencia_fim is null) desc, rp.vigencia_inicio desc, rp.created_at desc
         ) as rn
    from public.recurso_preco rp
    join sem_vig s on s.recurso_id = rp.recurso_id
)
update public.recurso_preco rp
   set is_vigente = true
  from ranked
 where ranked.id = rp.id
   and ranked.rn = 1;

-- 6) preco_vigente_recurso() passa a usar a flag (determinístico). Mantém a
--    assinatura (_data fica ignorado) para não quebrar chamadas existentes.
create or replace function public.preco_vigente_recurso(
  _recurso_id uuid,
  _data       date default current_date
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select custo_unitario
    from public.recurso_preco
   where recurso_id = _recurso_id
     and is_vigente = true
   limit 1
$$;

-- 7) RPC para o usuário marcar qual preço está vigente (atômico: zera os demais
--    do recurso e marca o escolhido). Respeita o escopo de empresa/role.
create or replace function public.set_recurso_preco_vigente(_preco_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _recurso uuid;
begin
  select recurso_id into _recurso from public.recurso_preco where id = _preco_id;
  if _recurso is null then
    raise exception 'Preço não encontrado';
  end if;

  if not (
    public.auth_role() = 'god'
    or (public.auth_role() in ('adm', 'engenheiro')
        and public.recurso_empresa(_recurso) = public.auth_empresa_id())
  ) then
    raise exception 'Sem permissão para alterar o preço vigente';
  end if;

  update public.recurso_preco
     set is_vigente = false
   where recurso_id = _recurso and is_vigente = true and id <> _preco_id;

  update public.recurso_preco
     set is_vigente = true
   where id = _preco_id;
end
$$;

grant execute on function public.set_recurso_preco_vigente(uuid) to authenticated;
