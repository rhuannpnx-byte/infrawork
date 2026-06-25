import { useMemo, useState, useCallback, type ReactNode } from 'react'
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { EmptyState } from '@/components/layout/EmptyState'
import type { ObraDossier } from '@/types/documentacao'
import { useDocumentacaoUIStore } from '@/stores/documentacao-ui-store'

// Cor do nó por tipo (tokens do tema InfraWork).
const COR: Record<string, { bg: string; bd: string }> = {
  contrato: { bg: 'oklch(34% 0.07 255)', bd: 'oklch(67% 0.18 255)' },
  grupo: { bg: 'oklch(31% 0.06 175)', bd: 'oklch(70% 0.13 175)' },
  empresa: { bg: 'oklch(30% 0.09 290)', bd: 'oklch(70% 0.16 290)' },
  profissional: { bg: 'oklch(32% 0.08 240)', bd: 'oklch(72% 0.15 240)' },
  documento: { bg: 'oklch(27% 0.02 255)', bd: 'oklch(55% 0.04 255)' },
  default: { bg: 'oklch(30% 0.06 175)', bd: 'oklch(70% 0.13 175)' }
}

function estilo(tipo: string, destaque = false): React.CSSProperties {
  const c = COR[tipo] ?? COR.default
  const isContrato = tipo === 'contrato'
  return {
    background: c.bg,
    border: `${isContrato ? 2 : 1.5}px solid ${destaque ? 'oklch(80% 0.15 255)' : c.bd}`,
    borderRadius: tipo === 'documento' ? 6 : 10,
    color: 'oklch(95% 0.01 255)',
    fontSize: tipo === 'documento' ? 9 : isContrato ? 12 : 11,
    fontWeight: isContrato ? 700 : 600,
    padding: tipo === 'documento' ? '5px 8px' : '8px 12px',
    width: 'auto',
    minWidth: tipo === 'documento' ? 80 : isContrato ? 120 : 100,
    maxWidth: 200,
    textAlign: 'center',
    cursor: tipo === 'grupo' || tipo === 'documento' ? 'pointer' : 'default'
  }
}

interface Props {
  dossie: ObraDossier
}

export function GrafoTab({ dossie }: Props): ReactNode {
  const abrir = useDocumentacaoUIStore((s) => s.abrir)
  const [expandido, setExpandido] = useState<Set<string>>(new Set())

  const onNodeClick = useCallback(
    (_e: unknown, node: Node): void => {
      const tipo = (node.data as { tipo?: string }).tipo
      if (tipo === 'grupo') {
        const cod = (node.data as { grupo_codigo?: string }).grupo_codigo
        if (!cod) return
        setExpandido((p) => {
          const n = new Set(p)
          if (n.has(cod)) n.delete(cod)
          else n.add(cod)
          return n
        })
      } else if (tipo === 'documento') {
        const docId = (node.data as { doc_id?: string }).doc_id
        if (docId) abrir(docId, null)
      }
    },
    [abrir]
  )

  const { nodes, edges } = useMemo(() => {
    const g = dossie.grafo ?? { nos: [], arestas: [] }
    const centro = g.nos.find((n) => n.no_id === 'contrato')
    // Anel: hubs de grupo primeiro (por peso), depois entidades.
    const anel = g.nos.filter((n) => n.tipo !== 'contrato')
    const R = 340

    const nodes: Node[] = []
    nodes.push({
      id: 'contrato',
      position: { x: 0, y: 0 },
      data: { label: centro?.label ?? 'Contrato', tipo: 'contrato' },
      style: estilo('contrato'),
      draggable: true
    })

    const docsPorGrupo = new Map<string, typeof dossie.documentos>()
    for (const d of dossie.documentos) {
      const k = d.grupo_codigo ?? d.tipo_codigo
      const arr = docsPorGrupo.get(k) ?? []
      arr.push(d)
      docsPorGrupo.set(k, arr)
    }

    anel.forEach((n, i) => {
      const ang = (i / Math.max(1, anel.length)) * Math.PI * 2 - Math.PI / 2
      const x = Math.cos(ang) * R
      const y = Math.sin(ang) * R
      const aberto = n.tipo === 'grupo' && n.grupo_codigo ? expandido.has(n.grupo_codigo) : false
      nodes.push({
        id: n.no_id,
        position: { x, y },
        data: {
          label: `${n.label}${n.sub ? `\n${n.sub}` : ''}`,
          tipo: n.tipo,
          grupo_codigo: n.grupo_codigo
        },
        style: estilo(n.tipo, aberto)
      })

      // Expansão client-side: documentos do grupo em arco externo ao hub.
      if (aberto && n.grupo_codigo) {
        const docs = (docsPorGrupo.get(n.grupo_codigo) ?? []).slice(0, 24)
        const R2 = R + 230
        const span = Math.min(Math.PI / 2, 0.28 * docs.length)
        docs.forEach((d, j) => {
          const a2 = ang + (docs.length > 1 ? (j / (docs.length - 1) - 0.5) * span : 0)
          nodes.push({
            id: `doc_${d.doc_id}`,
            position: { x: Math.cos(a2) * R2, y: Math.sin(a2) * R2 },
            data: { label: d.titulo ?? d.nome ?? 'Documento', tipo: 'documento', doc_id: d.doc_id },
            style: estilo('documento')
          })
        })
      }
    })

    const idsValidos = new Set(nodes.map((n) => n.id))
    const edges: Edge[] = g.arestas
      .filter((a) => idsValidos.has(a.de) && idsValidos.has(a.para))
      .map((a, i) => ({
        id: `e${i}`,
        source: a.de,
        target: a.para,
        label: a.rel,
        style: { stroke: 'oklch(45% 0.02 255)' },
        labelStyle: { fill: 'oklch(62% 0.02 255)', fontSize: 9 },
        labelBgStyle: { fill: 'transparent' }
      }))
    // Arestas documento → hub (expansão).
    for (const n of nodes) {
      const doc = n.data as { tipo?: string; doc_id?: string }
      if (doc.tipo === 'documento') {
        const hub = nodes.find(
          (h) =>
            (h.data as { tipo?: string }).tipo === 'grupo' &&
            dossie.documentos.find((d) => `doc_${d.doc_id}` === n.id)?.grupo_codigo ===
              (h.data as { grupo_codigo?: string }).grupo_codigo
        )
        if (hub)
          edges.push({
            id: `${n.id}-${hub.id}`,
            source: hub.id,
            target: n.id,
            style: { stroke: 'oklch(38% 0.02 255)' }
          })
      }
    }

    return { nodes, edges }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossie.grafo, dossie.documentos, expandido])

  if (nodes.length <= 1) {
    return (
      <EmptyState
        icon="share-2"
        title="Grafo ainda vazio"
        description="O grafo (Contrato no centro, hubs por grupo de documentos, consórcio e ARTs) é construído na ingestão e extração dos documentos."
      />
    )
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        onNodeClick={onNodeClick}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        nodesConnectable={false}
        nodesDraggable
        edgesFocusable={false}
      >
        <Background color="oklch(30% 0.01 255)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="absolute top-3 right-3 rounded bg-bg-panel/90 border border-border px-2.5 py-1.5 text-2xs text-text-dim pointer-events-none">
        Clique num <b className="text-accent">grupo</b> para expandir os documentos · clique num
        documento para abrir
      </div>
    </div>
  )
}
