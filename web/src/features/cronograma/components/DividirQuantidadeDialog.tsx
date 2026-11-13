/**
 * Dividir por quantidade ("Split by quantity" do ApeX): a parte informada de cada local vai para uma tarefa nova com
 * as mesmas faixas; as duas partes viram manuais. Locais "do template" não se dividem assim (use por estaca).
 */
import { useMemo, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CalculoCronograma } from '../hooks/calculo'
import { traduzirErro, useDividirQuantidade } from '../hooks/edicao'
import type { TarefaEntrada } from '../motor/tipos'
import { fmtEstacaCompacta, fmtNum } from '../visoes/formato'
import { lerNumero } from './campos-util'

interface Props {
  calc: CalculoCronograma
  tarefaId: string | null
  onFechar: () => void
}

export function DividirQuantidadeDialog({ calc, tarefaId, onFechar }: Props): ReactNode {
  const t = tarefaId ? calc.entrada?.tarefas.find((x) => x.id === tarefaId) : undefined
  return (
    <Dialog open={!!t} onOpenChange={(o) => !o && onFechar()} size="lg">
      {t && calc.entrada ? <Conteudo key={t.id} calc={calc} t={t} onFechar={onFechar} /> : null}
    </Dialog>
  )
}

function Conteudo({
  calc,
  t,
  onFechar
}: {
  calc: CalculoCronograma
  t: TarefaEntrada
  onFechar: () => void
}): ReactNode {
  const e = calc.entrada!
  const dividir = useDividirQuantidade()
  const trechos = useMemo(() => new Map(e.trechos.map((x) => [x.id, x])), [e.trechos])
  const unidade = (t.servico_id && e.servicos.find((s) => s.id === t.servico_id)?.unidade) || ''
  const locais = [...t.locais].sort((a, b) => a.ordem - b.ordem)
  const linhas = locais.length
    ? locais.map((l) => ({
        local_id: l.id as string | null,
        rotulo: l.trecho_id
          ? (() => {
              const tr = trechos.get(l.trecho_id)!
              return tr.tipo === 'area'
                ? `Área ${tr.nome}`
                : `${tr.nome} · ${fmtEstacaCompacta(l.inicio_m ?? 0, tr)} – ${fmtEstacaCompacta(l.fim_m ?? 0, tr)}`
            })()
          : 'Sem local',
        quantidade: l.quantidade,
        manual: l.qtd_origem === 'manual'
      }))
    : [{ local_id: null, rotulo: 'Tarefa sem locais', quantidade: t.quantidade, manual: true }]
  const [partes, setPartes] = useState<string[]>(() =>
    linhas.map((l) => (l.manual && l.quantidade > 0 ? fmtNum(l.quantidade / 2, 'auto') : ''))
  )
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const executar = async (): Promise<void> => {
    setErro(null)
    const out: { local_id: string | null; quantidade: number }[] = []
    let fica = 0
    for (const [i, l] of linhas.entries()) {
      const v = partes[i]?.trim() ? lerNumero(partes[i]!) : 0
      if (v === null || v < 0) return setErro(`${l.rotulo}: quantidade inválida.`)
      if (v > l.quantidade + 1e-9)
        return setErro(`${l.rotulo}: a parte não pode passar de ${fmtNum(l.quantidade, 'auto')}.`)
      if (!l.manual && v > 0) return setErro(`${l.rotulo}: local com quantidades da planilha; divida por estaca.`)
      fica += l.quantidade - v
      if (v > 0) out.push({ local_id: l.local_id, quantidade: v })
    }
    if (!out.length) return setErro('Informe a quantidade que vai para a tarefa nova.')
    if (!(fica > 1e-9)) return setErro('A tarefa original precisa ficar com alguma quantidade.')
    setSalvando(true)
    try {
      await dividir.mutateAsync({ planejamentoId: e.plano.id, tarefaId: t.id, partes: out })
      onFechar()
    } catch (x) {
      setErro(traduzirErro(x instanceof Error ? x.message : String(x)))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Dividir por quantidade: {t.nome}</DialogTitle>
        <DialogDescription>
          Informe quanto de cada local vai para a tarefa nova; ela fica com as mesmas faixas e as
          duas partes passam a ser manuais.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={erro} />
        <table className="w-full text-xs">
          <thead className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
            <tr>
              <th className="px-2 py-1 text-left">Local</th>
              <th className="px-2 py-1 text-right">Quantidade</th>
              <th className="px-2 py-1 text-right w-36">Para a nova</th>
              <th className="px-2 py-1 text-right">Fica</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => {
              const v = partes[i]?.trim() ? (lerNumero(partes[i]!) ?? 0) : 0
              return (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1 text-text">
                    {l.rotulo}
                    {!l.manual ? (
                      <span className="ml-2 rounded bg-bg-elevated px-1 text-2xs text-text-muted">
                        do template
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-text-muted">
                    {fmtNum(l.quantidade, 'auto')} {unidade}
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      value={partes[i] ?? ''}
                      disabled={!l.manual}
                      inputMode="decimal"
                      className="h-6 text-right"
                      onChange={(x) =>
                        setPartes(partes.map((p, j) => (j === i ? x.target.value : p)))
                      }
                      title={l.manual ? undefined : 'Local do template: divida por estaca'}
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {fmtNum(Math.max(0, l.quantidade - v), 'auto')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onFechar} disabled={salvando}>
          Cancelar
        </Button>
        <Button onClick={() => void executar()} disabled={salvando}>
          {salvando ? 'Dividindo…' : 'Dividir'}
        </Button>
      </DialogFooter>
    </>
  )
}
