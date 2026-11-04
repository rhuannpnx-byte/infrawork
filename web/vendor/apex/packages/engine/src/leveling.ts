/**
 * Nivelamento por recursos (RN-004, D-020/U-07b). Evidência: analises/2026-10-11_dynaroad/evidencias/decompilado/
 * distancias_tempo_extra/: TC::Crew::Crew @0x9fce90, Crew::FindSlot @0x9fd220, Crew::AddUsage @0x9fd190,
 * ResourceUsageCalculator::FindSlot @0x9eb130 / @0x9eb0b0, anon::FindSlotImpl @0x9eb2c0, AddUsage @0x9eaeb0 / @0x9eadf0,
 * TC::anon::AddResourceUsagesForSite @0x9f7820.
 *
 * - [O] equipe da tarefa = itens (sum task da tarefa, recurso, quantidade) de cada equipe selecionada com uso em
 *   envio/recebimento/outras (máscara 0xb) + recursos identificados com uso nessa máscara.
 * - [O] com restrição, o uso só é registrado e consultado nas sum tasks (a da tarefa e as ancestrais) em que o recurso
 *   tem limite (`m_mQuantityRestrictions` > 0); recurso identificado tem limite 1 e uso 1.
 * - [O] o cronograma usa o calculador com "ignorar feriados": cada work place ocupa o intervalo [início, fim) inteiro.
 * - [O] FindSlotImpl: janela [início, WS2AS(AS2WS(início) + dur, false)]; percorre os spans de uso que começam antes do
 *   fim da janela, do último para o primeiro, até um que termine em ou antes do início; o primeiro com
 *   uso + min(limite, necessário) > limite devolve o fim desse span. Repete por sum task e recurso até nenhum empurrar.
 * - [I] sum task da tarefa = a que a lista no seu WorkSiteContainer; GetQuantityRestriction(r, st) = valor do mapa
 *   para st, senão 0; spans somados por sobreposição (QuantitySpanContainer::MergeImpl não lido).
 */
import type { Calendar } from "@apex/calendar";

export interface Span {
  b: number;
  e: number;
  q: number;
}

/** QuantitySpanContainer<Date,double>: spans disjuntos ordenados; MergeImpl soma a quantidade na sobreposição [I]. */
export class SpanContainer {
  spans: Span[] = [];
  merge(b: number, e: number, q: number): void {
    if (q === 0 || !(b < e)) return;
    const cuts = new Set<number>([b, e]);
    for (const s of this.spans) if (s.e > b && s.b < e) cuts.add(s.b).add(s.e);
    const pts = [...cuts].sort((x, y) => x - y);
    const keep = this.spans.filter((s) => s.e <= b || s.b >= e);
    const touched = this.spans.filter((s) => s.e > b && s.b < e);
    const pieces: Span[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const x = pts[i]!, y = pts[i + 1]!;
      let qq = x >= b && y <= e ? q : 0;
      for (const s of touched) if (s.b <= x && y <= s.e) qq += s.q;
      if (qq !== 0) pieces.push({ b: x, e: y, q: qq });
    }
    this.spans = [...keep, ...pieces].sort((x, y) => x.b - y.b);
  }
}

/** anon::FindSlotImpl @0x9eb2c0. */
export function findSlotImpl(c: SpanContainer | undefined, limit: number, need: number, start: number, dur: number, cal: Calendar): number {
  if (!c || c.spans.length === 0) return start;
  const end = dur !== 0 ? cal.WS2AS(cal.AS2WS(start) + dur, false) : start;
  const take = Math.min(limit, need);
  for (let i = c.spans.length - 1; i >= 0; i--) {
    const s = c.spans[i]!;
    if (s.b >= end) continue;
    if (s.e <= start) break;
    if (limit < s.q + take) return s.e;
  }
  return start;
}

export interface CrewItem {
  sumTask: bigint | undefined;
  resource: bigint;
  count: number;
}
export interface Crew {
  items: CrewItem[];
  identified: bigint[];
}

/** ResourceUsageCalculator (m_bConstraint; m_bIgnoreHolidays = true no cronograma). */
export class ResourceUsage {
  private readonly items = new Map<string, SpanContainer>();
  private readonly identified = new Map<bigint, SpanContainer>();
  constructor(
    readonly constraint: boolean,
    private readonly restriction: (resource: bigint, sumTask: bigint) => number,
    private readonly parentOf: (sumTask: bigint) => bigint | undefined,
  ) {}

  private chain(st: bigint | undefined): bigint[] {
    const out: bigint[] = [];
    const seen = new Set<bigint>();
    for (let s = st; s !== undefined && !seen.has(s); s = this.parentOf(s)) {
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  /** AddUsage @0x9eaeb0 (recurso) e @0x9eadf0 (identificado), sem calendário. */
  addCrew(crew: Crew, b: number, e: number, factor = 1): void {
    for (const it of crew.items)
      for (const st of this.chain(it.sumTask)) {
        if (this.constraint && !(this.restriction(it.resource, st) > 0)) continue;
        const k = `${st}:${it.resource}`;
        let c = this.items.get(k);
        if (!c) this.items.set(k, (c = new SpanContainer()));
        c.merge(b, e, it.count * factor);
      }
    for (const r of crew.identified) {
      let c = this.identified.get(r);
      if (!c) this.identified.set(r, (c = new SpanContainer()));
      c.merge(b, e, factor);
    }
  }

  /** AddUsage @0x9eaeb0 de um recurso só (caminhões, HaulResourceCalculator::Calculate). */
  addResource(sumTask: bigint | undefined, resource: bigint, q: number, b: number, e: number): void {
    this.addCrew({ items: [{ sumTask, resource, count: q }], identified: [] }, b, e);
  }

  /** QuantitySpanContainer de (sum task, recurso). */
  usage(sumTask: bigint, resource: bigint): readonly Span[] {
    return this.items.get(`${sumTask}:${resource}`)?.spans ?? [];
  }

  identifiedUsage(resource: bigint): readonly Span[] {
    return this.identified.get(resource)?.spans ?? [];
  }

  /** ResourceUsageCalculator::FindSlot @0x9eb130 (recurso). */
  private findSlotItem(it: CrewItem, start: number, dur: number, cal: Calendar): number {
    if (!this.constraint || !(it.count > 0) || dur < 1) return start;
    for (;;) {
      let changed = false;
      for (const st of this.chain(it.sumTask)) {
        const lim = this.restriction(it.resource, st);
        if (!(lim > 0)) continue;
        const c = this.items.get(`${st}:${it.resource}`);
        if (!c) continue;
        const s = findSlotImpl(c, lim, it.count, start, dur, cal);
        if (s !== start) {
          start = s;
          changed = true;
        }
      }
      if (!changed) return start;
    }
  }

  /** TC::Crew::FindSlot @0x9fd220: até um ponto fixo sobre recursos e identificados. */
  findSlot(crew: Crew, start: number, dur: number, cal: Calendar): number {
    for (;;) {
      let stable = true;
      for (const it of crew.items) {
        const s = this.findSlotItem(it, start, dur, cal);
        if (s !== start) {
          start = s;
          stable = false;
        }
      }
      for (const r of crew.identified) {
        const s = this.constraint && dur >= 1 ? findSlotImpl(this.identified.get(r), 1, 1, start, dur, cal) : start;
        if (s !== start) {
          start = s;
          stable = false;
        }
      }
      if (stable) return start;
    }
  }
}
