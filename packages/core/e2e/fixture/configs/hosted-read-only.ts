import type { OpenSlideConfig } from '@open-slide/core';

const openSlideConfig: OpenSlideConfig = {
  authoring: {
    enabled: true,
    readOnly: true,
    publish: {
      statusEndpoint: '/studio/status',
      publishEndpoint: '/studio/publish',
    },
    catalog: {
      listEndpoint: '/studio/catalog',
      insertEndpoint: '/studio/catalog/insert',
    },
    decks: {
      createEndpoint: '/studio/decks',
    },
  },
};

export default openSlideConfig;
