// =====================================================================
// MOZONA TPV — server/db.ts
// =====================================================================
// Pool de conexiones a PostgreSQL con reconexión automática.
// =====================================================================

import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
    connectionString:
        process.env.DATABASE_URL ??
        "postgresql://mozona:mozona@localhost:5432/mozona",
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});

// Reintento silencioso de reconexión
pool.on("error", (err) => {
    console.error("[DB] Error inesperado en cliente idle:", err.message);
});

/**
 Ejecuta una query tipada. Helper de conveniencia sobre `pool.query`.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
): Promise<pg.QueryResult<T>> {
    return pool.query<T>(sql, params as unknown[]);
}

/**
 Helper transaccional. Si el callback lanza, se hace rollback.
 */
export async function withTransaction<T>(
    fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

/** Cierra el pool limpiamente. */
export async function closeDb(): Promise<void> {
    await pool.end();
}
