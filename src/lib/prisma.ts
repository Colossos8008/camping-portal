// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL || "file:./prisma/dev.db";

  // SQLite via Driver Adapter (required when engineType = "client")
  if (url.startsWith("file:")) {
    const filePath = url.replace(/^file:/, "");
    const db = new Database(filePath);
    const adapter = new PrismaBetterSqlite3(db);
    return new PrismaClient({ adapter });
  }

  // Postgres etc.
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = global.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") global.prisma = prisma;
