import { useMemo, type ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { type ObraDossier } from '@/types/documentacao'

interface Props {
  dossie: ObraDossier
  onAbrirFonte: (docId: string | null, pagina: number | null) => void
}

const sevColor = {
  BLOCKER: 'text-danger',
  WARN: 'text-warn',
  INFO: 'text-text-dim'
} as const

/** Página TÉCNICA: validador (consistência), baixa confiança e meta do dossiê.
 * Tirado do Raio-X para deixá-lo executivo/limpo. */
export function LogsTab({ dossie, onAbrirFonte }: Props): ReactNode {
  const findings = dossie.findings ?? []
  const blockers = findings.filter((f) => f.severidade === 'BLOCKER').length
  const warns = findings.filter((f) => f.severidade === 'WARN').length

  // Campos resolvidos com baixa confiança (<0.80) — "a conferir".
  const baixaConf = useMemo(() => {
    const out: Array<{
      campo: string
      doc_id: string | null
      pagina: number | null
      conf: number
    }> = []
    for (const [campo, p] of Object.entries(dossie.proveniencia ?? {})) {
      const conf = typeof p?.confianca === 'number' ? p.confianca : null
      if (conf != null && conf < 0.8)
        out.push({ campo, doc_id: p?.doc_id ?? null, pagina: p?.pagina ?? null, conf })
    }
    return out.sort((a, b) => a.conf - b.conf)
  }, [dossie.proveniencia])

  const meta = dossie.meta
  const docs = dossie.documentos?.length ?? 0
  const semOCR = (dossie.documentos ?? []).filter((d) => !d.texto_layer && !d.ocr).length

  return (
    <div className="h-full overflow-auto p-5 space-y-5 max-w-3xl mx-auto">
      <div className="flex flex-wrap gap-2 text-2xs">
        <Badge variant={blockers ? 'danger' : 'success'}>{blockers} bloqueadores</Badge>
        <Badge variant={warns ? 'warn' : 'success'}>{warns} avisos</Badge>
        <Badge variant="outline">{baixaConf.length} campos a conferir</Badge>
        <Badge variant="outline">{docs} documentos</Badge>
      </div>

      {/* Consistência (validador) */}
      <section className="rounded-lg border border-border bg-bg-panel p-4">
        <h3 className="text-sm font-semibold text-text mb-2">Consistência (validador)</h3>
        {findings.length ? (
          <div className="space-y-1.5">
            {findings.map((f, i) => {
              const Ic =
                f.severidade === 'BLOCKER'
                  ? AlertCircle
                  : f.severidade === 'WARN'
                    ? AlertTriangle
                    : Info
              return (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <Ic
                    size={13}
                    className={cn('shrink-0 mt-0.5', sevColor[f.severidade] ?? 'text-text-dim')}
                  />
                  <span className="flex-1 text-text-muted">
                    {f.campo ? <b className="text-text">{f.campo}: </b> : null}
                    {f.mensagem}
                    {f.encontrado ? (
                      <span className="block text-2xs text-text-dim mt-0.5">↳ {f.encontrado}</span>
                    ) : null}
                  </span>
                  <Badge variant={f.severidade === 'BLOCKER' ? 'danger' : 'warn'}>
                    {f.regra_id}
                  </Badge>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-2xs text-success flex items-center gap-1">
            <CheckCircle2 size={13} /> Sem inconsistências detectadas.
          </p>
        )}
      </section>

      {/* Baixa confiança */}
      <section className="rounded-lg border border-border bg-bg-panel p-4">
        <h3 className="text-sm font-semibold text-text mb-2">
          Campos a conferir (confiança &lt; 80%)
        </h3>
        {baixaConf.length ? (
          <div className="space-y-1">
            {baixaConf.map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-2xs text-text-dim w-12 shrink-0">
                  {Math.round(b.conf * 100)}%
                </span>
                <span className="flex-1 text-text-muted">{b.campo}</span>
                {b.doc_id ? (
                  <button
                    type="button"
                    onClick={() => onAbrirFonte(b.doc_id, b.pagina)}
                    className="text-2xs text-accent hover:underline shrink-0"
                  >
                    fonte
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-2xs text-text-dim">Nenhum campo de baixa confiança.</p>
        )}
      </section>

      {/* Meta técnica */}
      <section className="rounded-lg border border-border bg-bg-panel p-4">
        <h3 className="text-sm font-semibold text-text mb-2">Meta do dossiê</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <Linha k="Gerado em" v={meta?.gerado_em ?? '—'} />
          <Linha k="Schema" v={String(meta?.schema_version ?? '—')} />
          <Linha
            k="Cobertura essencial"
            v={`${Math.round((meta?.cobertura_essencial_pct ?? 0) * 100)}%`}
          />
          <Linha k="Documentos sem texto/OCR" v={String(semOCR)} />
        </div>
      </section>
    </div>
  )
}

function Linha({ k, v }: { k: string; v: string }): ReactNode {
  return (
    <div className="flex justify-between gap-2 border-b border-border/50 py-1">
      <span className="text-text-dim">{k}</span>
      <span className="text-text font-medium">{v}</span>
    </div>
  )
}
