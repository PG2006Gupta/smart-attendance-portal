import "dotenv/config";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pool from "../server/config/db.js";

// =====================================================
// SAP DATABASE MIGRATION RUNNER
// =====================================================
// Applies every database/migrations/*.sql file exactly once, in filename
// order, and records what ran in the schema_migrations table.
//
//   npm run migrate                 apply pending migrations
//   npm run migrate -- --status     show applied and pending migrations
//   npm run migrate -- --through=008
//                                   stop after migration 008
//   npm run migrate -- --baseline   mark existing migrations as applied
//                                   without running them (for databases
//                                   that were created before this runner)
// =====================================================

const migrationsDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations"
);

const schemaMigrationsTable = "schema_migrations";

// Standalone transaction control statements are removed because the runner
// wraps every migration in its own transaction. Migration files must
// therefore not contain nested BEGIN/COMMIT statements or dollar-quoted
// blocks that begin with BEGIN;.
const transactionControlPattern =
    /^\s*(BEGIN|COMMIT|START\s+TRANSACTION|ROLLBACK)\s*;\s*$/i;

export function stripTransactionControl(sql) {
    return sql
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter((line) => !transactionControlPattern.test(line))
        .join("\n");
}

export function checksum(sql) {
    const normalised = sql.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

    return crypto.createHash("sha256").update(normalised).digest("hex");
}

export function parseMigrationArguments(argv) {
    const options = {
        through: null,
        baseline: false,
        status: false,
        help: false
    };

    for (const argument of argv) {
        if (argument === "--baseline") {
            options.baseline = true;
            continue;
        }

        if (argument === "--status") {
            options.status = true;
            continue;
        }

        if (argument === "--help" || argument === "-h") {
            options.help = true;
            continue;
        }

        if (argument.startsWith("--through=")) {
            const value = argument.slice("--through=".length).trim();

            if (!/^\d{3}$/.test(value)) {
                throw new Error(
                    "--through expects a three-digit migration prefix, for example --through=008."
                );
            }

            options.through = value;
            continue;
        }

        throw new Error(`Unknown migration option: ${argument}`);
    }

    return options;
}

async function listMigrationFiles() {
    const entries = await fs.readdir(migrationsDirectory);

    return entries
        .filter((name) => name.endsWith(".sql"))
        .sort((first, second) => first.localeCompare(second))
        .map((name) => ({
            name,
            prefix: name.slice(0, 3)
        }));
}

async function readMigration(file) {
    const sql = await fs.readFile(
        path.join(migrationsDirectory, file.name),
        "utf8"
    );

    return { ...file, sql, checksum: checksum(sql) };
}

async function ensureSchemaMigrationsTable(client) {
    await client.query(
        `
        CREATE TABLE IF NOT EXISTS ${schemaMigrationsTable} (
            name TEXT PRIMARY KEY,
            checksum TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            execution_ms INTEGER
        )
        `
    );
}

async function getAppliedMigrations(client) {
    const result = await client.query(
        `SELECT name, checksum FROM ${schemaMigrationsTable}`
    );

    return new Map(
        result.rows.map((row) => [row.name, row.checksum])
    );
}

async function detectLegacyDatabase(client) {
    const result = await client.query(
        "SELECT to_regclass('public.users') AS users_table"
    );

    return result.rows[0].users_table !== null;
}

function selectFiles(files, through) {
    if (!through) return files;
    return files.filter((file) => file.prefix <= through);
}

function reportChecksumDrift(logger, changed) {
    for (const name of changed) {
        logger.warn(
            `! ${name} has changed since it was applied. ` +
            "The database may not match the repository."
        );
    }
}

export async function runMigrations({
    through = null,
    baseline = false,
    status = false,
    logger = console
} = {}) {
    const client = await pool.connect();
    const report = {
        applied: [],
        baselined: [],
        pending: [],
        changed: [],
        skipped: []
    };

    try {
        // Two sessions cannot migrate the same database at the same time.
        await client.query("SELECT pg_advisory_lock(2026, 1111)");
        await ensureSchemaMigrationsTable(client);

        const files = await listMigrationFiles();
        const applied = await getAppliedMigrations(client);
        const selected = selectFiles(files, through);
        const legacyDatabase = await detectLegacyDatabase(client);

        for (const file of selected) {
            if (!applied.has(file.name)) continue;

            const migration = await readMigration(file);

            if (applied.get(file.name) !== migration.checksum) {
                report.changed.push(file.name);
            }
        }

        const pending = selected.filter((file) => !applied.has(file.name));

        if (status) {
            logger.log("SAP database migrations");

            for (const file of files) {
                if (applied.has(file.name)) {
                    logger.log(`  applied  ${file.name}`);
                } else if (selected.includes(file)) {
                    logger.log(`  pending  ${file.name}`);
                } else {
                    logger.log(`  after --through  ${file.name}`);
                }
            }

            report.pending = pending.map((file) => file.name);
            reportChecksumDrift(logger, report.changed);
            return report;
        }

        if (baseline && !legacyDatabase) {
            throw new Error(
                "This database does not contain the SAP schema yet, so " +
                "--baseline has nothing to record. Run \"npm run migrate\" " +
                "instead."
            );
        }

        if (baseline && legacyDatabase) {
            logger.warn(
                "! Baseline assumes the schema of every migration below is " +
                "already present. Use --through=NNN if the database stopped " +
                "at an earlier migration."
            );

            for (const file of pending) {
                const migration = await readMigration(file);

                await client.query(
                    `
                    INSERT INTO ${schemaMigrationsTable} (
                        name,
                        checksum,
                        execution_ms
                    )
                    VALUES ($1, $2, 0)
                    ON CONFLICT (name) DO NOTHING
                    `,
                    [migration.name, migration.checksum]
                );

                report.baselined.push(file.name);
                logger.log(`= baselined  ${file.name}`);
            }

            reportChecksumDrift(logger, report.changed);
            return report;
        }

        if (pending.length > 0 && legacyDatabase && applied.size === 0) {
            throw new Error(
                "This database already contains SAP tables but has no " +
                "migration history. Run " +
                "\"npm run migrate -- --baseline\" once to record the " +
                "existing schema, then run \"npm run migrate\" again."
            );
        }

        for (const file of pending) {
            const migration = await readMigration(file);
            const startedAt = Date.now();

            await client.query("BEGIN");

            try {
                await client.query(stripTransactionControl(migration.sql));

                await client.query(
                    `
                    INSERT INTO ${schemaMigrationsTable} (
                        name,
                        checksum,
                        execution_ms
                    )
                    VALUES ($1, $2, $3)
                    `,
                    [
                        migration.name,
                        migration.checksum,
                        Date.now() - startedAt
                    ]
                );

                await client.query("COMMIT");
            } catch (error) {
                await client.query("ROLLBACK");
                error.migrationName = migration.name;
                throw error;
            }

            report.applied.push(file.name);

            logger.log(
                `✓ applied  ${file.name} (${Date.now() - startedAt} ms)`
            );
        }

        reportChecksumDrift(logger, report.changed);
        return report;
    } finally {
        await client.query("SELECT pg_advisory_unlock(2026, 1111)")
            .catch(() => {});
        client.release();
    }
}

function printMigrateHelp() {
    console.log(`
SAP database migration runner

Usage:
  node database/migrate.js [options]

Options:
  --status          List applied and pending migrations without changing data.
  --through=NNN     Only consider migrations up to a three-digit prefix,
                    for example --through=008.
  --baseline        Record existing migrations as applied without running
                    them. Use once on databases created before this runner.
  -h, --help        Show this help.

Typical use:
  npm run db:setup      Create the schema and seed the demo accounts.
  npm run migrate       Apply only the migrations that are still pending.
`);
}

function printMigrationError(error) {
    console.error("\nMigration failed.");

    if (error.migrationName) {
        console.error(`File: ${error.migrationName}`);
    }

    console.error(`Reason: ${error.message}`);

    for (const field of ["detail", "hint", "position"]) {
        if (error[field]) {
            console.error(`${field}: ${error[field]}`);
        }
    }

    if (error.code === "42P01") {
        console.error(
            "Hint: a required table is missing. Run the earlier migrations " +
            "first, or run \"npm run db:setup\" on an empty database."
        );
    }

    if (error.code === "ECONNREFUSED") {
        console.error(
            "Hint: PostgreSQL is not reachable. Check DB_HOST, DB_PORT, and " +
            "that the PostgreSQL service is running."
        );
    }
}

async function main() {
    let options;

    try {
        options = parseMigrationArguments(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
        await pool.end();
        return;
    }

    if (options.help) {
        printMigrateHelp();
        await pool.end();
        return;
    }

    try {
        const report = await runMigrations(options);

        if (!options.status && !options.baseline) {
            console.log("");

            if (report.applied.length === 0) {
                console.log("Database is already up to date.");
            } else {
                console.log(
                    `Applied ${report.applied.length} migration(s). ` +
                    "Database is up to date."
                );
            }
        }

        if (report.baselined.length > 0) {
            console.log(
                `\nRecorded ${report.baselined.length} existing migration(s) ` +
                "as already applied."
            );
        }
    } catch (error) {
        printMigrationError(error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

const isMainModule =
    process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
    await main();
}

export default runMigrations;
