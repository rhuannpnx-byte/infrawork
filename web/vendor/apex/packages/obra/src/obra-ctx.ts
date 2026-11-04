/**
 * U-24 (D-024) — contexto da montagem da obra (`obra-build.ts`): relatório (criados, atualizados, removidos, padrões
 * aplicados, decisões pendentes, itens deixados de fora, avisos), resolução de nomes e a saída de emergência
 * `fields`. Sem DOM.
 *
 * Regras de projeto [P] (a evidência não decide; relatório da U-24):
 * - referência por nome exato dentro da espécie; tipos aceitam o prefixo "source:/destination:/task:";
 * - dado sem padrão implícito faltando (montagem_obra.md §6) → decisão pendente com a pergunta; nunca um valor
 *   inventado. Bloqueante → nada é montado, salvo `allowPending`, que deixa de fora o objeto e o que depende dele;
 * - padrão do original aplicado (montagem_obra.md §5) → entra em `appliedDefaults`, agrupado por regra.
 */
import { FT, fieldsOfMember, type FieldValue } from "@apex/dr5";
import type { Entity, Project } from "@apex/model";
import { CreateError } from "./create.js";
import { jsonToField, type Json } from "./values-json.js";
import { allTypes, listOf, TYPE_KINDS, type O } from "./obra.js";
import { refs } from "./values.js";

export interface PendingDecision {
  id: string;
  /** caminho no documento (`tasks[3].work_places[0].quantity`) */
  path: string;
  /** pergunta para o usuário (o LLM a faz, não responde) */
  question: string;
  options?: unknown[];
  /** o que o original faria, se houver (não aplicado quando bloqueia) */
  default?: unknown;
  blocking: boolean;
}

export interface AppliedDefault {
  rule: string;
  value?: unknown;
  paths: string[];
}

export interface BuildReport {
  format: string;
  base: "current" | "empty";
  dryRun: boolean;
  /** o projeto foi alterado (falso em dry run e com decisão bloqueante sem allowPending) */
  built: boolean;
  created: Record<string, number>;
  updated: Record<string, number>;
  removed: Record<string, number>;
  appliedDefaults: AppliedDefault[];
  pendingDecisions: PendingDecision[];
  skipped: { path: string; reason: string }[];
  warnings: string[];
  undo?: string;
  next: string;
}

/** Documento inválido ou referência inexistente: nada é montado; a lista vai ao LLM. */
export class ObraError extends Error {
  constructor(readonly errors: string[]) {
    super(`The project data were not built (nothing changed):\n- ${errors.join("\n- ")}`);
    this.name = "ObraError";
  }
}

/** Objeto deixado de fora (decisão pendente nele ou em algo que ele referencia). */
export class Skip extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "Skip";
  }
}

export type LookupKind =
  | "unit" | "haul_cost" | "type" | "source_type" | "destination_type" | "task_type" | "calendar" | "resource" | "haul_resource" | "crew"
  | "location" | "road_line" | "area" | "intersection" | "sum_task" | "task" | "milestone" | "view_filter";

export class Ctx {
  readonly report: BuildReport;
  private seq = 0;
  /** nomes deixados de fora por espécie (quem os referencia também fica de fora) */
  readonly skippedNames = new Map<string, Set<string>>();
  /** tarefas do documento já montadas: caminho → entidade */
  readonly tasksByPath = new Map<string, Entity>();
  /** datas exatas pedidas (aplicadas no fim) */
  readonly exactDates: { wp: Entity; start?: bigint; finish?: bigint }[] = [];
  readonly taskDates: { task: Entity; path: string; start?: bigint; finish?: bigint }[] = [];
  /** locais cujas estacas estão pendentes (as tarefas neles ficam de fora com allowPending) */
  readonly pendingLocations = new Set<string>();
  /** motivos para deixar de fora o objeto em processamento (decisões dele ou do que ele usa) */
  private itemReasons: string[] = [];

  constructor(readonly p: Project, readonly doc: O, base: "current" | "empty", dryRun: boolean, readonly isNew: boolean, readonly finalMode: number) {
    this.report = {
      format: String(doc.format), base, dryRun, built: false, created: {}, updated: {}, removed: {}, appliedDefaults: [], pendingDecisions: [], skipped: [], warnings: [], next: "",
    };
  }

  // ---------- relatório ----------

  count(what: "created" | "updated" | "removed", kind: string, n = 1): void {
    const m = this.report[what];
    m[kind] = (m[kind] ?? 0) + n;
  }
  applied(rule: string, path: string, value?: unknown): void {
    const key = JSON.stringify(value ?? null);
    let d = this.report.appliedDefaults.find((x) => x.rule === rule && JSON.stringify(x.value ?? null) === key);
    if (!d) {
      d = { rule, ...(value !== undefined ? { value } : {}), paths: [] };
      this.report.appliedDefaults.push(d);
    }
    d.paths.push(path);
  }
  decide(d: Omit<PendingDecision, "id">): PendingDecision {
    const x: PendingDecision = { id: `D${++this.seq}`, ...d };
    this.report.pendingDecisions.push(x);
    return x;
  }
  /** decisão bloqueante: registra e deixa o objeto de fora */
  block(d: Omit<PendingDecision, "id" | "blocking">): never {
    const x = this.decide({ ...d, blocking: true });
    throw new Skip(`pending decision ${x.id}`);
  }
  /** decisão bloqueante sem interromper (para juntar todas as do objeto); `checkpoint` deixa o objeto de fora */
  pend(d: Omit<PendingDecision, "id" | "blocking">): void {
    const x = this.decide({ ...d, blocking: true });
    this.itemReasons.push(`pending decision ${x.id}`);
  }
  /** o objeto fica de fora por causa de outro (sem decisão nova); `checkpoint` o deixa de fora */
  blockedBy(reason: string): void {
    if (!this.itemReasons.includes(reason)) this.itemReasons.push(reason);
  }
  checkpoint(): void {
    if (this.itemReasons.length) throw new Skip(this.itemReasons.join("; "));
  }
  warn(msg: string): void {
    if (!this.report.warnings.includes(msg)) this.report.warnings.push(msg);
  }
  skipName(kind: string, name: string | undefined): void {
    if (!name) return;
    if (!this.skippedNames.has(kind)) this.skippedNames.set(kind, new Set());
    this.skippedNames.get(kind)!.add(name);
  }

  /**
   * Processa um objeto do documento: decisão bloqueante → fica de fora (e o nome também, para quem o referencia);
   * erro do domínio → `ObraError` com o caminho (nada é montado).
   */
  item<T>(path: string, kind: string, name: string | undefined, fn: () => T): T | undefined {
    const outer = this.itemReasons;
    this.itemReasons = [];
    try {
      return fn();
    } catch (e) {
      if (e instanceof Skip) {
        this.report.skipped.push({ path, reason: e.reason });
        this.skipName(kind, name);
        return undefined;
      }
      if (e instanceof ObraError) throw e;
      if (e instanceof CreateError) throw new ObraError([`${path}: ${e.message}${e.hint ? ` (${e.hint})` : ""}`]);
      throw new ObraError([`${path}: ${(e as Error).message}`]);
    } finally {
      this.itemReasons = outer;
    }
  }

  // ---------- nomes ----------

  pool(kind: LookupKind): Entity[] {
    const p = this.p;
    switch (kind) {
      case "unit": {
        const root = p.root()!;
        const mass = ["m_pCutUnit", "m_pFillUnit", "m_pCrushUnit", "m_pHaulUnit"].map((m) => p.resolve(root.get(m) as bigint)).filter((e): e is Entity => !!e);
        return [...mass, ...listOf(p, "m_vpUnits").filter((u) => !mass.includes(u))];
      }
      case "haul_cost": return listOf(p, "m_vpPriceVectors");
      case "type": return allTypes(p);
      case "source_type": return listOf(p, "m_vpSourceLandTypes");
      case "destination_type": return listOf(p, "m_vpDestLandTypes");
      case "task_type": return listOf(p, "m_vpWorkTypes");
      case "calendar": return refs(p.resolve(p.root()!.get("m_pCalendarManager") as bigint)?.get("m_vpCalendars")).map((o) => p.get(o)).filter((e): e is Entity => !!e);
      case "resource": return listOf(p, "m_vpResources");
      case "haul_resource": return listOf(p, "m_vpTransporters");
      case "crew": return listOf(p, "m_vpWorkGroups");
      case "road_line": return listOf(p, "m_vpRoadLines");
      case "area": return listOf(p, "m_vpAreas");
      case "location": return [...listOf(p, "m_vpRoadLines"), ...listOf(p, "m_vpAreas")];
      case "intersection": return listOf(p, "m_vpRoadConnections");
      case "sum_task": return p.byClass("SumTask");
      case "task": return ["LandCut", "Embankment", "MassExchange", "BorrowPit", "WasteLand", "StockPile", "CrushingPlant", "OtherWorkSite"].flatMap((c) => p.byClass(c));
      case "milestone": return listOf(p, "m_vpMilestones");
      case "view_filter": return listOf(p, "m_vpViewFilters").filter((f) => f.className === "ViewFilter");
    }
  }

  /** Objeto existente com esse nome (undefined se não há; erro se o nome é ambíguo). */
  find(kind: LookupKind, name: string, path: string): Entity | undefined {
    let pool = this.pool(kind);
    let want = name;
    if (kind === "type" || kind === "source_type" || kind === "destination_type" || kind === "task_type") {
      const m = /^(source|destination|task):(.+)$/.exec(name);
      if (m && !pool.some((e) => e.name === name)) {
        const cls = TYPE_KINDS.find((k) => k.prefix === m[1])!.cls;
        pool = pool.filter((e) => e.className === cls);
        want = m[2]!;
      }
    }
    const hits = pool.filter((e) => e.name === want);
    if (hits.length > 1) throw new ObraError([`${path}: ${hits.length} objects named "${name}" (${kind}); names must be unique${kind === "type" ? ' — write "source:<name>", "destination:<name>" or "task:<name>"' : ""}`]);
    return hits[0];
  }

  /** Referência obrigatória: o objeto, ou Skip se ficou de fora, ou erro de referência. */
  ref(kind: LookupKind, name: unknown, path: string): Entity {
    if (typeof name !== "string" || !name) throw new ObraError([`${path}: expected the name of a ${kind.replace("_", " ")}`]);
    const e = this.find(kind, name, path);
    if (e) return e;
    const skippedKinds = kind === "location" ? ["road_line", "area", "location"] : kind === "type" ? ["source_type", "destination_type", "task_type", "type"] : [kind];
    if (skippedKinds.some((k) => this.skippedNames.get(k)?.has(name))) throw new Skip(`${kind.replace("_", " ")} "${name}" was left out`);
    const known = this.pool(kind).slice(0, 30).map((x) => x.name);
    throw new ObraError([`${path}: no ${kind.replace("_", " ")} named "${name}"${known.length ? ` (existing: ${known.join(", ")}${this.pool(kind).length > 30 ? ", …" : ""})` : ""}`]);
  }

  // ---------- saída de emergência ----------

  /** `fields`: membro → valor (codificação de get_objects), só escalares; referências usam as chaves com nome. */
  applyFields(e: Entity, fields: unknown, path: string): void {
    if (fields === undefined) return;
    const hasRef = (j: unknown): boolean => (Array.isArray(j) ? j.some(hasRef) : j !== null && typeof j === "object" ? "ref" in (j as object) || Object.values(j as object).some(hasRef) : false);
    for (const [m, v] of Object.entries(fields as Record<string, Json>)) {
      const spec = fieldsOfMember(e.classId, m);
      const existing = e.field(m);
      const tag = existing?.type ?? spec[spec.length - 1]?.tag;
      if (tag === undefined) throw new ObraError([`${path}.fields.${m}: ${e.className} has no member ${m} (see get_class_schema)`]);
      if (tag === FT.POINTER64 || tag === FT.POINTER32 || tag === FT.REFERENCE_OLD || hasRef(v)) throw new ObraError([`${path}.fields.${m}: references are not allowed in fields; use the named keys`]);
      let value: FieldValue;
      try {
        value = jsonToField(tag, v, existing?.value);
      } catch (err) {
        throw new ObraError([`${path}.fields.${m}: ${(err as Error).message}`]);
      }
      e.setRaw(m, value);
    }
  }
}
