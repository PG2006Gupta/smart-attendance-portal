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

// A failed start during deployment is hard to debug from a log viewer: the
// error object is printed in full, but the values that caused it are not.
// This prints the connection settings with the password replaced by its
// length, which is enough to spot the usual causes - a truncated copy, a
// quoted value, or a host name pasted into the password.
function describeDatabaseFailure(error) {
    const password = process.env.DB_PASSWORD || "";
    const notes = [];

    notes.push(
        [
            "Database settings:",
            `DB_HOST=${process.env.DB_HOST || "(missing)"}`,
            `DB_PORT=${process.env.DB_PORT || "(missing)"}`,
            `DB_NAME=${process.env.DB_NAME || "(missing)"}`,
            `DB_USER=${process.env.DB_USER || "(missing)"}`,
            `DB_PASSWORD=(${password.length} characters)`,
            `DB_SSL=${process.env.DB_SSL || "(missing)"}`
        ].join(" ")
    );

    if (password !== password.trim()) {
        notes.push(
            "DB_PASSWORD has surrounding whitespace. Re-paste it."
        );
    }

    if (
        (password.startsWith('"') && password.endsWith('"')) ||
        (password.startsWith("'") && password.endsWith("'"))
    ) {
        notes.push("DB_PASSWORD is wrapped in quotes. Remove them.");
    }

    if (password.includes("@")) {
        notes.push(
            "DB_PASSWORD contains '@'. The host was probably included."
        );
    }

    if (password.startsWith("npg_") && password.length !== 20) {
        notes.push(
            `Neon passwords are 20 characters; this one is ${password.length}.`
        );
    }

    if (error.code === "28P01") {
        notes.push(
            "The password was rejected. Reset it in Neon, then paste the new" +
                " value into this service's DB_PASSWORD."
        );
    }

    return notes.join("\n");
}

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
        console.error(describeDatabaseFailure(error));
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
