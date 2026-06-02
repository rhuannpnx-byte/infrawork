// PosicaoPopover — escolha de Pos. Ini / Pos. Fim por busca + grade do trecho.
//
// Mostra a grade analítica do trecho como lista pesquisável (1 entrada por
// unidade do trecho — km/estaca/m/custom). Input no topo filtra a lista; Enter
// no input commita o texto livre direto (útil pra posições fora da grade,
// tipo "EST 5+12,5"). A string commitada vai pro mesmo parseMarcador usado pelo
// commit antigo, então valida o sentido/limite do trecho do mesmo jeito.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { gerarGradeAnalitica, type TrechoUnidadeConfig } from '@/lib/quantidades/grade'
import { formatMarcador, type TrechoCtx } from '@/lib/format'
import { AnchoredPopover } from './AnchoredPopover'
import type { ObraTrecho } from '@/types/gerencial'

interface PosicaoPopoverProps {
  anchorRect: DOMRect
  trecho: ObraTrecho | null
  field: 'posicao_inicio_m' | 'posicao_fim_m'
  currentMetros: number | null
  /** Recebe a string formatada (igual ao InlineCell antigo). */
  onSelect: (raw: string) => void
  onClose: () => void
}

// Cap pra evitar travar em trecho com unidade 'm' (1 linha por metro).
// Quando a grade total ultrapassar isso, mostra só os primeiros + dica de buscar.
const MAX_OPTIONS = 2000

export function PosicaoPopover({
  anchorRect,
  trecho,
  field,
  currentMetros,
  onSelect,
  onClose
}: PosicaoPopoverProps): ReactNode {
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const trechoUnidadeCfg: TrechoUnidadeConfig | null = useMemo(() => {
    if (!trecho) return null
    return {
      geometry_comprimento_m: Number(trecho.geometry_comprimento_m ?? 0),
      unidade_espaco_padrao: trecho.unidade_espaco_padrao,
      unidade_custom_label: trecho.unidade_custom_label,
      unidade_custom_divisor_m: trecho.unidade_custom_divisor_m,
      marcador_valor_inicial: Number(trecho.marcador_valor_inicial ?? 0)
    }
  }, [trecho])

  const trechoCtx: TrechoCtx | null = useMemo(() => {
    if (!trecho) return null
    return {
      unidade_espaco_padrao: trecho.unidade_espaco_padrao,
      unidade_custom_label: trecho.unidade_custom_label,
      unidade_custom_divisor_m: trecho.unidade_custom_divisor_m,
      marcador_valor_inicial: trecho.marcador_valor_inicial,
      geometry_sentido: trecho.geometry_sentido,
      geometry_comprimento_m: trecho.geometry_comprimento_m
    }
  }, [trecho])

  // Grade analítica: 1 entrada por divisor + 1 entrada extra com o fim do trecho
  // (o último segmento da grade só vai ATÉ comprimento, não inclui o ponto fim).
  const allOptions = useMemo<Array<{ metros: number; label: string }>>(() => {
    if (!trechoUnidadeCfg || !trechoCtx) return []
    const grade = gerarGradeAnalitica(trechoUnidadeCfg)
    const out: Array<{ metros: number; label: string }> = []
    for (const seg of grade) {
      out.push({ metros: seg.posicao_inicio_m, label: formatMarcador(seg.posicao_inicio_m, trechoCtx) })
    }
    if (grade.length > 0) {
      const ult = grade[grade.length - 1]
      out.push({ metros: ult.posicao_fim_m, label: formatMarcador(ult.posicao_fim_m, trechoCtx) })
    }
    return out
  }, [trechoUnidadeCfg, trechoCtx])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = q === '' ? allOptions : allOptions.filter((o) => o.label.toLowerCase().includes(q))
    return base.length > MAX_OPTIONS ? base.slice(0, MAX_OPTIONS) : base
  }, [allOptions, search])

  const truncado = allOptions.length > MAX_OPTIONS && search.trim() === ''

  function commitLivre(raw: string): void {
    const v = raw.trim()
    if (v === '') return
    onSelect(v)
    onClose()
  }

  return (
    <AnchoredPopover anchorRect={anchorRect} onClose={onClose} minWidth={240}>
      <div className="p-2 border-b border-border flex items-center gap-1.5">
        <Search size={11} className="text-text-dim shrink-0" />
        <Input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={trecho ? 'Buscar marcador ou digitar...' : 'Digite a posição...'}
          className="h-6 text-2xs font-mono"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitLivre(search)
            }
          }}
        />
        {currentMetros != null ? (
          <button
            type="button"
            title="Limpar posição"
            onClick={() => {
              onSelect('')
              onClose()
            }}
            className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded text-text-dim hover:text-danger hover:bg-bg-hover"
          >
            <X size={11} />
          </button>
        ) : null}
      </div>

      <div className="py-1 max-h-[280px] overflow-auto">
        {!trecho ? (
          <div className="px-3 py-2 text-text-dim italic text-2xs font-mono">
            Defina o trecho da tarefa primeiro pra ver os marcadores. Você ainda pode digitar
            valor em metros e pressionar Enter.
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-2 text-text-dim italic text-2xs font-mono">
            Nenhum marcador encontrado. Pressione Enter pra usar &quot;{search}&quot; como valor
            livre.
          </div>
        ) : (
          filtered.map((o) => {
            const selected =
              currentMetros != null && Math.abs(currentMetros - o.metros) < 0.005
            return (
              <button
                key={`${field}-${o.metros}`}
                type="button"
                onClick={() => {
                  onSelect(o.label)
                  onClose()
                }}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-1',
                  'text-left hover:bg-bg-hover text-2xs font-mono',
                  selected ? 'bg-accent/10 text-accent' : 'text-text'
                )}
              >
                <span>{o.label}</span>
                {selected ? <Check size={10} className="text-accent shrink-0" /> : null}
              </button>
            )
          })
        )}
        {truncado ? (
          <div className="px-3 py-1 mt-1 pt-1 border-t border-border text-text-faint text-2xs font-mono italic">
            Exibindo primeiros {MAX_OPTIONS}. Use a busca pra filtrar.
          </div>
        ) : null}
      </div>
    </AnchoredPopover>
  )
}
