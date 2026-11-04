/**
 * Projeto: o conjunto de objetos por OID, a conversão `.dr5 ↔ modelo` sem perda, o undo e os eventos.
 *
 * Undo (RN-027, RF-004; docs/analise_persistencia_dpl.md §4.1, fn:DPL_StateManager_Restore@008f23d0):
 * - cada `edit(nome, fn)` é um nível (BeginUndoLevel … CommitLatestUndoLevel);
 * - `NotifyChange` guarda o estado "antes" de um objeto uma vez por nível (copy-on-write);
 * - no commit, `Trim` descarta os estados ainda iguais ao atual (IsStillEqualToCreatedMemento compara os
 *   vetores de Field); nível vazio não entra na pilha;
 * - `while (count > 10) remove o mais antigo` (a exceção da seleção ativa é de interface, U-13);
 * - `Undo` monta o nível de redo com o estado atual e restaura; `Redo` faz o inverso.
 */
import {
  classIdByName, writeDpl, PROJECT_CLASS_ID, WRITE_CLIENT_VERSION, WRITE_FORMAT,
  type DplDocument, type Field, type WritableDocument,
} from "@apex/dr5";
import { Entity, type EditHost } from "./entity.js";
import { ModelError } from "./errors.js";
import { fieldsKey, fromNativeJson, toNativeJson, type NativeUi } from "./native-json.js";
import type { Ref } from "./values.js";

/** RN-027 / RNF-008. */
export const MAX_UNDO_LEVELS = 10;

type Snapshot = { classId: number; fields: Field[] } | null; // null = o objeto não existia
interface Level {
  name: string;
  before: Map<bigint, Snapshot>;
}

export interface ChangeEvent {
  /**
   * U-31: "pending" = gravação dentro da transação de um diálogo (ainda sem nível); "abort" = a transação foi cancelada.
   * U-45: "amend" = gravação fundida no nível de undo anterior (`undoLevel: false`), sem redesenho (`noUpdate`).
   */
  kind: "commit" | "undo" | "redo" | "pending" | "abort" | "amend";
  name: string;
  oids: bigint[];
}
export type ChangeListener = (e: ChangeEvent) => void;

const snapshot = (e: Entity): Snapshot => ({ classId: e.classId, fields: structuredClone(e.fields) });

export class Project implements EditHost {
  formatVersion: number;
  clientVersion: number;
  private readonly objects = new Map<bigint, Entity>();
  /** DV-011: instâncias removidas, para o undo devolver a mesma instância (quem guardou a referência continua válido). */
  private readonly removed = new Map<bigint, Entity>();
  private maxOid = 0n;
  /** U-24: posição de cada OID na ordem de inserção, para o undo devolver um objeto removido ao mesmo lugar */
  private readonly position = new Map<bigint, number>();
  private nextPosition = 0;
  private open: Level | null = null;
  private readonly undoStack: Level[] = [];
  private readonly redoStack: Level[] = [];
  private readonly listeners = new Set<ChangeListener>();
  private readonly settlers = new Set<() => void>();
  /** U-31: transação de diálogo aberta por `beginLevel`; `depth` > 0 enquanto o diálogo grava (`transact`/`trial`) */
  private txn: { depth: number } | null = null;
  /** U-31: subníveis de `trial` aninhados no nível aberto (guardam o estado anterior só do que a prévia mexeu) */
  private readonly subs: Level[] = [];

  constructor(formatVersion: number = WRITE_FORMAT, clientVersion: number = WRITE_CLIENT_VERSION) {
    this.formatVersion = formatVersion;
    this.clientVersion = clientVersion;
  }

  // ---------- conversão .dr5 ↔ modelo ----------

  /** RF-001/RF-003: objetos do documento lido, com os campos intactos. */
  static fromDr5(doc: Pick<DplDocument, "formatVersion" | "clientVersion" | "records">): Project {
    const p = new Project(doc.formatVersion, doc.clientVersion);
    for (const r of doc.records) p.insert(r.oid, r.classId, r.fields);
    return p;
  }

  /**
   * RF-006: qualquer `.dr5` serve de template (documentacao_mapa.md §2.1). Abre o arquivo como projeto novo,
   * sem histórico. A importação parcial do diálogo `TemplateImportDlg` (escolher partes) é [D] e fica para a U-13.
   */
  static fromTemplate(doc: Pick<DplDocument, "formatVersion" | "clientVersion" | "records">): Project {
    return Project.fromDr5(doc);
  }

  /** Documento para o escritor. Na gravação, só o alcançável a partir do Project vai para o arquivo (RN-025). */
  toDr5(): WritableDocument {
    return {
      formatVersion: this.formatVersion,
      clientVersion: this.clientVersion,
      records: [...this.objects.values()].map((e) => ({ offset: 0, size: 0, oid: e.oid, classId: e.classId, fields: e.fields })),
    };
  }

  /** Payload DPL pronto (RF-002), podado a partir do Project. */
  toDpl(): Uint8Array {
    const root = this.root();
    return writeDpl(this.toDr5(), root ? { reachableFrom: root.oid } : {});
  }

  /** @internal usado na leitura (.dr5 e .apex.json); não registra undo. */
  insert(oid: bigint, classId: number, fields: Field[]): Entity {
    const e = new Entity(oid, classId, fields, this);
    this.objects.set(oid, e);
    if (!this.position.has(oid)) this.position.set(oid, this.nextPosition++);
    if (oid > this.maxOid) this.maxOid = oid;
    return e;
  }

  /** @internal remoção sem undo (migração de carga). */
  drop(oid: bigint): void {
    this.objects.delete(oid);
  }

  /** `.apex.json` (formato nativo, com SHA-256). */
  toNativeJson(ui?: NativeUi): string {
    return toNativeJson(this, ui);
  }
  static fromNativeJson(text: string): Project {
    return fromNativeJson(text, Project);
  }

  // ---------- consulta ----------

  get size(): number {
    return this.objects.size;
  }
  get(oid: bigint): Entity | undefined {
    return this.objects.get(oid);
  }
  resolve(ref: Ref | undefined): Entity | undefined {
    return ref === null || ref === undefined ? undefined : this.objects.get(ref);
  }
  /** O objeto Project (classe 29), raiz da serialização; nos 27 exemplos é o OID 1. */
  root(): Entity | undefined {
    for (const e of this.objects.values()) if (e.classId === PROJECT_CLASS_ID) return e;
    return undefined;
  }
  entities(): IterableIterator<Entity> {
    return this.objects.values();
  }
  byClass(cls: string | number): Entity[] {
    const id = typeof cls === "number" ? cls : classIdByName(cls);
    if (id === undefined) throw new ModelError("UNKNOWN_CLASS", `classe desconhecida: ${cls}`);
    return [...this.objects.values()].filter((e) => e.classId === id);
  }

  // ---------- edição com undo (RN-027) ----------

  /**
   * Um nível de undo. `fn` altera objetos com `Entity.set`, `create` e `remove`. Devolve o que `fn` devolver. No nível
   * mais externo, os ganchos de `onSettle` rodam depois de `fn` e antes do commit, no mesmo nível (U-29: o destrutor
   * do `TimingCalculationPostponer` recalcula dentro do comando); `settle: false` os pula (resultado pronto do motor).
   * U-45: `undoLevel: false` = `Controller::Invoke(…, undoLevel = false)` [O `visao_interacao.md` §4.2]: a mudança é
   * fundida no nível de undo anterior (`MergeLatestUndoLevel`); sem nível anterior, não entra no undo. Evento "amend".
   */
  edit<T>(name: string, fn: () => T, opts: { settle?: boolean; undoLevel?: boolean } = {}): T {
    if (this.open) {
      // aninhado: o nível externo abrange tudo; com um diálogo aberto, só o próprio diálogo grava (`transact`)
      if (this.txn && this.txn.depth === 0) throw new ModelError("TRANSACTION_OPEN", "a dialog is open: finish it before editing");
      // transação aberta sem rótulo (`beginLevel("")`): fica com o do 1.º comando de dentro (ex.: o da criação)
      if (this.txn && this.open.name === "") this.open.name = name;
      return fn();
    }
    this.open = { name, before: new Map() };
    try {
      const r = fn();
      if (opts.settle !== false) for (const s of this.settlers) s();
      this.commit(opts.undoLevel === false);
      return r;
    } catch (e) {
      // desfaz o nível parcial antes de propagar
      const level = this.open;
      this.open = null;
      if (level) this.restore(level);
      throw e;
    }
  }

  // ---------- transação de diálogo (U-31) ----------

  /**
   * `KernelPropertySheetBase::DoModal` / `DialogCommand` [O `ui_dialogos.md` §4.1]: abre um nível que fica aberto
   * enquanto o diálogo está na tela. O diálogo grava por `transact`; OK fecha com `commitLevel` (um nível só, com a
   * criação e as edições) e Cancel com `abortLevel` (sem rastro). Edição de fora, undo e redo recusam com
   * `TRANSACTION_OPEN` até lá.
   */
  beginLevel(name: string): void {
    if (this.open) throw new ModelError("TRANSACTION_OPEN", "an undo level is already open");
    this.open = { name, before: new Map() };
    this.txn = { depth: 0 };
  }

  get inTransaction(): boolean {
    return this.txn !== null;
  }

  /** Rótulo do nível aberto (vazio se a transação ainda não recebeu um; undefined fora de nível). */
  get openLevelName(): string | undefined {
    return this.open?.name;
  }

  /**
   * Grava dentro da transação aberta (os `edit` de dentro viram parte do mesmo nível). Atômico: se `fn` lança, só o
   * que ela mudou é desfeito e a transação continua aberta (o diálogo fica na tela com a mensagem).
   */
  transact<T>(fn: () => T): T {
    if (!this.txn) throw new ModelError("NO_UNDO_LEVEL", "no dialog transaction is open");
    this.txn.depth++;
    const sub: Level = { name: "transact", before: new Map() };
    this.subs.push(sub);
    // U-37: o rótulo que o 1.º comando deu ao nível também volta quando o que ele gravou é desfeito
    const name0 = this.open?.name;
    let failed = true;
    try {
      const r = fn();
      failed = false;
      return r;
    } finally {
      this.subs.splice(this.subs.indexOf(sub), 1);
      if (failed) {
        this.restore(sub);
        if (this.open && name0 !== undefined) this.open.name = name0;
      }
      this.txn.depth--;
      // a interface redesenha o que o diálogo já gravou (o original notifica as visões a cada comando)
      if (!failed && sub.before.size && this.txn.depth === 0) this.emit({ kind: "pending", name: this.open?.name ?? "", oids: [...sub.before.keys()] });
    }
  }

  /**
   * U-33: roda os ganchos de `onSettle` dentro da transação aberta. Cada controle de uma página de propriedades aplica
   * um comando na hora (`Controller::Invoke` com o `TimingCalculationPostponer`), e as datas são refeitas no mesmo
   * passo, não só no OK [O `tarefa_dialogo.md` §0].
   */
  settle(): void {
    if (!this.txn || this.txn.depth === 0) throw new ModelError("NO_UNDO_LEVEL", "settle() runs inside transact()");
    for (const s of this.settlers) s();
  }

  /** OK: fecha a transação num nível (rótulo opcional); os ganchos de `onSettle` rodam antes, como em `edit`. */
  commitLevel(name?: string): void {
    if (!this.txn || !this.open) throw new ModelError("NO_UNDO_LEVEL", "no dialog transaction is open");
    if (name !== undefined) this.open.name = name;
    this.txn.depth++;
    try {
      for (const s of this.settlers) s();
    } catch (e) {
      // `Controller::Invoke`: exceção no comando → `Transaction::Cancel` (tudo desfeito) [O dialogos_infra.md §6]
      this.txn.depth--;
      this.abortLevel();
      throw e;
    }
    this.txn = null;
    this.commit();
  }

  /** Cancel: desfaz tudo o que a transação mudou, sem entrada no undo nem evento. */
  abortLevel(): void {
    if (!this.txn) return;
    const level = this.open;
    this.open = null;
    this.txn = null;
    if (level) {
      this.restore(level);
      if (level.before.size) this.emit({ kind: "abort", name: level.name, oids: [...level.before.keys()] });
    }
  }

  /**
   * U-32: subtransação de um diálogo aberto por cima de outro (ex.: Edit dependency na aba Dependencies do Task
   * Properties, `Controller::Invoke` aninhado [O `dialogos_infra.md` §5]). `release` mantém o que foi gravado na
   * transação de fora; `rollback` desfaz só o que o diálogo de cima mexeu.
   */
  savepoint(): { release(): void; rollback(): void } {
    if (!this.txn) throw new ModelError("NO_UNDO_LEVEL", "no dialog transaction is open");
    const sub: Level = { name: "savepoint", before: new Map() };
    this.subs.push(sub);
    const name0 = this.open?.name;
    let done = false;
    const drop = () => {
      if (done) return false;
      done = true;
      const i = this.subs.indexOf(sub);
      if (i >= 0) this.subs.splice(i, 1);
      return true;
    };
    return {
      release: () => void drop(),
      rollback: () => {
        if (!drop()) return;
        this.restore(sub);
        if (this.open && name0 !== undefined) this.open.name = name0;
        if (sub.before.size) this.emit({ kind: "abort", name: "savepoint", oids: [...sub.before.keys()] });
      },
    };
  }

  /**
   * U-40: grava sem nível próprio de undo (`Invoke(…, undoLevel = false)` do original: célula corrente e rolagem das
   * grades, `GridInfoHelpers::SaveCurrentCell@0x56eb00`) [O]. Dentro de um nível aberto, entra nele; fora, a mudança
   * fica no modelo sem entrada no undo e sem evento [P: o original a funde ao nível anterior].
   */
  untracked<T>(fn: () => T): T {
    if (this.open) return fn();
    this.open = { name: "untracked", before: new Map() };
    try {
      return fn();
    } finally {
      this.open = null;
    }
  }

  /**
   * Prévia: roda `fn` e desfaz o que ela mudou, também dentro de um nível aberto (subnível). Sem evento nem undo.
   */
  trial<T>(fn: () => T): T {
    if (this.txn) this.txn.depth++;
    try {
      if (!this.open) {
        this.open = { name: "trial", before: new Map() };
        try {
          return fn();
        } finally {
          const level = this.open;
          this.open = null;
          if (level) this.restore(level);
        }
      }
      const sub: Level = { name: "trial", before: new Map() };
      this.subs.push(sub);
      try {
        return fn();
      } finally {
        this.subs.splice(this.subs.indexOf(sub), 1);
        this.restore(sub);
      }
    } finally {
      if (this.txn) this.txn.depth--;
    }
  }

  /** U-29: registra um gancho de fechamento de nível (ver `edit`); devolve a função que o remove. */
  onSettle(fn: () => void): () => void {
    this.settlers.add(fn);
    return () => this.settlers.delete(fn);
  }

  /**
   * U-29: objetos tocados no nível aberto, com o estado de antes (null = criado no nível); vazio fora de `edit`. O
   * postponer do app decide por aqui se a edição sujou o cronograma (`TimingCalculationPostponer::SetDirty`).
   */
  pendingChanges(): { oid: bigint; before: { classId: number; fields: readonly Field[] } | null }[] {
    return this.open ? [...this.open.before].map(([oid, before]) => ({ oid, before })) : [];
  }

  /** NotifyChange: guarda o estado anterior uma vez por nível (copy-on-write). */
  notifyChange(entity: Entity): void {
    if (!this.open) throw new ModelError("NO_UNDO_LEVEL", "edição fora de Project.edit (RN-027)");
    if (this.objects.get(entity.oid) !== entity) {
      throw new ModelError("STALE_ENTITY", `OID ${entity.oid} (${entity.className}) não está no projeto: objeto removido ou referência antiga`);
    }
    if (!this.open.before.has(entity.oid)) this.open.before.set(entity.oid, snapshot(entity));
    for (const s of this.subs) if (!s.before.has(entity.oid)) s.before.set(entity.oid, snapshot(entity));
  }

  /** Objeto novo com OID acima do maior existente (RN-025: ReserveElementIds). */
  create(cls: string | number, fields: Field[] = []): Entity {
    if (!this.open) throw new ModelError("NO_UNDO_LEVEL", "criação fora de Project.edit (RN-027)");
    const classId = typeof cls === "number" ? cls : classIdByName(cls);
    if (classId === undefined) throw new ModelError("UNKNOWN_CLASS", `classe desconhecida: ${cls}`);
    const oid = this.maxOid + 1n;
    this.open.before.set(oid, null);
    for (const s of this.subs) if (!s.before.has(oid)) s.before.set(oid, null);
    return this.insert(oid, classId, fields);
  }

  /**
   * Objeto novo com um OID dado (aplicação de diferença calculada numa cópia do projeto, U-13). O OID não pode
   * estar em uso; o undo o remove como faria com `create`.
   */
  createAt(oid: bigint, cls: string | number, fields: Field[] = []): Entity {
    if (!this.open) throw new ModelError("NO_UNDO_LEVEL", "criação fora de Project.edit (RN-027)");
    const classId = typeof cls === "number" ? cls : classIdByName(cls);
    if (classId === undefined) throw new ModelError("UNKNOWN_CLASS", `classe desconhecida: ${cls}`);
    if (oid <= 0n) throw new ModelError("DIFF_CONFLICT", `OID inválido: ${oid}`);
    if (this.objects.has(oid)) throw new ModelError("DIFF_CONFLICT", `OID ${oid} já existe`);
    if (!this.open.before.has(oid)) this.open.before.set(oid, null);
    for (const s of this.subs) if (!s.before.has(oid)) s.before.set(oid, null);
    return this.insert(oid, classId, fields);
  }

  remove(entity: Entity): void {
    this.notifyChange(entity);
    this.objects.delete(entity.oid);
    this.removed.set(entity.oid, entity);
  }

  private commit(amend = false): void {
    const level = this.open!;
    this.open = null;
    // Trim: descarta estados ainda iguais ao atual
    for (const [oid, snap] of [...level.before]) {
      const cur = this.objects.get(oid);
      const same = snap === null ? cur === undefined : cur !== undefined && cur.classId === snap.classId && fieldsKey(cur.fields) === fieldsKey(snap.fields);
      if (same) level.before.delete(oid);
    }
    if (level.before.size === 0) return;
    if (amend) {
      // U-45: MergeLatestUndoLevel — o estado "antes" entra no nível do topo (o mais antigo vence)
      const top = this.undoStack[this.undoStack.length - 1];
      if (top) for (const [oid, snap] of level.before) if (!top.before.has(oid)) top.before.set(oid, snap);
      this.emit({ kind: "amend", name: level.name, oids: [...level.before.keys()] });
      return;
    }
    this.undoStack.push(level);
    // RN-027 [O U-61f, StateManager::BeginUndoLevel@0x8f1b80]: `while (count > 10) { if (oldest->IsPinned()) break; drop oldest }`;
    // um nível nasce pinned (UndoLevel ctor @0x8f2bd0) e só é despinado no CommitLatestUndoLevel@0x8f1df0, ou seja, a
    // exceção é o nível de uma transação ainda aberta. Aqui o nível aberto não está na pilha, então cortar ao gravar dá o mesmo.
    while (this.undoStack.length > MAX_UNDO_LEVELS) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit({ kind: "commit", name: level.name, oids: [...level.before.keys()] });
  }

  /** Aplica os estados guardados e devolve o nível inverso (estado atual dos mesmos objetos). */
  private restore(level: Level): Level {
    const inverse: Level = { name: level.name, before: new Map() };
    let reinserted = false;
    for (const [oid, snap] of level.before) {
      const cur = this.objects.get(oid);
      inverse.before.set(oid, cur ? snapshot(cur) : null);
      if (snap === null) {
        if (cur) {
          this.objects.delete(oid);
          this.removed.set(oid, cur);
        }
      } else if (cur && cur.classId === snap.classId) {
        cur.fields = structuredClone(snap.fields);
      } else {
        // DV-011: devolve a mesma instância que foi removida, se houver
        const old = this.removed.get(oid);
        if (old && old.classId === snap.classId) {
          old.fields = structuredClone(snap.fields);
          this.objects.set(oid, old);
          this.removed.delete(oid);
        } else {
          this.insert(oid, snap.classId, structuredClone(snap.fields));
        }
        reinserted = true;
      }
    }
    // U-24: o objeto devolvido volta à posição que tinha (a ordem de iteração é a do arquivo e a do motor; sem isso,
    // um undo de remoção mudaria a ordem do .apex.json e o desempate dos cálculos)
    if (reinserted) {
      const all = [...this.objects.entries()].sort((a, b) => (this.position.get(a[0]) ?? 0) - (this.position.get(b[0]) ?? 0));
      this.objects.clear();
      for (const [k, v] of all) this.objects.set(k, v);
    }
    return inverse;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  /** U-34: limpa undo e redo (File ▸ New depois do Project Properties: `DR2Doc::OnNewDocument` limpa a pilha) [O]. */
  clearHistory(): void {
    if (this.txn) throw new ModelError("TRANSACTION_OPEN", "a dialog is open: finish it before clearing the history");
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  /** Nomes dos níveis de undo, do mais antigo ao mais recente. */
  undoNames(): string[] {
    return this.undoStack.map((l) => l.name);
  }
  redoNames(): string[] {
    return this.redoStack.map((l) => l.name);
  }

  undo(): boolean {
    if (this.txn) throw new ModelError("TRANSACTION_OPEN", "a dialog is open: finish it before undoing");
    const level = this.undoStack.pop();
    if (!level) return false;
    this.redoStack.push(this.restore(level));
    this.emit({ kind: "undo", name: level.name, oids: [...level.before.keys()] });
    return true;
  }

  redo(): boolean {
    if (this.txn) throw new ModelError("TRANSACTION_OPEN", "a dialog is open: finish it before redoing");
    const level = this.redoStack.pop();
    if (!level) return false;
    this.undoStack.push(this.restore(level));
    this.emit({ kind: "redo", name: level.name, oids: [...level.before.keys()] });
    return true;
  }

  // ---------- eventos ----------

  on(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(e: ChangeEvent): void {
    for (const l of this.listeners) l(e);
  }
}
