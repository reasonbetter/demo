// lib/db.js
import { neon, neonConfig } from '@neondatabase/serverless';

// cache connections across invocations on serverless
neonConfig.fetchConnectionCache = true;

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL env var");
}

export const sql = neon(process.env.DATABASE_URL);
