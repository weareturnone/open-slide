import config from 'virtual:open-slide/config';

/** Local Vite authoring is always available. Production authoring is an
 * explicit host capability because it needs durable, authenticated writes. */
export const authoringEnabled = import.meta.env.DEV || config.authoring?.enabled === true;
