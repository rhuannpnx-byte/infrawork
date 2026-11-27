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

| Fase | O que entrega | Situação |
|---|---|---|
| 0 | Reconhecimento: estrutura real das tabelas e como o Monito as preenche | pela tela, com a conexão feita |
| 1 | Fundação: capacidades, integrações, conexão e diagnóstico do SIGA | feita (migração 0070, função `siga`) |
| 2 | Leitura: produção e fotos do SIGA copiadas para o InfraWork, vínculo obra ↔ projeto e de-para | a fazer |
| 3 | Escrita: fila de saída que grava no SIGA o que é lançado no web e no app | a fazer |
| 4 | Fotos para o SIGA, alertas de falha, ferramenta do MCP e manual | a fazer |

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
- `diagnostico`: só o god. Lê, sem gravar nada, as tabelas `pnj_*` e `cdt_*`, as colunas, as chaves estrangeiras,
  os gatilhos, as permissões do usuário e como as últimas linhas estão preenchidas. O resultado fica em
  `integracao_execucao.resumo` e pode ser baixado na tela.

A empresa precisa ter a capacidade `integracao_siga`. No ambiente local, o MySQL de teste fica na rede do Docker
(`SIGA_PERMITIR_REDE_LOCAL=1` libera endereços internos, se for preciso).
