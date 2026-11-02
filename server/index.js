import "dotenv/config";

import app from "./app.js";
import pool from "./config/db.js";
import {
    backfillFinalizedAttendanceRecords,
    expireDueSessions
} from "./services/session-finalization.js";

const PORT = Number(process.env.PORT) || 5000;
let server;
let finalizationInterval;

async function startServer() {
    try {
        const result = await pool.query(
            "SELECT current_database() AS database_name"
        );

        console.log(
            `Connected to PostgreSQL database: ${result.rows[0].database_name}`
        );

        await expireDueSessions();
        await backfillFinalizedAttendanceRecords();

        finalizationInterval = setInterval(() => {
            expireDueSessions().catch((error) => {
                console.error(
                    "Session finalization failed:",
                    error.message
                );
            });
        }, 60000);
        finalizationInterval.unref();

        server = app.listen(PORT, "0.0.0.0", () => {
            console.log("========================================");
            console.log("SAP is running");
            console.log(`http://localhost:${PORT}`);
            console.log("========================================");
        });

        server.on("error", (error) => {
            console.error("HTTP server error:", error);
            process.exitCode = 1;
        });
    } catch (error) {
        console.error("Failed to start SAP backend:", error);
        await pool.end();
        process.exit(1);
    }
}

async function shutdown(signal) {
    console.log(`\n${signal} received. Shutting down SAP...`);

    try {
        if (finalizationInterval) {
            clearInterval(finalizationInterval);
        }

        if (server) {
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        }

        await pool.end();
    } catch (error) {
        console.error("Error during shutdown:", error);
        process.exitCode = 1;
    } finally {
        process.exit();
    }
}

process.on("SIGINT", () => {
    void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
});

await startServer();
