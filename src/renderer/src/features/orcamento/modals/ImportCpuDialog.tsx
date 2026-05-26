import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { adminApi } from '@/lib/supabase/functions'
import { formatNumber } from '@/lib/format'

type CpuItemGrupo = 'EQUIPAMENTO' | 'COMBUSTIVEL' | 'MO' | 'MATERIAL'

interface OrcamentoParsedCpuItem {
  grupo: CpuItemGrupo
  row_origem: number
  recurso_nome: string
  recurso_unidade: string | null
  quantidade: number | null
  horas_dia: number | null
  consumo_combustivel_lh: number | null
  indice_produtividade: number | null
  consumo_material_por_unid: number | null
}

interface OrcamentoParsedCpu {
  aba_nome: string
  servico_nome: string
  servico_unidade: string | null
  producao_diaria_qtde: number
  producao_diaria_unidade: string
  itens: OrcamentoParsedCpuItem[]
  incompleta: boolean
  warnings: string[]
}

interface OrcamentoParsedRecursoCatalogo {
  grupo: 'MO' | 'MVE' | 'COMBUSTIVEL' | 'MATERIAL' | 'ADM'
  nome: string
  unidade: string | null
  custo_unitario: number | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

type Step = 'upload' | 'preview' | 'aplicando' | 'resultado'

export function ImportCpuDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('upload')
  const [arquivoNome, setArquivoNome] = useState<string>('')
  const [cpus, setCpus] = useState<OrcamentoParsedCpu[]>([])
  const [recursosCatalogo, setRecursosCatalogo] = useState<OrcamentoParsedRecursoCatalogo[]>([])
  const [abasIgnoradas, setAbasIgnoradas] = useState<string[]>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{
    cpus_criadas: number
    servicos_criados: number
    recursos_criados: number
    precos_criados: number
    cpu_items_criados: number
    erros: string[]
    warnings: string[]
  } | null>(null)

  const reset = (): void => {
    setStep('upload')
    setArquivoNome('')
    setCpus([])
    setRecursosCatalogo([])
    setAbasIgnoradas([])
    setSelecionados(new Set())
    setError(null)
    setResultado(null)
  }

  const escolherArquivo = async (): Promise<void> => {
    setError(null)
    try {
      const r = await window.infrawork.orcamento.escolherArquivo()
      if (r.canceled || !r.path) return
      setArquivoNome(r.name ?? r.path)
      const parsed = await window.infrawork.orcamento.parseCpuExcel({ path: r.path })
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      setCpus(parsed.result.cpus)
      setRecursosCatalogo(parsed.result.recursos_catalogo)
      setAbasIgnoradas(parsed.result.abas_ignoradas)
      setSelecionados(new Set(parsed.result.cpus.map((c) => c.aba_nome)))
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao ler arquivo')
    }
  }

  const toggleSel = (aba: string): void => {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(aba)) next.delete(aba)
      else next.add(aba)
      return next
    })
  }

  const toggleTodos = (): void => {
    if (selecionados.size === cpus.length) setSelecionados(new Set())
    else setSelecionados(new Set(cpus.map((c) => c.aba_nome)))
  }

  const aplicar = async (): Promise<void> => {
    setError(null)
    const cpusSelecionadas = cpus.filter((c) => selecionados.has(c.aba_nome))
    if (cpusSelecionadas.length === 0) {
      setError('Selecione ao menos uma CPU para importar.')
      return
    }
    setStep('aplicando')
    try {
      const r = await adminApi.importCpuAplicar({
        obra_id: obraId,
        cpus: cpusSelecionadas,
        recursos_catalogo: recursosCatalogo
      })
      setResultado({
        cpus_criadas: r.stats.cpus_criadas,
        servicos_criados: r.stats.servicos_criados,
        recursos_criados: r.stats.recursos_criados,
        precos_criados: r.stats.precos_criados,
        cpu_items_criados: r.stats.cpu_items_criados,
        erros: r.erros,
        warnings: r.warnings
      })
      setStep('resultado')
      qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
      qc.invalidateQueries({ queryKey: ['orcamento', 'servicos'] })
      qc.invalidateQueries({ queryKey: ['orcamento', 'recursos'] })
      if (r.stats.cpus_criadas > 0) {
        toast.success(
          `${r.stats.cpus_criadas} CPU(s) importadas em ${Math.round(r.duracao_ms / 100) / 10}s.`
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar')
      setStep('preview')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="lg"
      disableDismiss={step === 'aplicando'}
    >
      <DialogHeader>
        <DialogTitle>Importar CPUs de planilha TecPav</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />

        {step === 'upload' ? (
          <div className="space-y-3 py-4">
            <div className="text-2xs font-mono text-text-dim">
              Selecione o arquivo <span className="text-text">.xlsm</span> da planilha de
              planejamento TecPav. O sistema vai detectar todas as abas <code>CPU_*</code> e
              permitir escolher quais importar. Recursos e serviços que ainda não existem na obra
              serão criados automaticamente.
            </div>
            <Button variant="default" onClick={escolherArquivo}>
              <FileUp size={11} /> Selecionar arquivo
            </Button>
          </div>
        ) : null}

        {step === 'preview' ? (
          <div className="space-y-2">
            <div className="text-2xs font-mono text-text-dim">
              Arquivo: <span className="text-text">{arquivoNome}</span> · {cpus.length} CPU(s)
              detectadas
              {recursosCatalogo.length > 0 ? (
                <span className="text-success">
                  {' '}
                  · {recursosCatalogo.length} recurso(s) com preço no Cadastro_Recursos
                </span>
              ) : (
                <span className="text-warn"> · sem Cadastro_Recursos (preços ficarão em 0)</span>
              )}
              {abasIgnoradas.length > 0 ? (
                <span className="text-text-muted">
                  {' '}
                  · {abasIgnoradas.length} aba(s) ignorada(s)
                </span>
              ) : null}
            </div>
            <div className="flex items-center justify-between border-b border-border pb-1.5">
              <button
                type="button"
                onClick={toggleTodos}
                className="text-2xs font-mono uppercase tracking-wider text-accent hover:text-accent-hover"
              >
                {selecionados.size === cpus.length ? 'Desmarcar todas' : 'Marcar todas'}
              </button>
              <span className="text-2xs font-mono text-text-dim">
                {selecionados.size} / {cpus.length} selecionada(s)
              </span>
            </div>
            <div className="max-h-[480px] overflow-auto rounded border border-border">
              <table className="w-full text-xs font-mono">
                <thead className="text-2xs text-text-dim bg-bg-elevated sticky top-0">
                  <tr className="border-b border-border">
                    <th className="px-2 py-1 text-left w-8">✓</th>
                    <th className="px-2 py-1 text-left">Serviço (B3)</th>
                    <th className="px-2 py-1 text-left">Aba</th>
                    <th className="px-2 py-1 text-center">Un.</th>
                    <th className="px-2 py-1 text-right">Prod./dia</th>
                    <th className="px-2 py-1 text-right">EQ</th>
                    <th className="px-2 py-1 text-right">COMB</th>
                    <th className="px-2 py-1 text-right">MO</th>
                    <th className="px-2 py-1 text-right">MAT</th>
                    <th className="px-2 py-1 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cpus.map((c) => {
                    const eq = c.itens.filter((i) => i.grupo === 'EQUIPAMENTO').length
                    const comb = c.itens.filter((i) => i.grupo === 'COMBUSTIVEL').length
                    const mo = c.itens.filter((i) => i.grupo === 'MO').length
                    const mat = c.itens.filter((i) => i.grupo === 'MATERIAL').length
                    const sel = selecionados.has(c.aba_nome)
                    return (
                      <tr
                        key={c.aba_nome}
                        className="border-b border-border/40 hover:bg-bg-hover cursor-pointer"
                        onClick={() => toggleSel(c.aba_nome)}
                      >
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            checked={sel}
                            onChange={() => toggleSel(c.aba_nome)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td
                          className="px-2 py-1 text-text truncate max-w-[220px]"
                          title={c.servico_nome}
                        >
                          {c.servico_nome}
                        </td>
                        <td className="px-2 py-1 text-text-dim text-2xs truncate max-w-[160px]">
                          {c.aba_nome}
                        </td>
                        <td className="px-2 py-1 text-center text-text-muted text-2xs">
                          {c.servico_unidade ?? '—'}
                        </td>
                        <td className="px-2 py-1 text-right text-text-muted tabular-nums">
                          {c.producao_diaria_qtde > 0
                            ? formatNumber(c.producao_diaria_qtde)
                            : '—'}
                        </td>
                        <td className="px-2 py-1 text-right text-text-muted tabular-nums">{eq}</td>
                        <td className="px-2 py-1 text-right text-text-muted tabular-nums">
                          {comb}
                        </td>
                        <td className="px-2 py-1 text-right text-text-muted tabular-nums">{mo}</td>
                        <td className="px-2 py-1 text-right text-text-muted tabular-nums">{mat}</td>
                        <td className="px-2 py-1">
                          {c.incompleta ? (
                            <Badge variant="warn">incompleta</Badge>
                          ) : c.warnings.length > 0 ? (
                            <Badge variant="warn">avisos</Badge>
                          ) : (
                            <Badge variant="success">ok</Badge>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {abasIgnoradas.length > 0 ? (
              <details className="text-2xs font-mono text-text-dim">
                <summary className="cursor-pointer hover:text-text">
                  Abas ignoradas ({abasIgnoradas.length})
                </summary>
                <ul className="pl-3 mt-1 space-y-0.5">
                  {abasIgnoradas.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="text-2xs font-mono text-text-muted border-t border-border pt-2">
              <AlertTriangle size={11} className="inline mr-1 text-warn" />
              {recursosCatalogo.length > 0
                ? 'Preços virão do Cadastro_Recursos da planilha. Recursos não encontrados no cadastro nascem sem preço.'
                : 'Aba Cadastro_Recursos não encontrada. Recursos novos nascem sem preço.'}
            </div>
          </div>
        ) : null}

        {step === 'aplicando' ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="animate-spin text-accent" size={32} />
            <div className="text-xs font-mono text-text-muted">
              Importando {selecionados.size} CPU(s)…
            </div>
            <div className="text-2xs font-mono text-text-dim">
              Criando serviços, recursos e composições. Pode levar alguns segundos.
            </div>
          </div>
        ) : null}

        {step === 'resultado' && resultado ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-accent">
              <CheckCircle2 size={16} />
              <span className="text-sm font-mono">Importação concluída</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <Metric label="CPUs criadas" value={resultado.cpus_criadas} />
              <Metric label="Serviços criados" value={resultado.servicos_criados} />
              <Metric label="Recursos criados" value={resultado.recursos_criados} />
              <Metric label="Preços cadastrados" value={resultado.precos_criados} />
              <Metric label="Itens de CPU" value={resultado.cpu_items_criados} />
            </div>
            {resultado.warnings.length > 0 ? (
              <details className="text-2xs font-mono text-warn">
                <summary className="cursor-pointer">Avisos ({resultado.warnings.length})</summary>
                <ul className="pl-3 mt-1 space-y-0.5 max-h-32 overflow-auto">
                  {resultado.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {resultado.erros.length > 0 ? (
              <details className="text-2xs font-mono text-danger">
                <summary className="cursor-pointer">Erros ({resultado.erros.length})</summary>
                <ul className="pl-3 mt-1 space-y-0.5 max-h-32 overflow-auto">
                  {resultado.erros.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="text-2xs font-mono text-text-muted border-t border-border pt-2">
              Próximo passo: ajuste os preços dos recursos no catálogo e vincule as CPUs a grupos de
              serviço na planilha orçamentária.
            </div>
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {step === 'upload' ? (
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        ) : null}
        {step === 'preview' ? (
          <>
            <Button type="button" variant="ghost" onClick={() => setStep('upload')}>
              Voltar
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={aplicar}
              disabled={selecionados.size === 0}
            >
              Importar {selecionados.size} CPU(s)
            </Button>
          </>
        ) : null}
        {step === 'resultado' ? (
          <Button type="button" variant="default" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  )
}

function Metric({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className="rounded border border-border bg-bg-elevated px-3 py-2">
      <div className="text-2xs uppercase tracking-wider text-text-dim">{label}</div>
      <div className="text-text tabular-nums text-base">{value}</div>
    </div>
  )
}
