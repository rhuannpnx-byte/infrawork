import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, Map as MapIcon, Columns } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { BarraFiltros, Filtro, FiltroMulti } from '@/components/ui/filtros'
import { RequireObra } from '@/components/layout/RequireObra'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useFotosInfinite } from '@/features/acompanhamento/hooks/fotos'
import { useProducao } from '@/features/acompanhamento/hooks/producao'
import {
  useFotosFiltrosStore,
  type FotosViewMode
} from '@/features/acompanhamento/stores/fotos-filtros'
import { useMapaPrefsStore } from '@/features/acompanhamento/stores/mapa-prefs'
import { agruparSequencias, producaoSemFoto } from '@/features/acompanhamento/lib/sequencia-ataque'
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

  const efFiltros: FotosListarFiltros = useMemo(
    () => ({
      data_de: filtros.data_de ?? undefined,
      data_ate: filtros.data_ate ?? undefined,
      item_ids: filtros.item_ids.length ? filtros.item_ids : undefined,
      equipe_ids: filtros.equipe_ids.length ? filtros.equipe_ids : undefined,
      encarregado_ids: filtros.encarregado_ids.length ? filtros.encarregado_ids : undefined,
      frente: filtros.frente ?? undefined,
      somente_geo: filtros.somente_geo || undefined
    }),
    [filtros]
  )

  const {
    data: pages,
    fetchNextPage,
    hasNextPage,
    isFetching
  } = useFotosInfinite(obraId, efFiltros)

  const fotos = useMemo<FotoEnriquecida[]>(
    () => (pages?.pages ?? []).flatMap((p) => p.fotos),
    [pages]
  )

  // Sequência de ataque — só é computada quando ligada nas preferências do mapa.
  const mostrarSeq = useMapaPrefsStore((s) => s.mostrarSequenciaAtaque)
  const { data: producoes = [] } = useProducao(obraId, {
    data_de: filtros.data_de ?? undefined,
    data_ate: filtros.data_ate ?? undefined
  })
  const sequencias = useMemo(
    () => (mostrarSeq ? agruparSequencias(fotos, producoes) : []),
    [mostrarSeq, fotos, producoes]
  )
  const avisosSemFoto = useMemo(
    () => (mostrarSeq ? producaoSemFoto(fotos, producoes) : []),
    [mostrarSeq, fotos, producoes]
  )

  // Catálogo de serviços do dataset atual (para o filtro)
  const servicosDisponiveis = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of fotos) {
      if (f.item_orcamentario_id) {
        m.set(f.item_orcamentario_id, f.servico_display_nome ?? f.servico_nome ?? 'Serviço')
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
        subtitle={`${fotos.length}${total > fotos.length ? ` de ${total}` : ''} ${(total > fotos.length ? total : fotos.length) === 1 ? 'foto' : 'fotos'}`}
        actions={
          <div className="inline-flex border border-border rounded overflow-hidden">
            <ViewBtn cur={filtros.view_mode} mode="split" onClick={setViewMode}>
              <Columns size={12} />
            </ViewBtn>
            <ViewBtn cur={filtros.view_mode} mode="grid" onClick={setViewMode}>
              <LayoutGrid size={12} />
            </ViewBtn>
            <ViewBtn cur={filtros.view_mode} mode="mapa" onClick={setViewMode}>
              <MapIcon size={12} />
            </ViewBtn>
          </div>
        }
      />
      <BarraFiltros>
        <Filtro rotulo="Período">
          <DateRangePopover
            from={filtros.data_de}
            to={filtros.data_ate}
            onChange={setDataRange}
            placeholder="Todo o período"
          />
        </Filtro>
        <FiltroMulti
          rotulo="Serviços"
          opcoes={servicosDisponiveis.map(([id, nome]) => ({ valor: id, rotulo: nome }))}
          selecionados={filtros.item_ids}
          aoMudar={setServicos}
        />
        <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
          <input
            type="checkbox"
            className="size-4 accent-[color:var(--accent)]"
            checked={filtros.somente_geo}
            onChange={(e) => setSomenteGeo(e.target.checked)}
          />
          Só fotos com GPS
        </label>
      </BarraFiltros>

      <div
        className="flex-1 grid overflow-hidden"
        style={{
          gridTemplateColumns:
            filtros.view_mode === 'split'
              ? '320px 1fr'
              : filtros.view_mode === 'grid'
                ? '1fr'
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
              <div className="px-2 py-1 text-2xs font-mono text-text-dim text-center">
                carregando…
              </div>
            )}
          </div>
        )}
        {filtros.view_mode !== 'grid' && (
          <div className="h-full w-full overflow-hidden">
            <MapaFotosSatelite
              fotos={fotos}
              onPickFoto={(i) => setLightboxIdx(i)}
              layoutKey={filtros.view_mode}
              sequencias={sequencias}
              avisosSemFoto={avisosSemFoto}
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

function ViewBtn({
  cur,
  mode,
  onClick,
  children
}: {
  cur: FotosViewMode
  mode: FotosViewMode
  onClick: (m: FotosViewMode) => void
  children: ReactNode
}): ReactNode {
  const active = cur === mode
  return (
    <button
      onClick={() => onClick(mode)}
      className={cn(
        'px-2 py-1 text-xs font-mono transition-colors',
        active
          ? 'bg-accent/15 text-accent'
          : 'bg-bg-panel text-text-dim hover:text-text hover:bg-bg-hover'
      )}
    >
      {children}
    </button>
  )
}
