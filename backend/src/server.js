/** Process entry point: validate config, apply migrations, then listen. */

import { createApp } from "./app.js";
import { assertConfig, config } from "./config.js";
import { closePool } from "./db/database.js";
import { migrate } from "./db/migrate.js";
import { logger } from "./utils/logger.js";

async function main() {
  assertConfig();

  // Idempotent; keeps local dev and App Runner deploys on the same schema.
  await migrate();

  const server = createApp().listen(config.port, () => {
    logger.info("server listening", { port: config.port, env: config.env });
  });

  const shutdown = async (signal) => {
    logger.info("shutting down", { signal });
    server.close(async () => {
      await closePool().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) =>
    logger.error("unhandled rejection", { error: String(reason) }),
  );
}

main().catch((error) => {
  logger.error("failed to start", { error: error.message });
  process.exit(1);
});
