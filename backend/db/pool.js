import pg from 'pg';
import { config } from '../config/env.js';

const { Pool } = pg;

export const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: { rejectUnauthorized: false }, 
      max: 10,
    })
  : null;

export async function query(text, params) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing).');
  return pool.query(text, params);
}

export async function pingDb() {
  if (!pool) return false;
  try {
    await pool.query('select 1');
    return true;
  } catch (err) {
    console.error('[db] ping failed:', err.message);
    return false;
  }
}

export default { pool, query, pingDb };
