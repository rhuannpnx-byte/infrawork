import { useMemo, useState, type ReactNode } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { PlusCircle, Truck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import type { TableExportConfig } from '@/components/data-table/export-types'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { formatNumber } from '@/lib/format'
import { hojeLocalISO } from '@/lib/format/local-date'
import { formatMarcadorCompacto } from '@/lib/format/posicao'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { ctxObraTrecho } from '@/features/planejamento/lib/trecho'
import { useServicosParametrizaveis } from '@/features/planejamento/hooks/parametros'
import {
  useFichasViagens,
  useFrota,
  useLocaisTransporte,
  type FichaViagens,
  type Viagem
} from '@/features/acompanhamento/hooks/viagens'
import { FichaDialog } from '@/features/acompanhamento/components/viagens/FichaDialog'

export function AcompanhamentoViagensPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro', 'apoio']} pageTitle="Viagens">
      <RequireObra pageTitle="Viagens">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

/** Linha da tabela com os textos já resolvidos (a tabela guarda o valor das células por linha). */
interface LinhaTabela {
  key: string
  ficha: FichaViagens
  v: Viagem
  n: number
  veiculo: string
  servico: string
  origem: string
  destino: string
  estacaCarga: string
  estacaDescarga: string
  unidade: string
}

const ORIGEM_DMT: Record<string, string> = {
  geometria: 'pelo eixo',
  rota: 'distância fixa',
  manual: 'ajustada'
}

const menosDias = (iso: string, d: number): string => {
  const x = new Date(iso + 'T12:00:00')
  x.setDate(x.getDate() - d)
  return x.toISOString().slice(0, 10)
}
const fmtBR = (iso: string): string => iso.split('-').reverse().join('/')

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const uid = useAuthStore((s) => s.profile?.id ?? null)
  const [de, setDe] = useState(menosDias(hojeLocalISO(), 6))
  const [ate, setAte] = useState(hojeLocalISO())
  const [aberta, setAberta] = useState<{ ficha: FichaViagens | null } | null>(null)
  const fichas = useFichasViagens(obraId, de, ate)
  const { data: servicos = [] } = useServicosParametrizaveis(obraId)
  const { data: frota = [] } = useFrota(scope.empresaId)
  const { data: transp } = useLocaisTransporte(obraId)
  const { data: trechos = [] } = useObraTrechos(obraId)

  const nomeServico = (id: string): string => {
    const s = servicos.find((x) => x.id === id)
    return s ? `${s.codigo} ${s.descricao}` : '—'
  }
  const unidade = (id: string): string => servicos.find((x) => x.id === id)?.unidade ?? ''
  const nomeLocal = (id: string | null): string =>
    (id && transp?.locais.find((l) => l.id === id)?.nome) || '—'
  const veiculo = (id: string | null): string => {
    const v = frota.find((x) => x.id === id)
    return v ? `${v.prefixo}${v.placa ? ` · ${v.placa}` : ''}` : '—'
  }
  /** estaca da ponta na pista; fora dela, o nome do local já diz onde é */
  const estaca = (localId: string | null, m: number | null): string => {
    const l = transp?.locais.find((x) => x.id === localId)
    const t = trechos.find((x) => x.id === l?.trecho_id)
    return t && m !== null ? formatMarcadorCompacto(m, ctxObraTrecho(t)) : ''
  }
  const podeEditar = (f: FichaViagens): boolean =>
    role === 'god' ||
    role === 'adm' ||
    role === 'engenheiro' ||
    (role === 'apoio' && f.criado_por === uid)

  const linhas: LinhaTabela[] = (fichas.data ?? []).flatMap((f) =>
    f.viagens.map((v, i) => ({
      key: v.id,
      ficha: f,
      v,
      n: i + 1,
      veiculo: veiculo(f.veiculo_id),
      servico: nomeServico(v.item_orcamentario_id),
      origem: nomeLocal(v.origem_id),
      destino: nomeLocal(v.destino_id),
      estacaCarga: estaca(v.origem_id, v.estaca_carga_m),
      estacaDescarga: estaca(v.destino_id, v.estaca_descarga_m),
      unidade: unidade(v.item_orcamentario_id)
    }))
  )
  // total do período por serviço
  const totais = useMemo(() => {
    const m = new Map<string, { qtd: number; n: number }>()
    for (const l of linhas) {
      const t = m.get(l.v.item_orcamentario_id) ?? { qtd: 0, n: 0 }
      t.qtd += l.v.quantidade
      t.n += 1
      m.set(l.v.item_orcamentario_id, t)
    }
    return [...m.entries()]
  }, [linhas])

  const columns: ColumnDef<LinhaTabela>[] = [
    {
      header: 'Data',
      accessorFn: (r) => r.ficha.data,
      cell: ({ row }) => fmtBR(row.original.ficha.data)
    },
    { header: 'Veículo', accessorKey: 'veiculo' },
    { header: 'Motorista', accessorFn: (r) => r.ficha.motorista ?? '' },
    { header: '#', accessorFn: (r) => r.n },
    { header: 'Serviço', accessorKey: 'servico' },
    { header: 'Origem', accessorKey: 'origem' },
    { header: 'Est. carga', accessorKey: 'estacaCarga' },
    { header: 'Destino', accessorKey: 'destino' },
    { header: 'Est. descarga', accessorKey: 'estacaDescarga' },
    {
      header: 'Horário',
      accessorFn: (r) =>
        [r.v.hora_carga?.slice(0, 5), r.v.hora_descarga?.slice(0, 5)].filter(Boolean).join(' → ')
    },
    {
      header: 'Qtd',
      accessorFn: (r) => r.v.quantidade,
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">
          {formatNumber(row.original.v.quantidade, 2)} {row.original.unidade}
        </span>
      )
    },
    {
      header: 'DMT',
      accessorFn: (r) => r.v.dmt_km,
      cell: ({ row }) => {
        const v = row.original.v
        if (v.dmt_km === null) return ''
        return (
          <span
            className="font-mono tabular-nums"
            title={
              v.dmt_manual && v.dmt_calculada_km !== null
                ? `ajustada; calculada ${formatNumber(v.dmt_calculada_km, 3)} km`
                : undefined
            }
          >
            {formatNumber(v.dmt_km, 3)} km
            <span className="ml-1 font-sans text-2xs text-text-dim">
              {ORIGEM_DMT[v.dmt_origem ?? ''] ?? ''}
            </span>
          </span>
        )
      }
    },
    { header: 'NF/ticket', accessorFn: (r) => r.v.nf_ticket ?? '' },
    { header: 'Origem do registro', accessorFn: (r) => r.ficha.origem }
  ]

  const getExportConfig = (visiveis: LinhaTabela[]): TableExportConfig => ({
    filenameBase: `viagens-${de}-a-${ate}`,
    titulo: 'Registro de viagens',
    obraNome: scope.obra?.nome ?? '',
    colunas: [
      { header: 'Data' },
      { header: 'Veículo' },
      { header: 'Motorista' },
      { header: 'Viagem', numFmt: '0' },
      { header: 'Serviço' },
      { header: 'Origem' },
      { header: 'Estaca de carga' },
      { header: 'Destino' },
      { header: 'Estaca de descarga' },
      { header: 'Hora carga' },
      { header: 'Hora descarga' },
      { header: 'Quantidade', numFmt: '#,##0.00' },
      { header: 'Unid.' },
      { header: 'Material', numFmt: '#,##0.00' },
      { header: 'DMT (km)', numFmt: '#,##0.000' },
      { header: 'Cálculo da DMT' },
      { header: 'DMT calculada (km)', numFmt: '#,##0.000' },
      { header: 'NF/ticket' }
    ],
    linhas: visiveis.map((r) => [
      fmtBR(r.ficha.data),
      r.veiculo,
      r.ficha.motorista ?? '',
      r.n,
      r.servico,
      r.origem,
      r.estacaCarga,
      r.destino,
      r.estacaDescarga,
      r.v.hora_carga?.slice(0, 5) ?? '',
      r.v.hora_descarga?.slice(0, 5) ?? '',
      r.v.quantidade,
      r.unidade,
      r.v.material_qtd,
      r.v.dmt_km,
      ORIGEM_DMT[r.v.dmt_origem ?? ''] ?? '',
      r.v.dmt_calculada_km,
      r.v.nf_ticket ?? ''
    ])
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Viagens"
        subtitle={`${scope.obra?.nome ?? ''} — registro de viagens (carreteiros). A produção do dia dos serviços por viagens é a soma das viagens.`}
        actions={
          role !== 'cliente' ? (
            <Button size="sm" onClick={() => setAberta({ ficha: null })}>
              <PlusCircle size={13} /> Nova ficha
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <DateRangePopover
          from={de}
          to={ate}
          onChange={(a, b) => {
            setDe(a ?? menosDias(hojeLocalISO(), 6))
            setAte(b ?? hojeLocalISO())
          }}
        />
        <span className="font-mono text-2xs text-text-dim">
          {fichas.data?.length ?? 0} ficha(s) · {linhas.length} viagem(ns)
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {totais.map(([id, t]) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded border border-border bg-bg-panel px-2 py-0.5 text-2xs"
            >
              <Truck size={11} className="text-accent" />
              <span className="text-text">{nomeServico(id)}</span>
              <span className="font-mono text-text-muted">
                {formatNumber(t.qtd, 2)} {unidade(id)} · {t.n} vg
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 px-4 pb-4">
        <DataTable
          data={linhas}
          columns={columns}
          loading={fichas.isLoading}
          globalSearchPlaceholder="Buscar veículo, motorista, origem, destino…"
          onRowClick={(r) => (podeEditar(r.ficha) ? setAberta({ ficha: r.ficha }) : undefined)}
          emptyMessage="Sem viagens no período"
          emptyDescription="Lance pelo app de campo ou em Nova ficha."
          getExportConfig={getExportConfig}
        />
      </div>
      <FichaDialog
        open={!!aberta}
        onOpenChange={(o) => !o && setAberta(null)}
        obraId={obraId}
        empresaId={scope.empresaId}
        ficha={aberta?.ficha ?? null}
        podeExcluir={!!aberta?.ficha && podeEditar(aberta.ficha)}
      />
    </div>
  )
}
