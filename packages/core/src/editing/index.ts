export type {
  ApplyEditBatchResult,
  ApplyEditResult,
  EditOp,
  SourceEdit,
  Splice,
} from './edit-ops.ts';
export {
  applyEdit,
  applyEditBatch,
  formatJsxAttrValue,
  jsString,
  planAssetImport,
  safeAssetIdentifier,
} from './edit-ops.ts';
export { applyRevertAsset } from './revert-asset.ts';
export {
  duplicateNotesElementInSource,
  duplicatePageInDefaultExportInSource,
  insertNotesElementInSource,
  insertPageComponentInSource,
  removeNotesElementInSource,
  removePageFromDefaultExportInSource,
  reorderDefaultExportPagesInSource,
  reorderNotesArrayInSource,
  updateMetaTitleInSource,
  validateSlideName,
} from './slide-ops.ts';
