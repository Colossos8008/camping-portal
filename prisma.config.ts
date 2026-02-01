// prisma.config.ts
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Prisma CLI (generate, migrate) soll IMMER die Direct-Connection nutzen
    url: env("DIRECT_URL"),
  },
});
