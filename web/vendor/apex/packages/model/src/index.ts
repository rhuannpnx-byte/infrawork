/** @apex/model — modelo de domínio sobre o .dr5 (U-03): objetos, undo, eventos, formato nativo, validações. */
export { applyDiff, captureState, diffSince, isEmptyDiff, type ProjectDiff, type ProjectState } from "./diff.js";
export { Entity } from "./entity.js";
export { ModelError, type ModelErrorCode } from "./errors.js";
export { LEGACY_PROJECT_FIELDS, migrateToCurrent, OLDEST_MIGRATABLE, orderItems, type MigrationReport } from "./migrate.js";
export { NATIVE_FORMAT, NATIVE_SCHEMA, readNativeUi, type NativeUi } from "./native-json.js";
export { MAX_UNDO_LEVELS, Project, type ChangeEvent, type ChangeListener } from "./project.js";
export { sha256 } from "./sha256.js";
export { checkCenterStation, checkLocationLength, checkRoadLineLength, checkStationSpan, checkTaskLocations, TOLERANCES, VALIDATION_MESSAGES, type ValidationMessage } from "./validate.js";
export { decode, encode, encodeContainer, type ModelValue, type Ref } from "./values.js";
