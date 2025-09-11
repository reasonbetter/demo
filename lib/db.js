import { neon, neonConfig } from '@neondatabase/serverless';

// Cache connections across invocations (good for serverless)
neonConfig.fetchConnectionCache = true;

export const sql = neon(process.env.DATABASE_URL);
