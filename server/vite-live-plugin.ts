import type { Plugin } from 'vite';
import { createChatHandler } from './chat-handler';
import { loadDatasetFromDisk } from './dataset-node';
import { createClient, liveModel } from './live-client';

/**
 * `npm run dev:live`: mounts POST /api/chat on the Vite dev server (Node, localhost only).
 * The API key stays in this process; the browser only ever receives the transcript.
 */
export function liveApiPlugin(): Plugin {
  return {
    name: 'factory-twin-live-api',
    apply: 'serve',
    configureServer(server) {
      const logger = server.config.logger;
      if (!process.env.ANTHROPIC_API_KEY) {
        logger.warn(
          '[live] ANTHROPIC_API_KEY is not set; /api/chat will answer 503. See .env.example.',
        );
      } else {
        logger.info(`[live] /api/chat ready, model ${liveModel()}`);
      }
      const handler = createChatHandler({
        dataset: loadDatasetFromDisk(),
        model: liveModel(),
        getClient: createClient,
        log: (m) => logger.error(m),
      });
      server.middlewares.use('/api/chat', (req, res) => handler(req, res));
    },
  };
}
