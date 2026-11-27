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
| A. Vínculos | Obra ↔ projeto; de-para de serviço, equipe, encarregado e local; tela e ferramenta do MCP | feita (migração 0071) |
| B. Carga do desktop | `scripts/importar-do-desktop.mjs` traz uma obra do InfraWork desktop | feita (6.508 no local) |
| C. Leitura | Produção do SIGA copiada para o InfraWork a cada 10 minutos | feita (migração 0071) |
| D. Usuários | Apontador entra no app com o usuário do SIGA; usuário do web ligado ao do SIGA | a fazer |
| E. Gravação | Fila de saída que grava no SIGA o que é lançado no web e no app | a fazer |
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

Regras que valem para as próximas fases:

- **O SIGA é a verdade.** Em conflito, vale o que está lá.
- **A escrita segue o diagnóstico.** O conector só preenche as colunas que o Monito preenche, e começa numa base de
  homologação. O Monito é a referência de como gravar, não um app que a Tecpav vá continuar usando.
- **De-para obrigatório.** Para gravar é preciso o código do SIGA do serviço, da equipe e do encarregado.

### Função `siga`

`POST /functions/v1/siga`, com `acao`:

- `conectar` (`host`, `porta`, `banco`, `usuario`, `senha`): god ou adm. Testa a conexão, confere que o banco tem
  `pnj_controle_producao` e guarda a credencial no Vault. Endereço de rede interna é recusado.
- `desconectar`: apaga a credencial.
- `projetos`, `cadastros`, `sincronizar` (com `obra_id`): quem planeja a obra. Lista os projetos, os cadastros do
  projeto (com quantos lançamentos usam cada um) e lê a produção agora. Sem `obra_id` e com a chave de serviço
  (o `pg_cron`, a cada 10 minutos), `sincronizar` percorre todas as obras vinculadas.
- `diagnostico`: só o god. Lê, sem gravar nada, as tabelas `pnj_*` e `cdt_*`, as colunas, as chaves estrangeiras,
  os gatilhos, as permissões do usuário e como as últimas linhas estão preenchidas. O resultado fica em
  `integracao_execucao.resumo` e pode ser baixado na tela.

A empresa precisa ter a capacidade `integracao_siga`. No ambiente local, o MySQL de teste fica na rede do Docker
(`SIGA_PERMITIR_REDE_LOCAL=1` libera endereços internos, se for preciso).
