-- InfraWork — Orçamento: gerador de código de item à prova de colisão.
--
-- Bug: fn_item_orc_codigo_gerar gerava o código do novo item raiz como
-- max(códigos-raiz numéricos)+1, mas a constraint é unique (obra_id, codigo)
-- GLOBAL. Orçamentos importados podem ter itens NÃO-raiz com códigos numéricos
-- planos (ex.: filhos "003".."010"); aí o código gerado p/ uma nova raiz
-- (ex.: "003") colide com um filho existente → erro 409 ao criar item raiz.
--
-- Correção: após calcular o próximo número, INCREMENTA até achar um código
-- livre na obra (considerando TODOS os itens, qualquer nível). Mesma proteção
-- no ramo de filhos.

create or replace function public.fn_item_orc_codigo_gerar()
returns trigger
language plpgsql
as $$
declare
  parent_codigo text;
  n             int;
  candidate     text;
begin
  if new.codigo is not null and trim(new.codigo) <> '' then
    return new;
  end if;

  -- Lock por obra para evitar duplicidade em corrida
  perform pg_advisory_xact_lock(hashtext('item_orc:' || new.obra_id::text));

  if new.parent_id is null then
    -- Raiz: próximo numérico, pulando códigos já usados em QUALQUER nível.
    select coalesce(max((codigo)::int), 0) into n
      from public.item_orcamentario
     where obra_id = new.obra_id
       and parent_id is null
       and codigo ~ '^[0-9]+$';
    n := n + 1;
    loop
      candidate := lpad(n::text, 3, '0');
      exit when not exists (
        select 1 from public.item_orcamentario
         where obra_id = new.obra_id and codigo = candidate
      );
      n := n + 1;
    end loop;
    new.codigo := candidate;
  else
    select codigo into parent_codigo
      from public.item_orcamentario where id = new.parent_id;
    select coalesce(max(
             nullif(substring(codigo from length(parent_codigo) + 2), '')::int
           ), 0) into n
      from public.item_orcamentario
     where obra_id = new.obra_id
       and parent_id = new.parent_id
       and codigo ~ ('^' || regexp_replace(parent_codigo, '\.', '\\.', 'g') || '\.[0-9]+$');
    n := n + 1;
    loop
      candidate := parent_codigo || '.' || lpad(n::text, 2, '0');
      exit when not exists (
        select 1 from public.item_orcamentario
         where obra_id = new.obra_id and codigo = candidate
      );
      n := n + 1;
    end loop;
    new.codigo := candidate;
  end if;
  return new;
end
$$;
