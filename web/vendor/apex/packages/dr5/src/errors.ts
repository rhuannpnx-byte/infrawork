/**
 * Erros de leitura do .dr5. Os códigos espelham as exceções do original e as mensagens
 * reproduzem as strings do executável (D-008), sem o nome do produto original (D-013/D-014).
 * Evidência: docs/analise_persistencia_dpl.md §1–2 (ArchiveDriver, DiskDriverBase::Read/ReadField).
 */
export type Dr5ErrorCode =
  | "BAD_OUTER_HEADER" // CArchiveException(5) em ArchiveDriver: magic de 29 bytes diferente
  | "BAD_DRIVER_VERSION" // nArchiveDriverVersion != 0x1000
  | "ZLIB_ERROR" // CArchiveException(3) em ReadArchive
  | "BAD_INNER_HEADER" // "Unable to read header information. File broken."
  | "FILE_TOO_OLD" // FileTooOldException (nClientVersion < mínimo)
  | "FILE_TOO_NEW" // FileTooNewException (nClientVersion > máximo)
  | "UNEXPECTED_END" // "Unexpected end of file. File broken."
  | "UNEXPECTED_FILE_ENDING" // terminador ausente ou != 0xFFFFFFFF
  | "TOO_LARGE_FIELD" // registro ou campo > 0x1FFFFFFF
  | "INVALID_FIELD_TYPE" // tag > 0x19 ou tags removidas (0x00, 0x0E, 0x13)
  | "MISALIGNED_RECORD" // campos não terminam exatamente no fim declarado do registro
  | "PAYLOAD_TOO_LARGE" // limite defensivo do sistema novo (não existe no original)
  | "NESTING_TOO_DEEP" // limite defensivo do sistema novo: aninhamento > MAX_NESTING (DV-001)
  | "UNREGISTERED_OBJECT" // escrita: ponteiro para objeto fora do documento (RN-025, NotifyPointer)
  | "INVALID_DOCUMENT"; // escrita: documento que o leitor não conseguiria ler (sistema novo)

export class Dr5Error extends Error {
  readonly code: Dr5ErrorCode;
  readonly offset: number | undefined;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: Dr5ErrorCode, message: string, offset?: number, details?: Record<string, unknown>) {
    super(offset === undefined ? message : `${message} (offset 0x${offset.toString(16)})`);
    this.name = "Dr5Error";
    this.code = code;
    this.offset = offset;
    this.details = details;
  }
}

export const MESSAGES = {
  BAD_OUTER_HEADER: "Unexpected file format.",
  BAD_DRIVER_VERSION: "Unexpected file format.",
  ZLIB_ERROR: "Unexpected file format.",
  BAD_INNER_HEADER: "Unable to read header information. File broken.",
  FILE_TOO_OLD: "The file version is too old.",
  FILE_TOO_NEW: "The file version is too new.",
  UNEXPECTED_END: "Unexpected end of file. File broken.",
  UNEXPECTED_FILE_ENDING: "Unexpected file ending",
  TOO_LARGE_FIELD: "Too large field encountered",
  INVALID_FIELD_TYPE: "Invalid field type. File broken.",
  MISALIGNED_RECORD: "Unexpected end of file. File broken.",
  PAYLOAD_TOO_LARGE: "Payload exceeds the configured limit.",
  NESTING_TOO_DEEP: "Nesting exceeds the configured limit.",
  UNREGISTERED_OBJECT: "Unregistered object encountered",
  INVALID_DOCUMENT: "Invalid document:",
} as const satisfies Record<Dr5ErrorCode, string>;
