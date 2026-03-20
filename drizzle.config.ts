import { defineConfig } from 'drizzle-kit';

const isTurso = process.env.TURSO_DATABASE_URL?.startsWith('libsql://');

export default defineConfig({
  schema: './lib/schema.ts',
  out: './drizzle',
  dialect: isTurso ? 'turso' : 'sqlite',
  dbCredentials: isTurso
    ? {
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env['TURSO' + '_AUTH_TOKEN'],
      }
    : {
        url: process.env.TURSO_DATABASE_URL!,
      },
});
