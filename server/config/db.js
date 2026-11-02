import pg from "pg";

const { Pool } = pg;

const useSsl = process.env.DB_SSL === "true";

const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: useSsl
        ? {
            rejectUnauthorized:
                process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false"
        }
        : undefined,
    max: Number(process.env.DB_POOL_SIZE) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error.message);
});

export async function testDatabaseConnection() {
    const result = await pool.query(`
        SELECT
            current_database() AS database_name,
            NOW() AS server_time
    `);

    return result.rows[0];
}

export default pool;
