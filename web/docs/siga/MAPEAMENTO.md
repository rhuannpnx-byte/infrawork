# SIGA: mapeamento das tabelas e regras do conector

Fonte: a leitura da estrutura feita pela conexão da Tecpav em 27/11/2026 (guardada em
`integracao_execucao.resumo`) e o código do Monito Mobile, que é quem grava nessas tabelas hoje. O SIGA é um
MySQL 5.7 (`sigaobras_producao`); não alteramos tabela nem cadastro dele. Não há gatilhos nas tabelas abaixo.

## Produção: `pnj_controle_producao`

Todas as colunas têm o prefixo `controle_producao_`. A linha guarda o código **e o nome** de cada cadastro.

| Coluna do SIGA | No InfraWork | Regra |
|---|---|---|
| `_id` | `acompanhamento_producao.externo_id` | chave do espelho, única por obra |
| `_app_uuid` (único) | o `id` do nosso lançamento, quando ele nasceu aqui | impede duplicar na gravação e reconhece a linha na volta |
| `_projeto_id` | `integracao_obra.externo_projeto_id` | o vínculo da obra |
| `_dt` | `data` | lida como texto, para o fuso não mudar o dia |
| `_servico_executado_id` | de-para `servico` → agrupador do orçamento | o nome vem de `cdt_servico_executado` |
| `_servico_executado_qtd` | `quantidade` | na unidade do SIGA; `fator_conversao` do de-para leva à unidade do plano |
| `_servico_executado_unidade_nome` | `unidade` | |
| `_equipe_id`, `_equipe_nome` | de-para `equipe` → `equipe_id` | sem vínculo, o nome fica em `externo.equipe` |
| `_encarregado_id`, `_encarregado_nome` | de-para `encarregado` → `encarregado_id` | idem |
| `_trecho_id`, `_trecho_nome` | de-para `local` → `trecho_id` | idem |
| `_estaca`, `_estaca_inicial`, `_estaca_final` | `estaca_inicial`, `estaca_final`, `posicao_inicio_m`, `posicao_fim_m` | texto livre; ver "Estaca" |
| `_material_nome`, `_material_qtd`, `_material_unidade_nome` | `acompanhamento_producao_material` | só quando o lançamento tem material |
| `_obs` | `obs` | |
| `_chuva` (`'S'`/`'N'`) | `externo.chuva` | |
| `_cadastrador_nome` | `externo.cadastrador` | é o **nome** do usuário do SIGA; não há id |
| `_deletado`, `_inativo` (`'S'`/`'N'`) | a linha sai do espelho | |
| `_servico_executado_prioridade` | não usado na leitura | o Monito grava sempre `'N'` |
| `_altura_media`, `_material_rede_*`, `_diametro_*`, `_tp_rede_*` | não usados | obras de rede |

O que ainda não tem vínculo não se perde: o lançamento entra com o nome que veio do SIGA (em `externo`) e
aparece em `vw_siga_pendencias`. Um serviço pode ser marcado como fora do orçamento (`ignorado`).

## Cadastros

| Tabela | Uso |
|---|---|
| `cdt_projeto` (`projeto_id`, `projeto_codigo`) | lista para vincular a obra; o nome das obras vem de `cdt_obra.obra_projeto_id` |
| `cdt_projeto_tem_servico_executado` | serviços do projeto |
| `cdt_servico_executado` | nome, unidade (`_unidade_id` → `cdt_unidade`) e material (`_material_id` → `cdt_material`) |
| `cdt_projeto_tem_equipe` (`_equipe_id`, `_encarregado_id`, `_producao`) | equipes do projeto e o encarregado de cada uma |
| `cdt_equipe`, `cdt_encarregado` | nomes |
| `cdt_projeto_tem_trecho` (`projeto_tem_trecho_id`, `projeto_tem_techo_trecho`) | trechos do projeto; "techo" é o nome real da coluna |

A tela de vínculo junta o cadastro do projeto com o que já apareceu em algum lançamento dele, porque o histórico
tem equipe e trecho que saíram do cadastro.

## Estaca

O texto é digitado à mão: `KM INICIAL 45+390 > KM FINAL 46+429`, `ESTACA INICIAL 38+800 > ESTACA FINAL 41+226`,
`INÍCIO > 68+798 | FINAL > 66+820`, ou só `178+220`. O conector (`_shared/siga-estaca.ts`) procura as posições
`N+M` e, com o local vinculado a um eixo, converte em metros internos pelo marcador inicial e pelo sentido do
eixo. Precisa de duas posições; com mais de duas (dois sentidos no mesmo texto), vale da menor à maior. O que
não dá para ler, ou cai fora do eixo, fica sem posição e com o texto original em `estaca_inicial`.

Na 6.508, 286 dos 1.080 lançamentos ganharam posição: boa parte dos textos traz km que não está no eixo
cadastrado do local.

## Usuários (para a gravação)

- `sys_usuario` (`usuario_id`, `usuario_login`, `usuario_nome`, `usuario_senha`, `usuario_inativo`,
  `usuario_deletado`). A senha tem formato próprio do SIGA: quem confere é a tela de login dele
  (`POST https://sigaobras.com.br/action/action.php`, `pacote=sys`, `modulo=login`,
  `metodo=AutenticarAcesso`, `login_login`, `login_senha`; `code === 1030` é sucesso).
- Projetos do usuário: `sys_usuario_tem_projeto`. Usuário de apoio herda os do chefe
  (`sys_usuario_tem_usuario.usuario_tem_usuario_chefe_equipe_id`); sem projeto nenhum, vê todos.

## Gravação

Como o Monito faz, e como o conector faz (`_shared/siga-saida.ts`):

- `INSERT ... ON DUPLICATE KEY UPDATE` pela chave `controle_producao_app_uuid`;
- nomes e códigos juntos, copiados do cadastro; `_cadastrador_nome` com o nome do usuário do SIGA;
- `_estaca` como `"inicial - final"` e os dois campos separados; `_prioridade` `'N'`; `_chuva` `'S'`/`'N'`;
- exclusão é `_deletado = 'S'` com `_excluidor_nome` e `_excluidor_dh`; nada é apagado;
- lançamento que nasceu no SIGA é alterado pelo `_id`, só nas colunas que mudaram aqui: data, quantidade,
  observação, serviço (com a unidade), equipe, encarregado, trecho (cada um com o nome), estaca (quando a posição
  foi mudada aqui) e quantidade de material. `_cadastrador_nome`, `_prioridade` e o texto da estaca que não
  mudou ficam como estão;
- diferente do Monito, a alteração também leva a data e o serviço, porque aqui eles podem ser editados;
- tamanhos respeitados: `_equipe_nome` 30, `_encarregado_nome` 50, `_unidade_nome` 60, `_cadastrador_nome` 100,
  quantidades com duas casas.

## Fotos: `pnj_foto`

`foto_app_uuid` (único), projeto, serviço, encarregado e equipe (código e nome), `foto_lat`, `foto_lng`,
`foto_accuracy`, `foto_captured_at`, `foto_mime`, `foto_size_bytes`, `foto_storage_bucket` (`monito-fotos`) e
`foto_storage_key` (`fotos/AAAA/MM/DD/<uuid>.jpg`). O arquivo fica no Storage do projeto Supabase do desktop,
não no do web. `foto_controle_producao_id` é sempre nulo: a foto não é ligada ao lançamento.
