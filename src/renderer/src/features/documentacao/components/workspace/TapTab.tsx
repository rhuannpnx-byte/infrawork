import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FileOutput, Save, Loader2, AlertTriangle, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { fmtBRL } from '@/lib/money'

const cnSev = (bloq: boolean): string =>
  cn(
    'flex items-center gap-1.5 px-3 py-2 text-2xs font-medium border-b border-border',
    bloq ? 'bg-danger/10 text-danger' : 'bg-warn/10 text-warn'
  )
import {
  TAP_CAMPOS_MANUAIS,
  useTapManual,
  useSalvarTapManual,
  type TapManual
} from '@/features/documentacao/hooks/tap'
import type { ObraDossier } from '@/types/documentacao'

interface Props {
  dossie: ObraDossier
  obraId: string
}

const re = (s: string): RegExp => new RegExp(s, 'i')
const moeda = (v: number | null | undefined): string => (v != null ? fmtBRL(v) : '—')
const txt = (v: string | null | undefined): string => (v && v.trim() ? v : '—')

/** Datas em pt-BR (dd/mm/aaaa ou mm/aaaa), a partir de ISO. */
const dataBR = (v: string | null | undefined): string => {
  if (!v) return '—'
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (d) return `${d[3]}/${d[2]}/${d[1]}`
  const m = /^(\d{4})-(\d{2})$/.exec(v)
  if (m) return `${m[2]}/${m[1]}`
  return v
}

export function TapTab({ dossie, obraId }: Props): ReactNode {
  const tapQuery = useTapManual(obraId)
  const salvar = useSalvarTapManual()
  const [manual, setManual] = useState<TapManual | null>(null)

  // Estado editável inicia do que está salvo (e re-sincroniza quando carrega).
  const manualAtual: TapManual = manual ?? tapQuery.data?.manual ?? {}

  const setCampo = (chave: string, valor: string): void =>
    setManual({ ...manualAtual, [chave]: { ...manualAtual[chave], valor } })

  const auto = useMemo(() => derivarAuto(dossie), [dossie])

  const findings = dossie.findings ?? []
  const blockers = findings.filter((f) => f.severidade === 'BLOCKER')
  const warns = findings.filter((f) => f.severidade === 'WARN')
  const definitivo = blockers.length === 0

  const manualPreenchidos = TAP_CAMPOS_MANUAIS.filter((m) =>
    manualAtual[m.chave]?.valor?.trim()
  ).length
  const autoPreenchidos = auto.totalPreenchidos
  const autoTotal = auto.total

  const onSalvar = (emitir: boolean): void => {
    salvar.mutate(
      { obra_id: obraId, manual: manualAtual, emitir },
      {
        onSuccess: () => {
          if (emitir) {
            toast.success(
              definitivo
                ? 'TAP emitido — abrindo a impressão (salve como PDF).'
                : 'Rascunho emitido (há pendências a conferir) — abrindo a impressão.'
            )
            setTimeout(() => window.print(), 250)
          } else {
            toast.success('Campos manuais salvos.')
          }
        },
        onError: (e) => toast.error(e.message)
      }
    )
  }

  return (
    <div className="h-full overflow-auto p-5">
      {/* Estilo de impressão: imprime SÓ a folha do TAP. */}
      <style>{PRINT_CSS}</style>

      {/* Barra de ações + cobertura (não imprime) */}
      <div className="no-print mb-3 flex flex-wrap items-center gap-3 max-w-[820px] mx-auto">
        <Button onClick={() => onSalvar(true)} disabled={salvar.isPending}>
          {salvar.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <FileOutput size={13} />
          )}
          {definitivo ? 'Emitir TAP (PDF)' : 'Emitir rascunho (a conferir)'}
        </Button>
        <Button variant="ghost" onClick={() => onSalvar(false)} disabled={salvar.isPending}>
          <Save size={13} /> Salvar campos
        </Button>
        <div className="flex-1 min-w-[160px]">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-bg-hover">
            <div
              className="bg-success"
              style={{ width: `${(autoPreenchidos / (autoTotal + 6)) * 100}%` }}
            />
            <div
              className="bg-warn"
              style={{ width: `${(manualPreenchidos / (autoTotal + 6)) * 100}%` }}
            />
          </div>
        </div>
        <span className="text-2xs text-text-dim">
          <b className="text-success">{autoPreenchidos}</b>/{autoTotal} auto ·{' '}
          <b className="text-warn">{manualPreenchidos}</b>/6 manual
        </span>
        {tapQuery.data?.emitido_em ? (
          <span className="text-2xs font-mono text-text-dim">
            emitido {dataBR(tapQuery.data.emitido_em)}
          </span>
        ) : null}
      </div>

      {/* Validação (não imprime): gate de emissão + findings (a conferir) */}
      {findings.length ? (
        <div className="no-print mb-4 max-w-[820px] mx-auto rounded-lg border border-border overflow-hidden">
          <div className={cnSev(blockers.length > 0)}>
            {blockers.length > 0 ? (
              <>
                <AlertTriangle size={13} /> {blockers.length} pendência(s) BLOQUEANTE(s) — só é
                possível emitir RASCUNHO até resolver.
              </>
            ) : (
              <>
                <Info size={13} /> {warns.length} ponto(s) a conferir — TAP pode ser emitido como
                definitivo.
              </>
            )}
          </div>
          <ul className="divide-y divide-border/60">
            {findings.slice(0, 30).map((f, i) => (
              <li key={i} className="flex items-start gap-2 px-3 py-1.5 text-2xs">
                <span
                  className={
                    f.severidade === 'BLOCKER'
                      ? 'font-mono font-bold text-danger shrink-0'
                      : f.severidade === 'WARN'
                        ? 'font-mono text-warn shrink-0'
                        : 'font-mono text-text-dim shrink-0'
                  }
                >
                  {f.regra_id}
                </span>
                <span className="text-text-muted flex-1">
                  {f.campo ? <b className="text-text">{f.campo}: </b> : null}
                  {f.mensagem}
                  {f.encontrado ? <span className="text-text-dim"> ({f.encontrado})</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Folha do TAP (papel) */}
      <div id="tap-print" className="tap-sheet">
        {!definitivo ? (
          <div className="tap-rascunho">
            RASCUNHO — A CONFERIR ({blockers.length} pendência(s) bloqueante(s))
          </div>
        ) : null}
        <div className="tap-head">
          <div>
            <h1>TERMO DE ABERTURA DO PROJETO — TAP</h1>
            <p>Gerado pelo módulo Documentação Oficial · bloco documental do Raio-X da obra</p>
          </div>
          <div className="tap-obra">
            {txt(dossie.obra.codigo)}
            <span>{txt(dossie.obra.nome)}</span>
          </div>
        </div>

        <Secao n="1" titulo="Identificação contratual">
          <Campo r="Empresa contratada" v={auto.empresa_contratada} fonte="Contrato / Consórcio" />
          <Campo r="Cliente / Órgão" v={auto.cliente} fonte="Contrato" />
          <Campo r="Objeto" v={auto.objeto} fonte="Cláusula 1ª" full />
          <Campo r="Nº do contrato" v={auto.numero} fonte="Contrato" />
          <Campo r="Processo / SEI" v={auto.processo} fonte="Contrato" />
          <Campo r="Edital" v={auto.edital} fonte="Edital" />
          <Campo r="Regime / Lei" v={auto.regime_lei} fonte="Contrato" />
          <Campo r="CNAE" v={auto.cnae} fonte="CNPJ" />
          <Campo r="Fiscal" v={auto.fiscal} fonte="Contrato / Portaria" />
        </Secao>

        <Secao n="2" titulo="Valores">
          <div className="tap-tot">
            <div>
              Valor do contrato (P0)<b>{moeda(auto.p0)}</b>
            </div>
            <div>
              Reajuste acumulado<b>{moeda(auto.reajuste_acumulado)}</b>
            </div>
            <div>
              Aditivos (valor)<b>{moeda(auto.aditivos_valor)}</b>
            </div>
            <div>
              Valor total<b className="tap-vig">{moeda(auto.valor_total)}</b>
            </div>
          </div>
          <div className="tap-fields" style={{ marginTop: 10 }}>
            <Campo r="Data-base" v={dataBR(auto.data_base)} fonte="Contrato" />
            <Campo r="Data de assinatura" v={dataBR(auto.assinatura)} fonte="Contrato" />
            <Campo
              r="Reajustes (apostilamentos)"
              v={auto.reajustes_lista}
              fonte="Apostilamentos"
              full
            />
            <Campo r="Aditivos (data · R$)" v={auto.aditivos_lista} fonte="Termos Aditivos" full />
          </div>
        </Secao>

        <Secao n="3" titulo="Prazos">
          <Campo r="Prazo (vigência)" v={auto.prazo_vig} fonte="Contrato" />
          <Campo r="Prazo (execução)" v={auto.prazo_exec} fonte="Contrato" />
          <Campo r="Término execução" v={dataBR(auto.termino_exec)} fonte="Ficha / Cronograma" />
          <Campo r="Término vigência" v={dataBR(auto.termino_vig)} fonte="Contrato" />
          <Campo r="Início (OS de serviço)" v={dataBR(auto.inicio_exec)} fonte="Ordem de Serviço" />
        </Secao>

        <Secao n="4" titulo="Reajuste &amp; participação">
          <Campo
            r="Índice / Fórmula de reajuste"
            v={auto.indice_reajuste}
            fonte="Edital / Contrato"
            full
          />
        </Secao>

        <Secao
          n="5"
          titulo="Inserção manual ou documento-fonte"
          sub="(campos que não constam dos documentos do contrato — preencha ou anexe a fonte)"
        >
          {TAP_CAMPOS_MANUAIS.map((m) => (
            <div key={m.chave} className="tap-field tap-field-full">
              <label>
                {m.rotulo} <span className="tap-mtag">MANUAL/DOC</span>
              </label>
              <input
                className="tap-input"
                value={manualAtual[m.chave]?.valor ?? ''}
                placeholder={`inserir ou anexar: ${m.fonte}`}
                onChange={(e) => setCampo(m.chave, e.target.value)}
              />
            </div>
          ))}
        </Secao>

        {warns.length ? (
          <div className="tap-conferir">
            <b>A conferir:</b>{' '}
            {warns
              .slice(0, 8)
              .map((w) => `${w.campo ? `${w.campo} — ` : ''}${w.mensagem}`)
              .join(' · ')}
          </div>
        ) : null}

        <div className="tap-foot">
          <span>
            TECPAV · Documentação Oficial — TAP{' '}
            {definitivo ? 'emitido pelo módulo' : 'RASCUNHO (a conferir)'}
          </span>
          <span>fonte: Raio-X da obra {txt(dossie.obra.codigo)}</span>
        </div>
      </div>
    </div>
  )
}

function Secao({
  n,
  titulo,
  sub,
  children
}: {
  n: string
  titulo: string
  sub?: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="tap-sec">
      <div className="tap-st">
        {n} · {titulo}
        {sub ? <span className="tap-st-sub"> {sub}</span> : null}
      </div>
      <div className="tap-fields">{children}</div>
    </div>
  )
}

function Campo({
  r,
  v,
  fonte,
  full
}: {
  r: string
  v: string | null | undefined
  fonte: string
  full?: boolean
}): ReactNode {
  return (
    <div className={full ? 'tap-field tap-field-full' : 'tap-field'}>
      <label>
        {r} <span className="tap-src">{fonte}</span>
      </label>
      <div className="tap-val">{txt(v)}</div>
    </div>
  )
}

// ─── Derivação do bloco "auto" a partir do ObraDossier ──────────────────────
interface AutoTap {
  empresa_contratada: string
  cliente: string
  objeto: string | null
  numero: string | null
  processo: string | null
  edital: string | null
  regime_lei: string | null
  cnae: string | null
  indice_reajuste: string | null
  fiscal: string | null
  p0: number | null
  valor_total: number | null
  reajuste_acumulado: number | null
  aditivos_valor: number | null
  data_base: string | null
  assinatura: string | null
  reajustes_lista: string | null
  aditivos_lista: string | null
  prazo_vig: string | null
  prazo_exec: string | null
  termino_exec: string | null
  termino_vig: string | null
  inicio_exec: string | null
  total: number
  totalPreenchidos: number
}

function derivarAuto(d: ObraDossier): AutoTap {
  const c = d.contrato
  const fin = d.financeiro

  const contratadas = d.partes
    .filter((p) => re('contratad|consorci|líder|lider|integrante').test(p.papel))
    .map((p) => p.nome)
  const cliente =
    c?.contratante ??
    d.partes.find((p) => re('contratante|cliente|órgão|orgao|poder').test(p.papel))?.nome ??
    d.obra.orgao ??
    null

  const apost = d.eventos.filter((e) => re('apostil|reajust').test(e.tipo))
  const adit = d.eventos.filter((e) => re('aditiv').test(e.tipo))
  const somaDelta = (arr: typeof d.eventos): number | null => {
    const v = arr.reduce((s, e) => s + (e.delta ?? 0), 0)
    return v !== 0 ? v : null
  }

  const p0 = fin?.p0 ?? c?.valor_p0 ?? null
  const valor_total = fin?.valor_total ?? c?.valor_vigente ?? null
  const reaj = somaDelta(apost) ?? (p0 != null && valor_total != null ? valor_total - p0 : null)

  const listar = (arr: typeof d.eventos): string | null => {
    const linhas = arr.map((e) => {
      const data = e.data_norm ?? e.data_rotulo ?? ''
      const val = e.delta != null ? ` — ${fmtBRL(e.delta)}` : ''
      return `${e.rotulo}${data ? ` (${data})` : ''}${val}`
    })
    return linhas.length ? linhas.join('\n') : null
  }

  const auto: Omit<AutoTap, 'total' | 'totalPreenchidos'> = {
    empresa_contratada: contratadas.length ? contratadas.join(' · ') : (d.obra.nome ?? '—'),
    cliente: cliente ?? '—',
    objeto: c?.objeto ?? null,
    numero: c?.numero ?? null,
    processo: [c?.processo, c?.sei].filter(Boolean).join(' · ') || null,
    edital: c?.edital ?? null,
    regime_lei: [c?.regime, c?.lei].filter(Boolean).join(' · ') || null,
    cnae: c?.cnae ?? null,
    indice_reajuste: c?.indice_reajuste ?? null,
    fiscal: c?.fiscal ?? null,
    p0,
    valor_total,
    reajuste_acumulado: reaj,
    aditivos_valor: somaDelta(adit),
    data_base: c?.data_base ?? null,
    assinatura: c?.assinatura ?? null,
    reajustes_lista: listar(apost),
    aditivos_lista: listar(adit),
    prazo_vig: c?.prazo_vig_dias != null ? `${c.prazo_vig_dias} dias` : null,
    prazo_exec: c?.prazo_exec_dias != null ? `${c.prazo_exec_dias} dias` : null,
    termino_exec: c?.termino_exec ?? null,
    termino_vig: c?.termino_vig ?? null,
    inicio_exec: c?.inicio_exec ?? null
  }

  // Cobertura: campos auto considerados (ignora as duas listas dependentes).
  const chaves: (keyof typeof auto)[] = [
    'cliente',
    'objeto',
    'numero',
    'processo',
    'edital',
    'regime_lei',
    'fiscal',
    'p0',
    'valor_total',
    'data_base',
    'assinatura',
    'prazo_vig',
    'prazo_exec',
    'termino_exec',
    'termino_vig',
    'inicio_exec'
  ]
  const total = chaves.length + 1 // +1 = empresa_contratada
  const preenchido = (k: keyof typeof auto): boolean => {
    const val = auto[k]
    return val != null && val !== '—' && String(val).trim() !== ''
  }
  const totalPreenchidos =
    (preenchido('empresa_contratada') ? 1 : 0) + chaves.filter(preenchido).length

  return { ...auto, total, totalPreenchidos }
}

// Folha branca (look de documento), em tema claro mesmo no app escuro, para
// imprimir/exportar PDF fielmente. @media print isola só #tap-print.
const PRINT_CSS = `
.tap-sheet{max-width:820px;margin:0 auto;background:#fff;color:#1a2433;border:1px solid #d7dee8;
  border-radius:6px;padding:34px 40px;font-size:12px;line-height:1.5;box-shadow:0 2px 14px rgba(0,0,0,.18)}
.tap-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;
  border-bottom:2px solid #1a2433;padding-bottom:14px;margin-bottom:18px}
.tap-head h1{font-size:17px;font-weight:800;letter-spacing:.2px;margin:0;color:#0d2235}
.tap-head p{font-size:10.5px;color:#5b6b7e;margin:3px 0 0}
.tap-obra{text-align:right;font-weight:800;font-size:15px;color:#0a6b65;white-space:nowrap}
.tap-obra span{display:block;font-weight:400;font-size:10.5px;color:#5b6b7e;margin-top:2px;max-width:220px}
.tap-sec{margin-bottom:16px}
.tap-st{font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#0a6b65;
  border-bottom:1px solid #e1e7ef;padding-bottom:4px;margin-bottom:10px}
.tap-st-sub{font-weight:400;text-transform:none;letter-spacing:0;color:#8a9bb0;font-size:10px}
.tap-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px}
.tap-field{display:flex;flex-direction:column;gap:2px;min-width:0}
.tap-field-full{grid-column:1 / -1}
.tap-field label{font-size:10px;font-weight:700;color:#41566b;text-transform:uppercase;letter-spacing:.3px}
.tap-src{font-weight:500;text-transform:none;letter-spacing:0;color:#9aa9bb;font-size:9.5px;margin-left:4px}
.tap-mtag{font-weight:700;color:#b5791b;background:#fcf2dd;border-radius:3px;padding:0 4px;font-size:8.5px}
.tap-val{font-size:12px;color:#1a2433;white-space:pre-line;border-bottom:1px dotted #ccd6e0;padding:2px 0;min-height:18px}
.tap-input{font-size:12px;color:#1a2433;border:none;border-bottom:1px solid #c2a25a;background:#fffdf6;
  padding:3px 4px;outline:none;width:100%}
.tap-input::placeholder{color:#b3a982;font-style:italic}
.tap-tot{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.tap-tot>div{display:flex;flex-direction:column;gap:3px;background:#f3f7fc;border:1px solid #e1e7ef;
  border-radius:5px;padding:8px 10px;font-size:10px;color:#5b6b7e;text-transform:uppercase;letter-spacing:.3px}
.tap-tot b{font-size:14px;color:#1a2433;font-weight:800;text-transform:none}
.tap-vig{color:#0a8f88 !important}
.tap-rascunho{background:#fbe9e7;color:#b3261e;border:1px solid #e6a9a1;border-radius:5px;
  padding:6px 10px;margin-bottom:14px;font-weight:800;font-size:11px;letter-spacing:.5px;text-align:center}
.tap-conferir{background:#fcf6e6;border:1px solid #e7d9a8;border-radius:5px;padding:8px 10px;
  margin-top:14px;font-size:10px;color:#7a6312;line-height:1.5}
.tap-foot{display:flex;justify-content:space-between;border-top:1px solid #e1e7ef;margin-top:18px;
  padding-top:10px;font-size:9.5px;color:#8a9bb0}
@media print{
  body * { visibility:hidden !important; }
  #tap-print, #tap-print * { visibility:visible !important; }
  #tap-print { position:absolute; left:0; top:0; width:100%; margin:0; border:none; box-shadow:none; }
  .tap-input{border-bottom:1px solid #999 !important;background:transparent !important}
}
`
