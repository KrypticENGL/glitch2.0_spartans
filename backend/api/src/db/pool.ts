import pg from "pg";

// int8 (counts, edge ids, graph version) as JS numbers: all values here are far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// int8[] (route_records.edge_ids); elements are never NULL.
(pg.types.setTypeParser as (oid: number, parse: (v: string) => unknown) => void)(1016, (v) => (v === "{}" ? [] : v.slice(1, -1).split(",").map(Number)));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
/** Anything that can run a query: the pool or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, "query">;

export function createPool(connectionString: string, max: number): pg.Pool {
  return new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
