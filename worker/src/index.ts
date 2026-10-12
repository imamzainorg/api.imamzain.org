import { app } from './app';
import { runScheduled } from './jobs';
import type { AppBindings } from './lib/types';

export default {
  fetch: app.fetch,
  async scheduled(controller, env) {
    await runScheduled(controller.cron, env, controller.scheduledTime);
  },
} satisfies ExportedHandler<AppBindings>;
