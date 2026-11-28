import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErroConsulta, Vazio } from '@/components/ui/estado'
import { Secao } from '@/components/ui/secao'
import { Segmentado } from '@/components/ui/segmentado'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useAuthStore } from '@/stores/auth-store'
import { contar } from '@/lib/rotulos'
import {
  useFilaSiga,
  useGravacaoSigaAcao,
  type EnvioSiga,
  type ModoGravacaoSiga,
  type VinculoSiga
} from './hooks'

const MODOS: Array<{ valor: ModoGravacaoSiga; rotulo: string; titulo: string }> = [
  {
    valor: 'desligada',
    rotulo: 'Desligada',
    titulo: 'A produção é lançada no SIGA; o InfraWork só lê'
  },
  {
    valor: 'simulacao',
    rotulo: 'Simulação',
    titulo: 'O InfraWork aceita lançamento e mostra o que gravaria, sem gravar no SIGA'
  },
  {
    valor: 'ligada',
    rotulo: 'Ligada',
    titulo: 'O que é lançado, alterado ou excluído aqui é gravado no SIGA'
  }
]

const EXPLICA: Record<ModoGravacaoSiga, string> = {
  desligada:
    'A produção desta obra é lançada no SIGA. O InfraWork só lê: o web e o app de campo não aceitam lançamento de produção nesta obra.',
  simulacao:
    'O web e o app de campo aceitam lançamento nesta obra, mas nada é gravado no SIGA: a lista abaixo mostra o que seria gravado. O lançamento de teste fica só aqui, então exclua-o depois de conferir. O que veio do SIGA continua só de leitura.',
  ligada:
    'O que é lançado, alterado ou excluído nesta obra, no web e no app de campo, é gravado no SIGA com o nome do usuário de lá. Nada é apagado no SIGA: a exclusão vira uma marca.'
}

const ESTADO: Record<
  EnvioSiga['estado'],
  { rotulo: string; variante: 'default' | 'success' | 'warn' | 'danger' | 'accent' }
> = {
  pendente: { rotulo: 'A enviar', variante: 'warn' },
  enviado: { rotulo: 'Gravado no SIGA', variante: 'success' },
  simulado: { rotulo: 'Simulado', variante: 'accent' },
  erro: { rotulo: 'Não foi', variante: 'danger' },
  descartado: { rotulo: 'Descartado', variante: 'default' }
}

const dataHora = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
const CABECALHO =
  'border-b border-border bg-bg-elevated text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

/** O que foi (ou seria) gravado, em uma linha: os campos que mudaram ou os principais da linha nova. */
function resumoDoEnvio(e: EnvioSiga): string {
  const v = e.enviado
  if (!v) return ''
  if (v.excluir) return `marca como excluído, por ${String(v.excluidor_nome ?? '')}`
  if (v.mudou && typeof v.mudou === 'object') {
    const partes = Object.entries(v.mudou as Record<string, [unknown, unknown]>).map(
      ([coluna, [antes, depois]]) => `${coluna}: ${String(antes ?? '—')} → ${String(depois ?? '—')}`
    )
    return partes.length > 0 ? partes.join('; ') : 'nada mudou em relação ao SIGA'
  }
  const partes = [
    v.servico_executado_qtd != null
      ? `${String(v.servico_executado_qtd)} ${String(v.servico_executado_unidade_nome ?? '')}`.trim()
      : null,
    v.equipe_nome ? String(v.equipe_nome) : null,
    v.trecho_nome ? String(v.trecho_nome) : null,
    v.estaca ? String(v.estaca) : null,
    v.cadastrador_nome ? `por ${String(v.cadastrador_nome)}` : null
  ].filter(Boolean)
  return partes.join(' · ')
}

/** O modo de gravação da obra no SIGA e a fila do que foi, do que falta ir e do que falhou. */
export function GravacaoSiga({
  obraId,
  vinculo
}: {
  obraId: string
  vinculo: VinculoSiga
}): ReactNode {
  const role = useAuthStore((s) => s.profile?.role)
  const podeMudar = role === 'god' || role === 'adm'
  const acao = useGravacaoSigaAcao()
  const confirm = useConfirm()
  const fila = useFilaSiga(obraId, vinculo.gravacao !== 'desligada')
  const [aberto, setAberto] = useState<number | null>(null)

  const mudarModo = async (modo: ModoGravacaoSiga): Promise<void> => {
    if (modo === vinculo.gravacao) return
    if (modo === 'ligada') {
      const ok = await confirm({
        title: 'Ligar a gravação no SIGA?',
        description:
          'A partir de agora, o que for lançado, alterado ou excluído nesta obra, no web e no app de campo, é gravado no SIGA de produção. Confira antes, em simulação, que a linha simulada está como a de um lançamento feito no SIGA.',
        confirmLabel: 'Ligar a gravação'
      })
      if (!ok) return
    }
    acao.mutate(
      { acao: 'modo', obra_id: obraId, modo },
      {
        onSuccess: () =>
          toast.success(
            modo === 'ligada'
              ? 'Gravação no SIGA ligada.'
              : modo === 'simulacao'
                ? 'Obra em simulação: nada é gravado no SIGA.'
                : 'Gravação no SIGA desligada.'
          ),
        onError: (e) => toast.error(e.message)
      }
    )
  }

  const pedir = (a: Parameters<typeof acao.mutate>[0], feito: string): void =>
    acao.mutate(a, {
      onSuccess: (r) => {
        const s = r.resumo
        toast.success(
          s
            ? s.erros > 0
              ? `${contar(s.erros, 'envio não foi', 'envios não foram')}. Veja o motivo na lista.`
              : s.enviados + s.simulados > 0
                ? `${contar(s.enviados + s.simulados, 'envio processado', 'envios processados')}.`
                : 'Nada a enviar.'
            : feito
        )
      },
      onError: (e) => toast.error(e.message)
    })

  const envios = fila.data ?? []
  const aEnviar = envios.filter((e) => e.estado === 'pendente').length
  const comErro = envios.filter((e) => e.estado === 'erro').length

  return (
    <Secao
      titulo="Gravação no SIGA"
      nota={
        vinculo.gravacao === 'desligada'
          ? undefined
          : aEnviar + comErro > 0
            ? [
                aEnviar > 0 ? contar(aEnviar, 'envio na fila', 'envios na fila') : null,
                comErro > 0 ? contar(comErro, 'envio com falha', 'envios com falha') : null
              ]
                .filter(Boolean)
                .join(', ')
            : 'Nada a enviar.'
      }
      acoes={
        vinculo.gravacao !== 'desligada' ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={acao.isPending}
            onClick={() => pedir({ acao: 'enviar', obra_id: obraId }, 'Envio pedido.')}
          >
            <RefreshCw size={13} aria-hidden />
            Enviar agora
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmentado
            rotulo="Gravação no SIGA"
            valor={vinculo.gravacao}
            opcoes={MODOS.map((m) => ({
              ...m,
              desabilitado: !podeMudar || acao.isPending
            }))}
            aoMudar={(m) => void mudarModo(m)}
          />
          {!podeMudar ? (
            <span className="text-xs text-text-dim">
              Só o administrador da empresa muda a gravação.
            </span>
          ) : null}
        </div>
        <p className="max-w-3xl text-sm text-text-muted" data-testid="siga-gravacao-explica">
          {EXPLICA[vinculo.gravacao]}
        </p>

        {vinculo.gravacao === 'desligada' ? null : fila.error ? (
          <ErroConsulta
            erro={fila.error}
            oQue="a fila de envios"
            aoTentar={() => void fila.refetch()}
          />
        ) : envios.length === 0 ? (
          <Vazio>Nenhum envio ainda. O que for lançado nesta obra aparece aqui.</Vazio>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm" data-testid="siga-fila">
              <thead>
                <tr className={CABECALHO}>
                  <th className="px-3 py-2 text-left">Quando</th>
                  <th className="px-3 py-2 text-left">Lançamento</th>
                  <th className="px-3 py-2 text-left">O que vai para o SIGA</th>
                  <th className="px-3 py-2 text-left">Situação</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {envios.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-b-0 align-top">
                    <td className="tabular whitespace-nowrap px-3 py-2 text-text-muted">
                      {dataHora(e.processado_em ?? e.created_at)}
                    </td>
                    <td className="px-3 py-2 text-text">
                      {e.operacao === 'excluir' ? 'Exclusão: ' : ''}
                      {e.rotulo ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {e.estado === 'erro' ? (
                        <span className="text-danger">{e.erro}</span>
                      ) : (
                        resumoDoEnvio(e) || '—'
                      )}
                      {e.enviado ? (
                        <>
                          {' '}
                          <button
                            type="button"
                            className="text-xs text-accent underline-offset-2 hover:underline"
                            aria-expanded={aberto === e.id}
                            onClick={() => setAberto(aberto === e.id ? null : e.id)}
                          >
                            {aberto === e.id ? 'ocultar a linha' : 'ver a linha inteira'}
                          </button>
                          {aberto === e.id ? (
                            <pre className="mt-2 max-w-xl overflow-x-auto rounded-md border border-border bg-bg-elevated p-2 text-2xs text-text-muted">
                              {JSON.stringify(e.enviado, null, 2)}
                            </pre>
                          ) : null}
                        </>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Badge variant={ESTADO[e.estado].variante}>{ESTADO[e.estado].rotulo}</Badge>
                      {e.estado === 'erro' && e.tentativas > 1 ? (
                        <span className="ml-1.5 text-2xs text-text-dim">
                          {contar(e.tentativas, 'tentativa', 'tentativas')}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {e.estado === 'erro' ? (
                        <span className="inline-flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Tentar de novo"
                            aria-label={`Tentar de novo o envio de ${e.rotulo ?? 'lançamento'}`}
                            disabled={acao.isPending}
                            onClick={() =>
                              pedir(
                                { acao: 'reenviar', obra_id: obraId, id: e.id },
                                'Envio pedido.'
                              )
                            }
                          >
                            <RotateCcw size={13} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-danger hover:bg-danger/10 hover:text-danger"
                            title="Desistir deste envio"
                            aria-label={`Desistir do envio de ${e.rotulo ?? 'lançamento'}`}
                            disabled={acao.isPending}
                            onClick={async () => {
                              const ok = await confirm({
                                title: 'Desistir deste envio?',
                                description:
                                  'O SIGA é a verdade. O lançamento que nunca chegou ao SIGA é excluído do InfraWork; o que já existe lá volta, na próxima leitura, a ser o que está lá.',
                                confirmLabel: 'Desistir do envio',
                                variant: 'danger'
                              })
                              if (ok)
                                pedir(
                                  { acao: 'descartar', obra_id: obraId, id: e.id },
                                  'Envio descartado.'
                                )
                            }}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Secao>
  )
}
