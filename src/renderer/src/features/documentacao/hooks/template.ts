// Template de extração — CRUD por obra + base por empresa + copiar entre obras.
// Acesso direto ao Supabase (RLS por empresa). O DEFAULT vem de
// types/documentacao-template (base global de origem).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import {
  DEFAULT_TEMPLATE_CAMPOS,
  DEFAULT_TEMPLATE_GRUPOS,
  TemplateSchema,
  type Template,
  type TemplateCampo,
  type GrupoTemplate
} from '@/types/documentacao-template'

function cli(): NonNullable<typeof supabase> {
  if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')
  return supabase
}

async function obraEmpresaId(obraId: string): Promise<string | null> {
  const { data } = await cli().from('obras').select('empresa_id').eq('id', obraId).maybeSingle()
  return (data?.empresa_id as string) ?? null
}

/** Lê o template da obra; se não existir, clona do base da empresa (ou do DEFAULT). */
export async function ensureTemplate(obraId: string): Promise<Template> {
  const c = cli()
  const { data: existente } = await c
    .from('extracao_template')
    .select('*')
    .eq('obra_id', obraId)
    .maybeSingle()
  if (existente) {
    const t = TemplateSchema.parse(existente)
    // Backfill lazy: templates anteriores à camada de grupos vêm sem grupos.
    if (!t.grupos?.length) {
      await c
        .from('extracao_template')
        .update({ grupos: DEFAULT_TEMPLATE_GRUPOS, atualizado_em: new Date().toISOString() })
        .eq('obra_id', obraId)
      return { ...t, grupos: DEFAULT_TEMPLATE_GRUPOS }
    }
    return t
  }

  // procura base da empresa da obra
  const empresaId = await obraEmpresaId(obraId)
  let campos: TemplateCampo[] = DEFAULT_TEMPLATE_CAMPOS
  let grupos: GrupoTemplate[] = DEFAULT_TEMPLATE_GRUPOS
  if (empresaId) {
    const { data: base } = await c
      .from('extracao_template')
      .select('campos, grupos')
      .is('obra_id', null)
      .eq('empresa_id', empresaId)
      .maybeSingle()
    if (base?.campos && Array.isArray(base.campos) && base.campos.length) {
      campos = base.campos as TemplateCampo[]
    }
    if (base?.grupos && Array.isArray(base.grupos) && base.grupos.length) {
      grupos = base.grupos as GrupoTemplate[]
    }
  }
  const { data: novo, error } = await c
    .from('extracao_template')
    .insert({ obra_id: obraId, nome: 'Template da obra', campos, grupos })
    .select('*')
    .single()
  if (error) throw error
  return TemplateSchema.parse(novo)
}

/** Campos do template aplicável à obra (usado pelo pipeline de ingestão). */
export async function ensureTemplateCampos(obraId: string): Promise<TemplateCampo[]> {
  const t = await ensureTemplate(obraId)
  return t.campos
}

/** Grupos do template aplicável à obra. */
export async function ensureTemplateGrupos(obraId: string): Promise<GrupoTemplate[]> {
  const t = await ensureTemplate(obraId)
  return t.grupos
}

export function useTemplate(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Template>> {
  return useQuery({
    queryKey: ['documentacao', 'template', obraId],
    enabled: !!obraId && SUPABASE_ENABLED,
    queryFn: () => ensureTemplate(obraId!)
  })
}

export function useSalvarTemplate(): ReturnType<
  typeof useMutation<
    void,
    Error,
    { obra_id: string; campos?: TemplateCampo[]; grupos?: GrupoTemplate[]; versao: number }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ obra_id, campos, grupos, versao }) => {
      const patch: Record<string, unknown> = {
        versao: versao + 1,
        atualizado_em: new Date().toISOString()
      }
      if (campos) patch.campos = campos
      if (grupos) patch.grupos = grupos
      const { error } = await cli().from('extracao_template').update(patch).eq('obra_id', obra_id)
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      void qc.invalidateQueries({ queryKey: ['documentacao', 'template', v.obra_id] })
  })
}

/** Copia os campos do template de outra obra para esta. */
export function useCopiarTemplate(): ReturnType<
  typeof useMutation<void, Error, { de_obra_id: string; para_obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ de_obra_id, para_obra_id }) => {
      const c = cli()
      const { data: origem, error: e1 } = await c
        .from('extracao_template')
        .select('campos, grupos, versao')
        .eq('obra_id', de_obra_id)
        .maybeSingle()
      if (e1) throw e1
      if (!origem) throw new Error('Obra de origem não tem template.')
      // garante a linha de destino e sobrescreve campos + grupos
      await ensureTemplate(para_obra_id)
      const { error: e2 } = await c
        .from('extracao_template')
        .update({
          campos: origem.campos,
          grupos: origem.grupos ?? DEFAULT_TEMPLATE_GRUPOS,
          versao: (origem.versao ?? 1) + 1,
          atualizado_em: new Date().toISOString()
        })
        .eq('obra_id', para_obra_id)
      if (e2) throw e2
    },
    onSuccess: (_d, v) =>
      void qc.invalidateQueries({ queryKey: ['documentacao', 'template', v.para_obra_id] })
  })
}

/** Restaura o template da obra para o DEFAULT (base global de origem). */
export function useResetTemplate(): ReturnType<
  typeof useMutation<void, Error, { obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ obra_id }) => {
      await ensureTemplate(obra_id)
      const { error } = await cli()
        .from('extracao_template')
        .update({
          campos: DEFAULT_TEMPLATE_CAMPOS,
          grupos: DEFAULT_TEMPLATE_GRUPOS,
          atualizado_em: new Date().toISOString()
        })
        .eq('obra_id', obra_id)
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      void qc.invalidateQueries({ queryKey: ['documentacao', 'template', v.obra_id] })
  })
}

export interface ObraComTemplate {
  obra_id: string
  nome: string
  codigo: string | null
}

/** Obras (≠ atual) que têm template, para o seletor de "copiar de". */
export function useObrasComTemplate(
  exclObraId: string | null | undefined
): ReturnType<typeof useQuery<ObraComTemplate[]>> {
  return useQuery({
    queryKey: ['documentacao', 'template-obras', exclObraId],
    enabled: SUPABASE_ENABLED,
    queryFn: async (): Promise<ObraComTemplate[]> => {
      const { data, error } = await cli()
        .from('extracao_template')
        .select('obra_id, obras!inner(nome, codigo)')
        .not('obra_id', 'is', null)
      if (error) throw error
      type Row = {
        obra_id: string
        obras:
          | { nome: string; codigo: string | null }
          | { nome: string; codigo: string | null }[]
          | null
      }
      return ((data ?? []) as unknown as Row[])
        .filter((r) => r.obra_id !== exclObraId)
        .map((r) => {
          const o = Array.isArray(r.obras) ? r.obras[0] : r.obras
          return { obra_id: r.obra_id, nome: o?.nome ?? '—', codigo: o?.codigo ?? null }
        })
    }
  })
}
