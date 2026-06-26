// Idempotent SQL migration runner. Applies every *.sql in ./migrations in
// filename order, tracking applied files in a `_migrations` table. Run with:
//   npm run migrate            (from the server/ directory)
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load the repo-root .env (server vars live there) regardless of cwd.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getPool } from './pg';

async function main() {
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const pool = getPool();

  await pool.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name text PRIMARY KEY,
       applied_at timestamptz DEFAULT now()
     )`,
  );

  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (done.rowCount) {
      console.log(`skip   ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`apply  ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log('migrations complete');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
