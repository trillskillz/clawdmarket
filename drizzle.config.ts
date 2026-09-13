import { defineConfig } from 'drizzle-kit';

const isTurso = process.env.TURSO_DATABASE_URL?.startsWith('libsql://');
const databaseUrl = process.env.TURSO_DATABASE_URL?.trim() || 'file:./local.db';

export default defineConfig({
  schema: './lib/schema.ts',
  out: './drizzle',
  dialect: isTurso ? 'turso' : 'sqlite',
  dbCredentials: isTurso
    ? {
        url: databaseUrl,
        authToken: process.env['TURSO' + '_AUTH_TOKEN'],
      }
    : {
        url: databaseUrl,
      },
});
