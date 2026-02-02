import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Missing env DATABASE_URL. Put it into ".env.local".');
  }

  // Safety net for Vercel/Node TLS chain issues (Supabase pooler + cert chain edge cases)
  if (process.env.NODE_ENV === "production") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const pool = new Pool({
    connectionString: url,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter });
}

export const prisma = global.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
