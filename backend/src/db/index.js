import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "pg";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

const { Pool } = pkg;

const pool = new Pool({ connectionString: env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const connectDB = async () => {
  await prisma.$connect();
  logger.info("PostgreSQL connected");
};

const disconnectDB = async () => {
  await prisma.$disconnect();
  await pool.end();
};

export { prisma, disconnectDB };
export default connectDB;
