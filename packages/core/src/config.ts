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
  publish?: {
    statusEndpoint: string;
    publishEndpoint: string;
  };
  catalog?: {
    listEndpoint: string;
    insertEndpoint: string;
  };
};

export type OpenSlideConfig = {
  base?: string;
  slidesDir?: string;
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
};
