import type { Plugin } from 'vite';
import { registerAssetRoutes } from './routes/assets.ts';
import { registerCatalogRoutes } from './routes/catalog.ts';
import { registerCommentRoutes } from './routes/comments.ts';
import { type ApiPluginOptions, makeContext } from './routes/context.ts';
import { registerEditRoutes } from './routes/edit.ts';
import { registerFolderRoutes } from './routes/folders.ts';
import { registerRemoteRoutes } from './routes/remote.ts';
import { registerRestartRoutes } from './routes/restart.ts';
import { registerSlideRoutes } from './routes/slides.ts';
import { registerSvglRoutes } from './routes/svgl.ts';
import { registerUpdateRoutes } from './routes/update.ts';
import { registerWatchers } from './routes/watchers.ts';

export type { ApiPluginOptions };

// All open-slide dev-server endpoints in one plugin. To see the routes
// owned by a group, open the matching file under `routes/` — each file
// leads with a comment-block manifest of its endpoints.
export function apiPlugin(opts: ApiPluginOptions): Plugin {
  return {
    name: 'open-slide:api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
          req.socket.remoteAddress || '',
        );
        if (
          !local &&
          !['GET', 'HEAD'].includes(req.method || '') &&
          !req.url?.startsWith('/__remote/')
        ) {
          res.writeHead(403, { 'content-type': 'text/plain' });
          res.end('Bewerken kan alleen op de laptop via localhost.');
          return;
        }
        next();
      });
      const ctx = makeContext(opts);
      registerWatchers(server, ctx);
      registerEditRoutes(server, ctx);
      registerCommentRoutes(server, ctx);
      registerSlideRoutes(server, ctx);
      registerCatalogRoutes(server, ctx);
      registerAssetRoutes(server, ctx);
      registerSvglRoutes(server);
      registerFolderRoutes(server, ctx);
      registerUpdateRoutes(server, ctx);
      registerRestartRoutes(server);
      registerRemoteRoutes(server);
    },
  };
}
