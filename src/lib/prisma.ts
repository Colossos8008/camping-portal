import prismaPkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const { PrismaClient } = prismaPkg as unknown as { PrismaClient: new (options?: unknown) => any };
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClientInstance | undefined;
}

function createMissingDbProxy(): PrismaClientInstance {
  const message = 'Missing env DATABASE_URL. Put it into ".env.local".';
  return new Proxy(
    {},
    {
      get() {
        throw new Error(message);
      },
    }
  ) as PrismaClientInstance;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return createMissingDbProxy();
  }

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
