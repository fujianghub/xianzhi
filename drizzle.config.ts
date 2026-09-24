import { defineConfig } from 'drizzle-kit'

const url = process.env.DATABASE_URL ?? 'postgres://xz:xz@localhost:5433/xz'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
