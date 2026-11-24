import { PrismaPg } from '@prisma/adapter-pg';
import { loadConfig } from '../config.js';
import { PrismaClient } from '../generated/prisma/client.js';

const config = loadConfig();
const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
