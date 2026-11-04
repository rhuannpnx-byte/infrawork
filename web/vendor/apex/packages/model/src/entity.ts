/**
 * Objeto do domínio (RD-006…021). Guarda os campos na ordem e no tipo em que vieram do `.dr5`, então um
 * objeto não editado volta byte a byte (CA da U-03). O acesso é pelo nome do membro do original
 * (`m_strName`, `m_dateBegin`…), resolvido pelo dicionário (classe, id, tipo) (RD-004, RD-005).
 */
import { className, FT, fieldsOfMember, memberKeys, type Field, type FieldValue } from "@apex/dr5";
import { ModelError } from "./errors.js";
import { currentTag, decode, encode, type ModelValue } from "./values.js";

/** Quem edita: o projeto, que registra o estado anterior no nível de undo aberto (RN-027). */
export interface EditHost {
  notifyChange(entity: Entity): void;
}

const LEGACY: Readonly<Record<number, number>> = { [FT.WSTRING_OLD]: FT.STRING, [FT.POINTER32]: FT.POINTER64, [FT.REFERENCE_OLD]: FT.POINTER64 };
const sameKind = (fieldTag: number, memberTag: number) => fieldTag === memberTag || LEGACY[fieldTag] === memberTag;

export class Entity {
  /** @internal campos crus, na ordem do arquivo; só o projeto e o undo os substituem. */
  fields: Field[];

  constructor(readonly oid: bigint, readonly classId: number, fields: Field[], private readonly host: EditHost) {
    this.fields = fields;
  }

  get className(): string {
    return className(this.classId) ?? `classe ${this.classId}`;
  }

  /** Membros que a classe tem no dicionário. */
  members(): string[] {
    return memberKeys(this.classId);
  }

  /** Campo cru do membro, se presente (aceita o tipo legado e o atual). */
  field(member: string): Field | undefined {
    for (const { id, tag } of fieldsOfMember(this.classId, member)) {
      const f = this.fields.find((x) => x.id === id && sameKind(x.type, tag));
      if (f) return f;
    }
    return undefined;
  }

  has(member: string): boolean {
    return this.field(member) !== undefined;
  }

  /** Valor JS do membro; undefined se o campo não está no objeto ("campo ausente = padrão", §4.2). */
  get(member: string): ModelValue | undefined {
    const f = this.field(member);
    return f === undefined ? undefined : decode(f.value);
  }

  /** Nome do objeto (KernelObject f100), comum a todas as classes. */
  get name(): string {
    const v = this.get("m_strName");
    return typeof v === "string" ? v : "";
  }

  /**
   * Altera um membro escalar ou referência. Mantém o id do campo existente; um campo novo usa o tipo atual
   * do dicionário (a última linha do membro) e entra no fim, como um ManageState grava campos novos.
   */
  set(member: string, value: ModelValue): void {
    const existing = this.field(member);
    if (existing) {
      this.setRaw(member, encode(currentTag(existing.type), value));
      return;
    }
    const spec = fieldsOfMember(this.classId, member);
    const last = spec[spec.length - 1];
    if (!last) throw new ModelError("UNKNOWN_MEMBER", `${this.className} não tem o membro ${member}`);
    this.setRaw(member, encode(last.tag, value));
  }

  /** Altera um membro com um `FieldValue` pronto (compostos: contêineres, mapas, tuplas). */
  setRaw(member: string, value: FieldValue): void {
    const existing = this.field(member);
    const spec = fieldsOfMember(this.classId, member);
    if (!existing && spec.length === 0) throw new ModelError("UNKNOWN_MEMBER", `${this.className} não tem o membro ${member}`);
    this.host.notifyChange(this);
    if (existing) {
      this.fields = this.fields.map((f) => (f === existing ? { id: f.id, type: value.type, value } : f));
    } else {
      this.fields = [...this.fields, { id: spec[spec.length - 1]!.id, type: value.type, value }];
    }
  }

  /**
   * Troca a lista inteira de campos (aplicação de diferença calculada fora deste projeto, U-13).
   * Registra o estado anterior no nível de undo aberto, como `setRaw`.
   */
  replaceFields(fields: Field[]): void {
    this.host.notifyChange(this);
    this.fields = fields;
  }

  /** Remove um membro (volta ao padrão do original). */
  unset(member: string): void {
    const existing = this.field(member);
    if (!existing) return;
    this.host.notifyChange(this);
    this.fields = this.fields.filter((f) => f !== existing);
  }
}
