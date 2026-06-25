import { useMemo, type ReactNode } from 'react'
import { toast } from 'sonner'
import { RefreshCw, AlertTriangle, CheckCircle2, AlertCircle, Award } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { fmtBRL } from '@/lib/money'
import { useReavaliarLacunas } from '@/features/documentacao/hooks/dossie'
import type { ObraDossier, DossieParte } from '@/types/documentacao'

function KPI({ label, valor, sub }: { label: string; valor: string; sub?: string }): ReactNode {
  return (
    <div className="rounded-lg border border-border bg-bg-panel p-3.5">
      <div className="text-2xs uppercase tracking-wide text-text-dim">{label}</div>
      <div className="mt-1 text-lg font-bold text-text leading-tight">{valor}</div>
      {sub ? <div className="mt-0.5 text-2xs text-accent">{sub}</div> : null}
    </div>
  )
}

function KV({ k, v }: { k: string; v: ReactNode }): ReactNode {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-border/60 last:border-0 text-xs">
      <span className="text-text-muted">{k}</span>
      <span className="text-text font-medium text-right max-w-[62%]">{v ?? '—'}</span>
    </div>
  )
}

const sevIcon = { alta: AlertCircle, media: AlertTriangle, baixa: CheckCircle2 } as const
const sevVariant = { alta: 'danger', media: 'warn', baixa: 'success' } as const

interface Props {
  dossie: ObraDossier
  obraId: string
}

export function RaioXTab({ dossie, obraId }: Props): ReactNode {
  const reavaliar = useReavaliarLacunas()
  const reavaliando = reavaliar.isPending
  const onReavaliar = (): void =>
    reavaliar.mutate(
      { obra_id: obraId },
      { onSuccess: () => toast.success('Lacunas reavaliadas.') }
    )
  const c = dossie.contrato
  const fin = dossie.financeiro
  const rts = dossie.responsaveis_tecnicos
  const arts = rts.length
  const licencas = dossie.documentos.filter((d) => d.tipo_codigo === '10').length
  const aditivos = dossie.documentos.filter(
    (d) => d.tipo_codigo === '07' || d.tipo_codigo === '09'
  ).length
  const cobertura = Math.round((dossie.meta?.cobertura_essencial_pct ?? 0) * 100)

  // Dedup de partes no render (segurança): por CNPJ quando houver, senão por nome.
  // Líder em primeiro. (O resolver já exclui o próprio consórcio guarda-chuva.)
  const partes = useMemo(() => {
    const vistos = new Set<string>()
    const out: DossieParte[] = []
    for (const p of dossie.partes) {
      const k = p.cnpj?.replace(/\D/g, '') || (p.nome ?? '').toUpperCase().trim()
      if (!k || vistos.has(k)) continue
      vistos.add(k)
      out.push(p)
    }
    return out.sort(
      (a, b) =>
        Number(/lider|líder/i.test(b.papel ?? '')) - Number(/lider|líder/i.test(a.papel ?? ''))
    )
  }, [dossie.partes])

  const terminoExec = useMemo(
    () => dossie.eventos.find((e) => e.tipo === 'termino_exec') ?? null,
    [dossie.eventos]
  )

  return (
    <div className="h-full p-5 space-y-5 overflow-auto">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI
          label="Contrato"
          valor={c?.numero ?? '—'}
          sub={dossie.obra.orgao ?? dossie.obra.perfil_orgao ?? undefined}
        />
        <KPI
          label="Valor vigente"
          valor={
            fin?.valor_total != null
              ? fmtBRL(fin.valor_total)
              : c?.valor_vigente != null
                ? fmtBRL(c.valor_vigente)
                : '—'
          }
          sub={fin?.pct_reajuste ? `+${fin.pct_reajuste.toFixed(2)}% reajuste` : undefined}
        />
        <KPI
          label="Prazo execução"
          valor={c?.prazo_exec_dias ? `${c.prazo_exec_dias} dias` : '—'}
          sub={
            terminoExec?.data_norm
              ? `término ${terminoExec.data_norm}`
              : c?.inicio_exec
                ? `início ${c.inicio_exec}`
                : undefined
          }
        />
        <KPI
          label="Cobertura essencial"
          valor={`${cobertura}%`}
          sub={`${arts} ARTs · ${licencas} licenças · ${aditivos} aditivos`}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-bg-panel p-4">
          <h3 className="text-sm font-semibold text-text mb-2">Identificação contratual</h3>
          <KV k="Objeto" v={c?.objeto} />
          <KV k="Processo / SEI" v={[c?.processo, c?.sei].filter(Boolean).join(' · ') || null} />
          <KV k="Edital / Lei" v={[c?.edital, c?.lei].filter(Boolean).join(' · ') || null} />
          <KV k="Assinatura" v={c?.assinatura} />
          <KV k="Início (OS)" v={c?.inicio_exec} />
          <KV k="Término execução" v={terminoExec?.data_norm ?? c?.termino_exec} />
          <KV k="Vigência" v={c?.termino_vig ? `até ${c.termino_vig}` : null} />
          <KV k="Fiscal" v={c?.fiscal} />

          <h3 className="text-sm font-semibold text-text mt-4 mb-2">Financeiro</h3>
          <KV k="Valor original (P0)" v={fin?.p0 != null ? fmtBRL(fin.p0) : null} />
          <KV k="Valor vigente" v={fin?.valor_total != null ? fmtBRL(fin.valor_total) : null} />
          <KV
            k="Reajuste / Aditivos"
            v={
              fin
                ? `+${(fin.pct_reajuste ?? 0).toFixed(2)}% · +${((fin.pct_aditado ?? 0) * 100).toFixed(1)}%`
                : null
            }
          />
        </div>

        <div className="rounded-lg border border-border bg-bg-panel p-4">
          <h3 className="text-sm font-semibold text-text mb-2">
            Partes / Consórcio{(c?.consorcio as { is?: boolean } | null)?.is ? ' (consórcio)' : ''}
          </h3>
          {partes.length ? (
            partes.map((p, i) => {
              const lider = /lider|líder/i.test(p.papel ?? '')
              return (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 py-1.5 border-b border-border/60 last:border-0 text-xs"
                >
                  <span className="flex items-center gap-1.5 text-text font-medium">
                    {lider ? <Badge variant="accent">LÍDER</Badge> : null}
                    {p.nome}
                  </span>
                  <span className="text-text-muted font-mono text-2xs text-right shrink-0">
                    {p.cnpj ?? '—'}
                  </span>
                </div>
              )
            })
          ) : (
            <p className="text-2xs text-text-dim">Sem partes extraídas.</p>
          )}

          {rts.length ? (
            <>
              <h3 className="text-sm font-semibold text-text mt-4 mb-2 flex items-center gap-1.5">
                <Award size={13} className="text-sky-400" /> Responsáveis técnicos · {rts.length}
              </h3>
              <div className="space-y-1">
                {rts.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-text">{r.nome}</span>
                    <span className="text-text-dim font-mono text-2xs text-right shrink-0">
                      {[r.papel, r.art ? `ART ${r.art}` : null].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <h3 className="text-sm font-semibold text-text mt-4 mb-2 flex items-center justify-between">
            Lacunas &amp; atenção
            <Button variant="ghost" size="sm" onClick={onReavaliar} disabled={reavaliando}>
              <RefreshCw size={11} className={reavaliando ? 'animate-spin' : ''} /> Reavaliar
            </Button>
          </h3>
          {dossie.lacunas.length ? (
            <div className="space-y-1.5">
              {dossie.lacunas.map((l, i) => {
                const Ic = sevIcon[l.severidade] ?? AlertTriangle
                return (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <Ic
                      size={13}
                      className={cn(
                        'shrink-0 mt-0.5',
                        l.severidade === 'alta'
                          ? 'text-danger'
                          : l.severidade === 'media'
                            ? 'text-warn'
                            : 'text-success'
                      )}
                    />
                    <span className="flex-1 text-text-muted">{l.mensagem}</span>
                    <Badge variant={sevVariant[l.severidade] ?? 'warn'}>{l.tipo}</Badge>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-2xs text-success">Sem lacunas essenciais detectadas.</p>
          )}
        </div>
      </div>
    </div>
  )
}
