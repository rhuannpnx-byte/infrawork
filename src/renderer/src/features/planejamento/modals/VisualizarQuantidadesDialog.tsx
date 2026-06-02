// Dialog read-only de visualização de uma versão de quantidades.
//
// Mostra: header com nome do template + numero da versão + comentário + autor,
// tabela com segmentos × colunas, footer com totais por coluna.
//
// Versão atual ★ permite ações; versões históricas só leitura.

import { type ReactNode } from 'react'
import { Download } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useVersaoTemplate, useBaixarExcelVersao } from '@/features/planejamento/hooks/quantidades'
import type { ObraTrecho } from '@/types/gerencial'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  versaoId: string | null
  trecho: ObraTrecho
  empresaNome: string
  obraCodigo: string
  obraNome: string
  /** Nome do template (cabeçalho — não vem na query da versão). */
  templateNome: string
}

export function VisualizarQuantidadesDialog({
  open,
  onOpenChange,
  versaoId,
  trecho,
  empresaNome,
  obraCodigo,
  obraNome,
  templateNome
}: Props): ReactNode {
  const { data: versao } = useVersaoTemplate(versaoId)
  const baixar = useBaixarExcelVersao()

  if (!versaoId) return null

  // Totais por coluna
  const totais = new Map<string, number>()
  if (versao) {
    for (const seg of versao.segmentos) {
      for (const c of versao.colunas) {
        const v = seg.valores[c.id]
        if (v != null) totais.set(c.id, (totais.get(c.id) ?? 0) + v)
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      disableDismiss={baixar.isPending}
    >
      <DialogHeader>
        <DialogTitle>
          {templateNome}
          {versao ? (
            <span className="ml-2 text-2xs font-mono text-text-dim">
              Versão v{versao.numero}
              {versao.is_atual ? ' ★ atual' : ' (histórica)'}
              {versao.comentario ? ` · "${versao.comentario}"` : ''}
            </span>
          ) : null}
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        {!versao ? (
          <div className="text-text-dim text-xs">Carregando…</div>
        ) : versao.segmentos.length === 0 || versao.colunas.length === 0 ? (
          <div className="text-text-dim text-xs italic">
            Esta versão ainda não tem dados. Importe um Excel pra preencher.
          </div>
        ) : (
          <div className="max-h-[420px] overflow-auto rounded border border-border">
            <table className="w-full text-xs font-mono">
              <thead className="sticky top-0 bg-bg-panel">
                <tr className="border-b border-border text-2xs uppercase text-text-dim">
                  <th className="text-right px-2 py-1.5 w-20">Início (m)</th>
                  <th className="text-right px-2 py-1.5 w-20">Fim (m)</th>
                  <th className="text-center px-2 py-1.5 w-24">Unid Inicial</th>
                  <th className="text-center px-2 py-1.5 w-24">Unid Final</th>
                  {versao.colunas.map((c) => (
                    <th key={c.id} className="text-right px-2 py-1.5">
                      {c.nome}
                      <div className="text-text-dim normal-case">({c.unidade})</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {versao.segmentos.map((seg, idx) => (
                  <tr
                    key={seg.id}
                    className={`border-b border-border/40 ${
                      idx % 2 === 0 ? 'bg-bg' : 'bg-bg-panel/50'
                    }`}
                  >
                    <td className="px-2 py-1 text-right tabular-nums">
                      {seg.posicao_inicio_m.toFixed(2)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {seg.posicao_fim_m.toFixed(2)}
                    </td>
                    <td className="px-2 py-1 text-center text-text-muted">
                      {seg.unidade_inicio_label ?? '—'}
                    </td>
                    <td className="px-2 py-1 text-center text-text-muted">
                      {seg.unidade_fim_label ?? '—'}
                    </td>
                    {versao.colunas.map((c) => (
                      <td key={c.id} className="px-2 py-1 text-right tabular-nums">
                        {seg.valores[c.id] != null
                          ? Number(seg.valores[c.id]).toLocaleString('pt-BR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 3
                            })
                          : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-bg-panel">
                <tr className="border-t-2 border-border font-bold">
                  <td colSpan={4} className="px-2 py-1.5 text-right uppercase text-2xs">
                    Totais
                  </td>
                  {versao.colunas.map((c) => {
                    const t = totais.get(c.id)
                    return (
                      <td key={c.id} className="px-2 py-1.5 text-right tabular-nums">
                        {t != null
                          ? t.toLocaleString('pt-BR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 3
                            })
                          : '—'}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (!versaoId) return
            try {
              await baixar.mutateAsync({
                versao_id: versaoId,
                trecho,
                empresaNome,
                obraCodigo,
                obraNome
              })
            } catch (e) {
              // toast handled silenciosamente — UI mostra spinner mas erro só no console
              console.error('Falha ao baixar Excel:', e)
            }
          }}
          disabled={baixar.isPending}
        >
          <Download size={11} /> {baixar.isPending ? 'Gerando…' : 'Baixar Excel'}
        </Button>
        <div className="flex-1" />
        <Button variant="default" size="sm" onClick={() => onOpenChange(false)}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
