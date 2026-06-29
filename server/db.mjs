import pg from "pg";
import { loadServerEnv } from "./env.mjs";

const { Pool } = pg;

loadServerEnv();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
});

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
