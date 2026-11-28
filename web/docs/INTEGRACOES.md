# Empresas com soluções diferentes: modelo único, conectores e capacidades

O InfraWork Web e o app de campo atendem todas as empresas com o mesmo código, o mesmo banco e a mesma publicação.
O que muda de uma empresa para outra é configuração, nunca uma versão própria.

## As três regras

1. **Um modelo só.** O banco do InfraWork é o modelo do sistema. Toda tela, view, função, alerta e ferramenta do
   MCP lê e grava nele. Nenhuma tela fala com sistema externo.
2. **Conector por empresa.** Quando a fonte de um dado é outro sistema, um conector no servidor (Edge Function)
   traz o dado para o nosso modelo e leva de volta o que é lançado aqui. Só o conector conhece o sistema externo.
3. **Capacidades por empresa.** O que está ligado para cada empresa (um módulo, uma regra, um conector) é uma
   capacidade registrada. Não existe `se a empresa for X` no código.

Um pedido de cliente cai sempre em um destes lugares:

| O pedido é… | Vai para… |
|---|---|
| ligar, desligar ou parametrizar um comportamento | uma capacidade |
| usar dado que mora em outro sistema | um conector |
| uma tela ou relatório só dele | um módulo atrás de uma capacidade |

## Capacidades

- Catálogo: `src/config/capacidades.ts` (chave, rótulo, descrição e o padrão de quem não tem configuração).
- Banco: `empresa_capacidade` guarda só o que foge do padrão. A empresa lê as suas; só o god altera.
- No banco e nas Edge Functions: `empresa_tem(empresa, chave, padrão)` (o padrão é o mesmo do catálogo).
- Na tela: `useCapacidades(empresaId)` (`src/features/integracoes/hooks.ts`).
- Onde se altera: **Gerencial › Integrações**, seção "Habilitado para a empresa" (só o god vê).

Capacidade nova: uma entrada no catálogo; se o banco precisa conferir, a chamada a `empresa_tem`.

## Conectores

- `integracao`: uma linha por empresa e tipo. `config` tem o que pode aparecer na tela; a credencial fica no Vault
  (`secret_id`, coluna que o usuário não lê).
- `integracao_execucao`: histórico de cada rodada (ação, quando, se deu certo, resumo, erro).
- Gravação só pelo servidor: `integracao_gravar`, `integracao_remover` e `integracao_segredo` são fechadas para o
  usuário. A Edge Function testa a conexão antes de guardar a credencial.
- A FleetHub nasceu antes dessas tabelas e continua nas dela (`fleethub_config`, `fleet_sync_execucao`).

## SIGA (Tecpav)

O SIGA é um MySQL que não podemos alterar. A produção e as fotos da empresa moram nele
(`pnj_controle_producao`, `pnj_foto`, cadastros `cdt_*`); orçamento, cronograma, equipes e viagens continuam no
InfraWork. O app de campo é o mesmo de todas as empresas: quem leva o lançamento ao SIGA é o conector.

| Etapa | O que entrega | Situação |
|---|---|---|
| Reconhecimento | Estrutura real das tabelas e como o Monito as preenche (`docs/siga/MAPEAMENTO.md`) | feito |
| Fundação | Capacidades, integrações, conexão e diagnóstico do SIGA | feita (migração 0070, função `siga`) |
| A. Vínculos | Obra ↔ projeto; de-para de serviço, equipe, encarregado e local; tela e ferramenta do MCP | em produção (migração 0071) |
| B. Carga do desktop | `scripts/importar-do-desktop.mjs` traz uma obra do InfraWork desktop para o local; `scripts/transferir-obra.py` leva a obra conferida para produção | feita (6.508 em produção desde 28/11/2026) |
| C. Leitura | Produção do SIGA copiada para o InfraWork a cada 10 minutos | em produção (migração 0071) |
| D. Usuários | Apontador entra no app com o usuário do SIGA; usuário do web ligado ao do SIGA | em produção (migração 0072, função `siga-login`) |
| E. Gravação | Fila de saída que grava no SIGA o que é lançado no web e no app | feita no local (migração 0073); em produção depende de autorização e do piloto na 6.508 |
| F. Fotos | Fotos do SIGA para cá e daqui para lá; alerta de falha | a fazer |

### Vínculos

- `integracao_obra`: a obra ligada a um projeto do SIGA, a data de corte e o modo de gravação (`desligada`,
  `simulacao`, `ligada`). Enquanto a gravação não está ligada, a obra não recebe lançamento feito aqui.
- `integracao_de_para`: serviço, equipe, encarregado e local do SIGA ↔ os do InfraWork, por obra. O serviço tem
  fator de conversão (quantidade aqui = quantidade do SIGA × fator) e pode ficar "fora do orçamento".
- A produção do SIGA entra em `acompanhamento_producao` com `origem = 'siga'`, `externo_id` e `externo` (o que
  veio em texto). Só `siga_aplicar_producao`, chamada pelo conector, grava essas linhas; o usuário não as
  altera nem exclui.
- Criar um de-para reaplica nos lançamentos que já vieram. O que está sem vínculo aparece em
  `vw_siga_pendencias` e na tela **Acompanhamento › Vínculo com o SIGA** (item de menu com `requer`).
- Funções do usuário: `siga_vincular_obra`, `siga_desvincular_obra`, `siga_de_para_salvar` (quem planeja a
  obra). No MCP: ferramenta `integracoes`.

### Usuários

O lançamento do SIGA guarda o **nome** de quem cadastrou, não um id. Para gravar lá, quem lança precisa ser um
usuário do SIGA (`integracao_usuario`: usuário do InfraWork ↔ id, login e nome de lá).

- **Apontador (`origem = 'login'`)**: entra no app de campo com o usuário e a senha do SIGA. A função
  `siga-login` acha o usuário no cadastro do SIGA, manda a senha para a tela de login do próprio SIGA (não
  reproduzimos o formato da senha nem a guardamos), cria a conta no primeiro acesso (papel apontador) e devolve
  uma sessão normal do InfraWork. As obras são as ligadas a um projeto que o SIGA libera para ele
  (`sys_usuario_tem_projeto`; apoio herda do chefe; quem não é apoio nem chefe vê todos), gravadas em
  `obra_permissoes` por `siga_usuario_permissoes`.
- **Engenheiro, apoio e adm (`origem = 'vinculo'`)**: continuam com a conta do InfraWork; o administrador liga a
  conta ao usuário do SIGA em **Gerencial › Usuários**. Essa conta não entra por `siga-login`.
- A rodada automática confere, a cada 10 minutos, quem continua ativo no SIGA e com quais projetos
  (`siga_usuarios_conferir`): o desligado perde as obras com a sessão aberta.
- Limite de entrada: 8 senhas erradas por usuário e 40 por origem em 15 minutos (`integracao_login_tentativa`).
- A conta de quem entra pelo SIGA tem um endereço interno (`siga-<id>@<empresa>.siga.infrawork-web.vercel.app`)
  e uma senha que ninguém conhece: ela só entra por `siga-login`.
- O endereço da tela de login é `https://<servidor da conexão>/action/action.php`; outro endereço vai em
  `integracao.config.login_url`. No ambiente local, `SIGA_LOGIN_URL` aponta para um login de teste.

### Gravação

Cada obra ligada ao SIGA tem um modo (`integracao_obra.gravacao`, mudado por `siga_gravacao_definir`, só god e
adm):

| Modo | O que acontece |
|---|---|
| `desligada` | Só leitura. A obra não recebe lançamento feito aqui (web, app e MCP recusam) |
| `simulacao` | A obra recebe lançamento, que fica só aqui; a fila guarda a linha que seria gravada. O que veio do SIGA continua só de leitura |
| `ligada` | Lançar, alterar e excluir aqui grava no SIGA, inclusive no lançamento que nasceu lá |

- **Fila de saída** (`integracao_saida`): o gatilho da produção põe um envio por lançamento mudado; o conector
  (`siga`, ação `enviar`) lê o lote (`siga_saida_lote`), grava e marca o resultado (`siga_saida_concluir`). O
  banco avisa o conector quando algo entra na fila (pg_net) e a rodada de 10 minutos envia o que sobrou.
- **Como grava** (igual ao Monito): `INSERT ... ON DUPLICATE KEY UPDATE` pela chave `app_uuid`, que leva o `id`
  do nosso lançamento, então repetir o envio não duplica. Código e nome vão juntos, lidos do cadastro do SIGA; a
  quantidade vai na unidade de lá (quantidade daqui ÷ fator do de-para); a estaca vai como `"45+390 - 46+429"`;
  `cadastrador_nome` é o nome do usuário do SIGA de quem lançou.
- **Lançamento que nasceu no SIGA**: alterado pelo número dele, e só nas colunas que mudaram (a fila guarda o
  antes e o depois). Texto da estaca, prioridade, material e quem cadastrou não são reescritos.
- **Exclusão**: `deletado = 'S'` com quem excluiu. Nada é apagado.
- **Quem pode**: o usuário precisa estar ligado a um usuário ativo do SIGA com o projeto da obra, e o serviço, a
  equipe, o encarregado e o local do lançamento precisam ter de-para. A recusa acontece na hora de lançar, com o
  motivo; o conector confere de novo no SIGA antes de gravar.
- **Vários cadastros do SIGA para um daqui**: vale o que o lançamento já tem lá; no lançamento novo, o marcado
  como principal.
- **Falha**: o lançamento fica aqui, o envio fica com o motivo e é tentado de novo (5 vezes; depois, só com
  "tentar de novo"). A leitura não passa por cima de um lançamento com envio pendente. Desistir do envio
  (`siga_saida_descartar`) devolve a verdade ao SIGA: o lançamento que nunca chegou lá é excluído daqui.
- A produção das viagens fica só no InfraWork.
- No app de campo, `campo_catalogo` diz o modo da obra e marca as equipes, os encarregados e os locais que têm
  de-para (`externa`): são os que a Produção oferece. Com a gravação desligada o app não lança produção na obra.

Regras que valem sempre:

- **O SIGA é a verdade.** Em conflito, vale o que está lá.
- **A escrita segue o Monito.** O conector só inclui e altera linhas de `pnj_controle_producao`, nunca apaga e
  nunca toca em cadastro. Não há base de homologação do SIGA: a gravação é provada numa cópia local e, em
  produção, em simulação e depois numa obra piloto.
- **De-para obrigatório.** Para gravar é preciso o código do SIGA do serviço, da equipe, do encarregado e do
  local.

### Função `siga`

`POST /functions/v1/siga`, com `acao`:

- `conectar` (`host`, `porta`, `banco`, `usuario`, `senha`): god ou adm. Testa a conexão, confere que o banco tem
  `pnj_controle_producao` e guarda a credencial no Vault. Endereço de rede interna é recusado.
- `desconectar`: apaga a credencial.
- `projetos`, `cadastros`, `sincronizar` (com `obra_id`): quem planeja a obra. Lista os projetos, os cadastros do
  projeto (com quantos lançamentos usam cada um) e lê a produção agora. Sem `obra_id` e com a chave de serviço
  (o `pg_cron`, a cada 10 minutos), `sincronizar` percorre todas as obras vinculadas.
- `enviar` (com `obra_id`): quem lança na obra. Processa a fila de saída da obra agora. Com a chave de serviço
  (o aviso da fila), envia o que está pendente em todas as empresas.
- `usuarios`, `vincular_usuario` (`user_id`, `externo_id` ou nulo para desfazer): god ou adm. O nome e o login
  gravados são os lidos do SIGA, não os que vêm da tela.
- `diagnostico`: só o god. Lê, sem gravar nada, as tabelas `pnj_*` e `cdt_*`, as colunas, as chaves estrangeiras,
  os gatilhos, as permissões do usuário e como as últimas linhas estão preenchidas. O resultado fica em
  `integracao_execucao.resumo` e pode ser baixado na tela.

A empresa precisa ter a capacidade `integracao_siga`. No ambiente local, o MySQL de teste fica na rede do Docker
(`SIGA_PERMITIR_REDE_LOCAL=1` libera endereços internos, se for preciso).
