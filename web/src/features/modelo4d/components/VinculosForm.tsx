import { type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Select } from '@/components/ui/select'
import {
  divisorMetrosPorUnidade,
  formatMarcadorCompacto,
  marcadorToMetros
} from '@/lib/format/posicao'
import { contar } from '@/lib/rotulos'
import type { ObraTrecho } from '@/types/gerencial'
import type { ServicoDaObra } from '../hooks/modelo4d'
import type { ResumoModelo } from '../lib/preparar'

export interface VinculosEdicao {
  /** id do eixo do modelo → id do local ('' = sem vínculo). */
  eixos: Record<string, string>
  /** id da classe → id do serviço ('' = sem vínculo). */
  classes: Record<string, string>
}

interface Props {
  resumo: ResumoModelo
  trechos: ObraTrecho[]
  servicos: ServicoDaObra[]
  valor: VinculosEdicao
  aoMudar: (v: VinculosEdicao) => void
  desabilitado?: boolean
}

/** Faixa do eixo do modelo em metros do local, e se ela cabe nele. */
function encaixe(
  e: ResumoModelo['eixos'][number],
  t: ObraTrecho | undefined
): { texto: string; fora: boolean } | null {
  if (!t) return null
  const d = divisorMetrosPorUnidade(t)
  const a = marcadorToMetros(e.s0 / d, t)
  const b = marcadorToMetros(e.s1 / d, t)
  const ini = Math.min(a, b)
  const fim = Math.max(a, b)
  const comp = Number(t.comprimento_m ?? 0)
  return {
    texto: `O local vai de ${formatMarcadorCompacto(0, t)} a ${formatMarcadorCompacto(comp, t)}.`,
    fora: ini < -20 || fim > comp + 20
  }
}

const posicao = (s: number, t: ObraTrecho | undefined): string => {
  if (!t) return `${Math.round(s).toLocaleString('pt-BR')} m`
  const d = divisorMetrosPorUnidade(t)
  return formatMarcadorCompacto(Math.max(0, marcadorToMetros(s / d, t)), t) || '0'
}

/** Liga os eixos do modelo aos locais da obra e as classes aos serviços. */
export function VinculosForm({
  resumo,
  trechos,
  servicos,
  valor,
  aoMudar,
  desabilitado
}: Props): ReactNode {
  const eixosObra = trechos.filter((t) => t.tipo === 'eixo')
  const trechoDe = (eixo: string): ObraTrecho | undefined =>
    eixosObra.find((t) => t.id === valor.eixos[eixo])
  const primeiro = trechoDe(resumo.eixos[0]?.id ?? '')
  const disciplinas = [...new Set(resumo.classes.map((c) => c.disciplina))]

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Eixos do modelo">
        <h3 className="text-sm font-semibold text-text">Eixos do modelo</h3>
        <p className="mt-0.5 text-xs text-text-muted">
          Cada eixo do modelo corresponde a um local da obra: é o estaqueamento dele que liga o
          modelo ao plano e aos lançamentos.
        </p>
        {eixosObra.length === 0 ? (
          <p className="mt-2 flex items-start gap-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-text">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />A obra não
            tem local do tipo eixo. Cadastre o local em Planejamento › Locais e volte para vincular.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {resumo.eixos.map((e) => {
              const t = trechoDe(e.id)
              const enc = encaixe(e, t)
              return (
                <li
                  key={e.id}
                  className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[1fr_16rem]"
                >
                  <div className="min-w-0 text-sm">
                    <span className="font-medium text-text">{e.nome}</span>
                    <span className="text-text-muted">
                      {' '}
                      · {posicao(e.s0, t)} a {posicao(e.s1, t)}
                    </span>
                    {enc ? (
                      <span
                        className={`block text-xs ${enc.fora ? 'text-warn' : 'text-text-muted'}`}
                      >
                        {enc.fora
                          ? `O modelo passa do fim do local. ${enc.texto} O que ficar fora não entra no 4D.`
                          : enc.texto}
                      </span>
                    ) : null}
                  </div>
                  <Select
                    aria-label={`Local do eixo ${e.nome}`}
                    value={valor.eixos[e.id] ?? ''}
                    disabled={desabilitado}
                    onChange={(ev) =>
                      aoMudar({ ...valor, eixos: { ...valor.eixos, [e.id]: ev.target.value } })
                    }
                  >
                    <option value="">Sem local</option>
                    {eixosObra.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nome}
                      </option>
                    ))}
                  </Select>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-label="Classes do modelo">
        <h3 className="text-sm font-semibold text-text">Classes do modelo</h3>
        <p className="mt-0.5 text-xs text-text-muted">
          Cada classe aponta para um serviço do plano. Classe sem serviço aparece na cena como
          contexto. Serviço vinculado passa a exigir o local com estacas no lançamento.
        </p>
        <div className="mt-2 flex flex-col gap-3">
          {disciplinas.map((disc) => (
            <div key={disc}>
              <h4 className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                {disc}
              </h4>
              <ul className="mt-1 divide-y divide-border rounded border border-border">
                {resumo.classes
                  .filter((c) => c.disciplina === disc)
                  .map((c) => (
                    <li
                      key={c.id}
                      className="grid grid-cols-1 items-center gap-x-3 gap-y-1 px-3 py-1.5 sm:grid-cols-[1fr_18rem]"
                    >
                      <div className="min-w-0 text-sm">
                        <span className="text-text">{c.nome}</span>
                        <span className="block text-xs text-text-muted">
                          {contar(c.pecas, 'peça', 'peças')}
                          {c.s0 != null && c.s1 != null
                            ? ` · ${posicao(c.s0, primeiro)} a ${posicao(c.s1, primeiro)}`
                            : ''}
                        </span>
                      </div>
                      {c.contexto ? (
                        <span className="text-xs text-text-muted">Só contexto</span>
                      ) : (
                        <Select
                          aria-label={`Serviço da classe ${c.nome}`}
                          value={valor.classes[c.id] ?? ''}
                          disabled={desabilitado}
                          onChange={(ev) =>
                            aoMudar({
                              ...valor,
                              classes: { ...valor.classes, [c.id]: ev.target.value }
                            })
                          }
                        >
                          <option value="">Sem serviço</option>
                          {servicos.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.codigo} · {s.descricao}
                            </option>
                          ))}
                        </Select>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export function paraGravar(v: VinculosEdicao): {
  eixos: { eixo: string; trecho_id: string }[]
  classes: { classe: string; item_orcamentario_id: string }[]
} {
  return {
    eixos: Object.entries(v.eixos)
      .filter(([, t]) => t)
      .map(([eixo, trecho_id]) => ({ eixo, trecho_id })),
    classes: Object.entries(v.classes)
      .filter(([, i]) => i)
      .map(([classe, item_orcamentario_id]) => ({ classe, item_orcamentario_id }))
  }
}
