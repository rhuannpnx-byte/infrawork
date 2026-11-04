/** Erros do modelo (sistema novo). Leitura e escrita de `.dr5` continuam lançando `Dr5Error`. */
export type ModelErrorCode =
  | "NO_UNDO_LEVEL" // edição fora de `Project.edit` (RN-027: toda mudança pertence a um nível de undo)
  | "UNKNOWN_MEMBER" // membro que a classe não tem no dicionário (RD-005)
  | "BAD_VALUE" // valor JS incompatível com o tipo do campo
  | "UNKNOWN_CLASS"
  | "NATIVE_FORMAT" // .apex.json malformado ou de esquema desconhecido
  | "INTEGRITY" // SHA-256 do .apex.json não confere
  | "UNSUPPORTED_MIGRATION" // versão de cliente cuja migração não foi implementada (D-004)
  | "STALE_ENTITY" // DV-011: Entity que não é mais a instância viva do OID (removida ou substituída)
  | "DIFF_CONFLICT" // U-13: diferença que não se aplica ao estado atual (OID já existe, ausente ou base diferente)
  | "TRANSACTION_OPEN"; // U-31: há um diálogo com transação aberta (`beginLevel`); edição de fora, undo e redo esperam

export class ModelError extends Error {
  constructor(readonly code: ModelErrorCode, message: string) {
    super(message);
    this.name = "ModelError";
  }
}
