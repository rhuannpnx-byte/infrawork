# Leva UMA obra do banco local para o de produção, depois de montada e conferida no local (por exemplo com
# scripts/importar-do-desktop.mjs). Seleciona as linhas da obra seguindo as chaves estrangeiras a partir de
# `obras`, gera um arquivo SQL (uma transação, sem gatilhos, que para se a obra já existir no destino) e, com
# --ensaio, prova o arquivo no próprio banco local: apaga as linhas, reaplica, compara tabela a tabela e desfaz.
#
#   python -I -X utf8 scripts/transferir-obra.py <obra_id> <pasta_saida> [--ensaio] [--troca <id local>=<id produção> ...]
#
# --troca: ids que mudam de um banco para o outro (usuário que criou, integração da empresa). O roteiro lista as
# referências para fora da obra em <pasta_saida>/referencias_externas.json: confira que cada uma existe no destino.
# Não vão: produção e fotos (vêm do SIGA ou do campo), alertas, execuções de integração e permissões de usuário.
# O arquivo só é aplicado em produção com autorização:
#   npx -y supabase@3.0.0 db query --remote --yes --workdir . -f <pasta_saida>/transferencia.sql
import json, os, subprocess, sys

OBRA = sys.argv[1]
SAIDA = sys.argv[2]
ENSAIO = '--ensaio' in sys.argv
TROCAS = dict(a.split('=', 1) for i, a in enumerate(sys.argv) if i > 0 and sys.argv[i - 1] == '--troca')
os.makedirs(SAIDA, exist_ok=True)

# Não vão: o que nasce em produção (produção e fotos vêm do SIGA; alertas e execuções são do ambiente) e o que é
# de usuário local.
FORA = {
    'acompanhamento_producao', 'acompanhamento_producao_material', 'acompanhamento_foto', 'acompanhamento_alerta',
    'integracao_execucao', 'obra_permissoes', 'orcamento_recalculo_pendente',
}
# Colunas zeradas no destino (estado da sincronização feita contra a cópia local do SIGA).
ZERAR = {'integracao_obra': ['ultimo_sync_em', 'ultimo_sync_ok', 'ultimo_sync_resumo', 'ultimo_sync_erro']}


def psql(entrada):
    r = subprocess.run(['docker', 'exec', '-i', 'supabase_db_infrawork-web', 'psql', '-U', 'postgres', '-At', '-F', '\t',
                        '-v', 'ON_ERROR_STOP=1', '-q'], input=entrada, capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-1500:])
    return r.stdout


SELECAO = """
set client_min_messages = warning;
create temp table _fk as
select c.conrelid::regclass::text as child, a.attname::text as child_col,
       c.confrelid::regclass::text as parent, af.attname::text as parent_col, pn.nspname::text as parent_schema
  from pg_constraint c
  join pg_class cc on cc.oid = c.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
  join pg_class pc on pc.oid = c.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
 where c.contype = 'f' and cn.nspname = 'public' and array_length(c.conkey, 1) = 1;
insert into _fk
select col.table_name, 'obra_id', 'obras', 'id', 'public'
  from information_schema.columns col
  join information_schema.tables t on t.table_schema = col.table_schema and t.table_name = col.table_name and t.table_type = 'BASE TABLE'
 where col.table_schema = 'public' and col.column_name = 'obra_id'
   and not exists (select 1 from _fk f where f.child = col.table_name and f.child_col = 'obra_id');
create temp table _feito(tabela text primary key, n int);
create temp table _sel_obras as select * from public.obras where id = '%(obra)s';
insert into _feito values ('obras', (select count(*) from _sel_obras));
do $$
declare r record; mudou boolean := true; volta int := 0; n_antes int; n_depois int;
begin
  while mudou and volta < 15 loop
    mudou := false; volta := volta + 1;
    for r in select f.child, string_agg(distinct format('x.%%I in (select %%I from %%I)', f.child_col, f.parent_col, '_sel_' || f.parent), ' or ') as cond
               from _fk f
              where f.parent_schema = 'public' and f.parent in (select tabela from _feito) and f.child <> f.parent and f.child <> 'obras'
              group by f.child loop
      select n into n_antes from _feito where tabela = r.child;
      execute format('create temp table _novo as select x.* from public.%%I x where %%s', r.child, r.cond);
      select count(*) into n_depois from _novo;
      if n_depois is distinct from coalesce(n_antes, 0) then
        mudou := true;
        execute format('drop table if exists %%I', '_sel_' || r.child);
        execute format('alter table _novo rename to %%I', '_sel_' || r.child);
        insert into _feito values (r.child, n_depois) on conflict (tabela) do update set n = excluded.n;
      else
        drop table _novo;
      end if;
    end loop;
  end loop;
  if mudou then raise exception 'a seleção não estabilizou'; end if;
end $$;
delete from _feito where n = 0;
"""

LISTA = SELECAO % {'obra': OBRA} + """
select 'T', tabela, n from _feito order by tabela;
-- referências para fora da seleção (precisam existir no destino)
do $$
declare r record; v jsonb;
begin
  create temp table _ext(child text, child_col text, parent text, parent_col text, valores jsonb);
  for r in select f.* from _fk f join _feito s on s.tabela = f.child
            where not (f.parent_schema = 'public' and f.parent in (select tabela from _feito)) loop
    execute format('select coalesce(jsonb_agg(distinct %%I), ''[]'') from %%I where %%I is not null', r.child_col, '_sel_' || r.child, r.child_col) into v;
    if jsonb_array_length(v) > 0 then
      insert into _ext values (r.child, r.child_col, case when r.parent_schema = 'public' then r.parent else r.parent end, r.parent_col, v);
    end if;
  end loop;
end $$;
select 'E', child, child_col, parent, parent_col, valores::text from _ext order by parent, child;
-- linhas de outra obra que entraram por engano
do $$
declare r record; n int;
begin
  for r in select s.tabela from _feito s join information_schema.columns c on c.table_schema = 'public' and c.table_name = s.tabela and c.column_name = 'obra_id' where s.tabela <> 'obras' loop
    execute format('select count(*) from %%I where obra_id is distinct from %%L', '_sel_' || r.tabela, '%(obra)s') into n;
    if n > 0 then raise exception 'tabela %% tem %% linhas de outra obra', r.tabela, n; end if;
  end loop;
end $$;
select 'C', table_name, string_agg(quote_ident(column_name), ',' order by ordinal_position)
  from information_schema.columns
 where table_schema = 'public' and is_generated <> 'ALWAYS' and coalesce(identity_generation, '') <> 'ALWAYS'
   and table_name in (select tabela from _feito) group by table_name;
""" % {'obra': OBRA}

tabelas, externas, colunas = {}, [], {}
for linha in psql(LISTA).splitlines():
    p = linha.split('\t')
    if p[0] == 'T':
        tabelas[p[1]] = int(p[2])
    elif p[0] == 'E':
        externas.append({'child': p[1], 'col': p[2], 'parent': p[3], 'parent_col': p[4], 'valores': json.loads(p[5])})
    elif p[0] == 'C':
        colunas[p[1]] = p[2]

vao = [t for t in sorted(tabelas) if t not in FORA]
print('tabelas da obra:', len(tabelas), '| vão:', len(vao), '| linhas:', sum(tabelas[t] for t in vao))
print('ficam de fora:', {t: tabelas[t] for t in tabelas if t in FORA})
for t in vao:
    print(f'  {t}: {tabelas[t]}')
ext_relevantes = [e for e in externas if e['child'] in vao]
json.dump(ext_relevantes, open(os.path.join(SAIDA, 'referencias_externas.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('referências para fora da seleção:')
for e in ext_relevantes:
    print(f"  {e['child']}.{e['col']} -> {e['parent']}.{e['parent_col']}: {len(e['valores'])} valor(es)")

# dados
# O texto JSON sai do Postgres e entra no arquivo como veio: passar pelo Python arredondaria números (11.0000 -> 11.0).
def zerar(t):
    cols = ZERAR.get(t, [])
    return " || '" + json.dumps({c: None for c in cols}) + "'::jsonb" if cols else ''


DADOS = SELECAO % {'obra': OBRA} + '\n'.join(
    f"select 'D', '{t}', count(*), coalesce(jsonb_agg(to_jsonb(x){zerar(t)}), '[]')::text from \"_sel_{t}\" x;" for t in vao)
linhas, contagem = {}, {}
for linha in psql(DADOS).splitlines():
    p = linha.split('\t', 3)
    if p[0] == 'D':
        contagem[p[1]] = int(p[2])
        linhas[p[1]] = p[3]

partes = ['begin;', 'set local session_replication_role = replica;',
          f"do $$ begin if exists (select 1 from public.obras where id = '{OBRA}') then raise exception 'a obra já existe no destino'; end if; end $$;"]
for t in vao:
    assert contagem[t] == tabelas[t], (t, contagem[t], tabelas[t])
    js = linhas[t]
    for de, para in TROCAS.items():
        js = js.replace(de, para)
    assert '$J$' not in js
    cols = colunas[t]
    partes.append(f"insert into public.{t} ({cols}) select {cols} from jsonb_populate_recordset(null::public.{t}, $J${js}$J$::jsonb);")
partes.append(f"do $$ declare n int; begin select count(*) into n from public.planejamento_tarefa t join public.planejamento p on p.id = t.planejamento_id where p.obra_id = '{OBRA}'; raise notice 'tarefas no destino: %', n; end $$;")
partes.append('commit;')
arquivo = os.path.join(SAIDA, 'transferencia.sql')
open(arquivo, 'w', encoding='utf-8', newline='\n').write('\n'.join(partes) + '\n')
print('arquivo:', arquivo, f'({os.path.getsize(arquivo) / 1e6:.2f} MB)')

if ENSAIO:
    # No local: retrato das tabelas, apaga as linhas da obra, reaplica o arquivo (sem as trocas) e compara. Desfaz no fim.
    retrato = "select coalesce(md5(string_agg(md5(to_jsonb(x)::text), '' order by md5(to_jsonb(x)::text))), '-') from public.{t} x"
    corpo = [p for p in partes if p.startswith('insert into')]
    for de, para in TROCAS.items():
        corpo = [p.replace(para, de) for p in corpo]
    passos = ['begin;', 'set local session_replication_role = replica;', 'create temp table _r(tabela text, antes text, depois text);']
    passos += [f"insert into _r(tabela, antes) select '{t}', ({retrato.format(t=t)});" for t in vao]
    sel = SELECAO % {'obra': OBRA}
    passos.append(sel.replace('set client_min_messages = warning;', ''))
    for t in vao:
        passos.append(f'delete from public.{t} x where to_jsonb(x) in (select to_jsonb(s) from "_sel_{t}" s);')
    passos.append(f"select 'A', count(*) from public.obras where id = '{OBRA}';")
    passos += corpo
    passos += [f"update _r set depois = ({retrato.format(t=t)}) where tabela = '{t}';" for t in vao]
    passos.append("select 'R', tabela, antes = depois from _r order by 1;")
    passos.append('rollback;')
    saida = psql('\n'.join(passos))
    apagada = [l for l in saida.splitlines() if l.startswith('A')]
    res = [l.split('\t') for l in saida.splitlines() if l.startswith('R')]
    dif = [r[1] for r in res if r[2] != 't']
    print('ensaio: obra apagada antes de reaplicar:', apagada, '| tabelas conferidas:', len(res), '| diferentes:', dif or 'nenhuma')
