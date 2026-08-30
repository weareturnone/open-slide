export type { ImagePlaceholderProps } from './app/components/image-placeholder.tsx';
export { ImagePlaceholder } from './app/components/image-placeholder.tsx';
export type { MorphElementProps } from './app/components/morph-element.tsx';
export { MorphElement } from './app/components/morph-element.tsx';
export type {
  DesignFonts,
  DesignPalette,
  DesignSystem,
  DesignTypeScale,
} from './app/lib/design.ts';
export { cssVarsToString, defaultDesign, designToCssVars } from './app/lib/design.ts';
export type { AuthoredPage } from './app/lib/page.tsx';
export { page } from './app/lib/page.tsx';
export { useSlidePageIdentity, useSlidePageNumber } from './app/lib/page-context.tsx';
export type { PageId, SourceModuleId, StablePageId } from './app/lib/page-identity.ts';
export {
  isPageIdentityError,
  PageIdentityCollisionError,
  PageIdentityError,
  PageIdentityStaleError,
  PageIdentityUnavailableError,
  PageIdentityValidationError,
} from './app/lib/page-identity.ts';
export type { Page, SlideMeta, SlideModule } from './app/lib/sdk.ts';
export { CANVAS_HEIGHT, CANVAS_WIDTH } from './app/lib/sdk.ts';
export type { StepProps, StepsProps } from './app/lib/step-context.tsx';
export { Step, Steps, useIsActivePage } from './app/lib/step-context.tsx';
export type {
  MorphTransition,
  SlideTransition,
  TransitionPhase,
} from './app/lib/transition.ts';
export type {
  OpenSlideBrandingColors,
  OpenSlideBrandingConfig,
  OpenSlideBrandingFonts,
  OpenSlideBrandingIcon,
  OpenSlideConfig,
} from './config.ts';
export type { Locale, Plural } from './locale/types.ts';
