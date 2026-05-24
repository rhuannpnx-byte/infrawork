import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, Map as MapIcon, Columns } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useFotosInfinite } from '@/features/acompanhamento/hooks/fotos'
import { useFotosFiltrosStore, type FotosViewMode } from '@/features/acompanhamento/stores/fotos-filtros'
import { FotosGridVirtualizado } from '@/features/acompanhamento/components/fotos/FotosGridVirtualizado'
import { MapaFotosSatelite } from '@/features/acompanhamento/components/fotos/MapaFotosSatelite'
import { FotoLightbox } from '@/features/acompanhamento/components/fotos/FotoLightbox'
import { cn } from '@/lib/utils'
import type { FotoEnriquecida, FotosListarFiltros } from '@/types/acompanhamento'

export function AcompanhamentoFotosPage(): ReactNode {
  return (
    <RequireObra pageTitle="Fotos & Mapa">
      <Inner />
    </RequireObra>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const filtros = useFotosFiltrosStore()
  const setDataRange = useFotosFiltrosStore((s) => s.setDataRange)
  const setSomenteGeo = useFotosFiltrosStore((s) => s.setSomenteGeo)
  const setViewMode = useFotosFiltrosStore((s) => s.setViewMode)
  const setServicos = useFotosFiltrosStore((s) => s.setServicos)
  const toggleServico = useFotosFiltrosStore((s) => s.toggleServico)

  const efFiltros: FotosListarFiltros = useMemo(() => ({
    data_de: filtros.data_de ?? undefined,
    data_ate: filtros.data_ate ?? undefined,
    servico_ids: filtros.servico_ids.length ? filtros.servico_ids : undefined,
    equipe_match_ids: filtros.equipe_match_ids.length ? filtros.equipe_match_ids : undefined,
    encarregado_nomes: filtros.encarregado_nomes.length ? filtros.encarregado_nomes : undefined,
    frente: filtros.frente ?? undefined,
    somente_geo: filtros.somente_geo || undefined
  }), [filtros])

  const { data: pages, fetchNextPage, hasNextPage, isFetching } = useFotosInfinite(obraId, efFiltros)

  const fotos = useMemo<FotoEnriquecida[]>(
    () => (pages?.pages ?? []).flatMap((p) => p.fotos),
    [pages]
  )

  // Catálogo de serviços do dataset atual (para o filtro)
  const servicosDisponiveis = useMemo(() => {
    const m = new Map<number, string>()
    for (const f of fotos) {
      if (f.siga_servico_id != null) {
        m.set(f.siga_servico_id, f.servico_display_nome ?? f.siga_servico_nome ?? `id ${f.siga_servico_id}`)
      }
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [fotos])

  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const total = pages?.pages[0]?.total ?? 0

  // Auto-fetch da próxima página enquanto há mais
  const sentinel = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!sentinel.current) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetching) void fetchNextPage()
    })
    obs.observe(sentinel.current)
    return () => obs.disconnect()
  }, [hasNextPage, isFetching, fetchNextPage])

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Fotos & Mapa"
        subtitle={`${scope.obra?.nome ?? ''} — ${fotos.length}${total > fotos.length ? ` de ${total}` : ''} fotos`}
        actions={
          <div className="inline-flex border border-border rounded overflow-hidden">
            <ViewBtn cur={filtros.view_mode} mode="split" onClick={setViewMode}><Columns size={11} /></ViewBtn>
            <ViewBtn cur={filtros.view_mode} mode="grid" onClick={setViewMode}><LayoutGrid size={11} /></ViewBtn>
            <ViewBtn cur={filtros.view_mode} mode="mapa" onClick={setViewMode}><MapIcon size={11} /></ViewBtn>
          </div>
        }
      />
      <div className="border-b border-border px-5 py-3 flex flex-wrap items-center gap-3 bg-bg-panel">
        <div className="flex items-center gap-1.5">
          <span className="text-2xs font-mono uppercase text-text-dim">Período</span>
          <DateRangePopover
            from={filtros.data_de}
            to={filtros.data_ate}
            onChange={setDataRange}
          />
        </div>
        <ServicosFiltro
          opcoes={servicosDisponiveis}
          selecionados={filtros.servico_ids}
          onToggle={toggleServico}
          onClear={() => setServicos([])}
        />
        <label className="flex items-center gap-1.5 text-2xs font-mono text-text-dim cursor-pointer">
          <input type="checkbox" checked={filtros.somente_geo} onChange={(e) => setSomenteGeo(e.target.checked)} />
          só com GPS
        </label>
      </div>

      <div
        className="flex-1 grid overflow-hidden"
        style={{
          gridTemplateColumns:
            filtros.view_mode === 'split' ? '320px 1fr'
            : filtros.view_mode === 'grid' ? '1fr'
            : '1fr'
        }}
      >
        {filtros.view_mode !== 'mapa' && (
          <div className="border-r border-border h-full overflow-hidden flex flex-col bg-bg-panel">
            <FotosGridVirtualizado
              fotos={fotos}
              onPick={(i) => setLightboxIdx(i)}
              loading={isFetching && fotos.length === 0}
              cols={filtros.view_mode === 'grid' ? 4 : 2}
            />
            <div ref={sentinel} className="h-2 shrink-0" />
            {isFetching && fotos.length > 0 && (
              <div className="px-2 py-1 text-2xs font-mono text-text-dim text-center">carregando…</div>
            )}
          </div>
        )}
        {filtros.view_mode !== 'grid' && (
          <div className="h-full w-full overflow-hidden">
            <MapaFotosSatelite
              fotos={fotos}
              onPickFoto={(i) => setLightboxIdx(i)}
              layoutKey={filtros.view_mode}
            />
          </div>
        )}
      </div>
      <FotoLightbox
        fotos={fotos}
        index={lightboxIdx}
        onClose={() => setLightboxIdx(null)}
        onIndexChange={setLightboxIdx}
      />
    </div>
  )
}

function ViewBtn({ cur, mode, onClick, children }: {
  cur: FotosViewMode; mode: FotosViewMode; onClick: (m: FotosViewMode) => void; children: ReactNode
}): ReactNode {
  const active = cur === mode
  return (
    <button
      onClick={() => onClick(mode)}
      className={cn(
        'px-2 py-1 text-xs font-mono transition-colors',
        active ? 'bg-accent/15 text-accent' : 'bg-bg-panel text-text-dim hover:text-text hover:bg-bg-hover'
      )}
    >
      {children}
    </button>
  )
}

function ServicosFiltro({
  opcoes, selecionados, onToggle, onClear
}: {
  opcoes: Array<[number, string]>
  selecionados: number[]
  onToggle: (id: number) => void
  onClear: () => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const display = selecionados.length === 0
    ? 'todos serviços'
    : selecionados.length === 1
      ? opcoes.find(([id]) => id === selecionados[0])?.[1] ?? '1 selec.'
      : `${selecionados.length} selec.`
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded border text-2xs font-mono',
          selecionados.length > 0
            ? 'border-accent/50 text-text bg-accent/5 hover:border-accent'
            : 'border-border text-text-dim hover:text-text hover:border-border-strong'
        )}
      >
        <span className="uppercase text-text-dim">Serviço:</span>
        <span className="truncate max-w-[160px]">{display}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 z-40 bg-bg-elevated border border-border-strong rounded shadow-xl min-w-[260px] max-h-[280px] overflow-auto p-1">
            <div className="px-2 py-1 border-b border-border flex items-center justify-between">
              <span className="text-2xs font-mono text-text-dim uppercase">Serviços</span>
              {selecionados.length > 0 && (
                <button onClick={onClear} className="text-2xs font-mono text-text-dim hover:text-danger">limpar</button>
              )}
            </div>
            {opcoes.length === 0 && (
              <div className="text-2xs font-mono text-text-dim p-2">sem serviços no período</div>
            )}
            {opcoes.map(([id, nome]) => {
              const checked = selecionados.includes(id)
              return (
                <label key={id} className="flex items-center gap-2 px-2 py-1 hover:bg-bg-hover cursor-pointer rounded text-xs">
                  <input type="checkbox" checked={checked} onChange={() => onToggle(id)} />
                  <span className="truncate">{nome}</span>
                </label>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
