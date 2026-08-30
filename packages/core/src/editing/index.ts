export type {
  ApplyAssetDependenciesResult,
  ApplyEditBatchResult,
  ApplyEditResult,
  AssetDependency,
  EditOp,
  SourceEdit,
  Splice,
} from './edit-ops.ts';
export {
  applyAssetDependenciesInSource,
  applyEdit,
  applyEditBatch,
  formatJsxAttrValue,
  jsString,
  planAssetImport,
  safeAssetIdentifier,
} from './edit-ops.ts';
export type {
  SourcePageIdentityResolution,
  SourcePageOccurrence,
} from './page-identities.ts';
export {
  resolvePageIdentitiesInSource,
  sourcePageOccurrencesOrThrow,
} from './page-identities.ts';
export { applyRevertAsset } from './revert-asset.ts';
export {
  duplicateNotesElementInSource,
  duplicatePageByIdInSource,
  duplicatePageInDefaultExportInSource,
  insertNotesElementInSource,
  insertPageComponentInSource,
  migrateLegacyPageOccurrencesInSource,
  removeNotesElementInSource,
  removePageByIdInSource,
  removePageFromDefaultExportInSource,
  reorderDefaultExportPagesByIdInSource,
  reorderDefaultExportPagesInSource,
  reorderNotesArrayInSource,
  updateMetaTitleInSource,
  validateSlideName,
} from './slide-ops.ts';
