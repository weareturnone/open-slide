import type { Locale } from './locale/types';

export type OpenSlideBuildConfig = {
  showSlideBrowser?: boolean;
  showSlideUi?: boolean;
  allowHtmlDownload?: boolean;
};

export type OpenSlideAuthoringConfig = {
  /**
   * Expose source-backed authoring controls in production builds. The host
   * application must provide the existing /__edit, /__slides and /__assets
   * HTTP contracts when this is enabled.
   */
  enabled?: boolean;
  /** Keep authoring UI inspectable while every mutation remains disabled. */
  readOnly?: boolean;
  publish?: {
    statusEndpoint: string;
    publishEndpoint: string;
  };
  catalog?: {
    listEndpoint: string;
    insertEndpoint: string;
    /** Workspace-relative module used by the local Vite authoring adapter. */
    sourceModule?: string;
  };
  decks?: {
    createEndpoint: string;
  };
};

export type OpenSlideBrandingIcon = {
  rel: 'icon' | 'shortcut icon' | 'apple-touch-icon' | 'mask-icon';
  href: string;
  type?: string;
  sizes?: string;
  color?: string;
};

export type OpenSlideBrandingFonts = {
  /** CSS font-family stack used for application copy and controls. */
  body?: string;
  /** CSS font-family stack used for application headings. */
  heading?: string;
  /** CSS font-family stack used for labels, metadata, and numeric UI. */
  metadata?: string;
};

export type OpenSlideBrandingColors = {
  brand?: string;
  brandForeground?: string;
  brandSoft?: string;
  ring?: string;
};

export type OpenSlideBrandingConfig = {
  /** Product name shown in application chrome and platform metadata. */
  appName?: string;
  /** Browser title. Falls back to appName. */
  title?: string;
  description?: string;
  /** Optional square mark shown beside appName. */
  logo?: {
    src: string;
    alt?: string;
  };
  themeColor?:
    | string
    | {
        light: string;
        dark?: string;
      };
  icons?: OpenSlideBrandingIcon[];
  manifest?: string;
  /** External or public-root stylesheets, such as licensed local font declarations. */
  stylesheets?: string[];
  fonts?: OpenSlideBrandingFonts;
  colors?: {
    light?: OpenSlideBrandingColors;
    dark?: OpenSlideBrandingColors;
  };
};

export type OpenSlideConfig = {
  base?: string;
  slidesDir?: string;
  documentsDir?: string;
  themesDir?: string;
  assetsDir?: string;
  port?: number;
  allowedHosts?: string[] | true;
  /**
   * @deprecated Pick the UI language from the language switcher in the slide UI
   * instead. When set, this only seeds the initial language until the user
   * chooses one (their choice is then remembered locally).
   */
  locale?: Locale;
  build?: OpenSlideBuildConfig;
  authoring?: OpenSlideAuthoringConfig;
  branding?: OpenSlideBrandingConfig;
};
