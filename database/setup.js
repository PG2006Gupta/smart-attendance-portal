import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pool from "../server/config/db.js";
import { runMigrations } from "./migrate.js";
import { seedAdministrator } from "./seed-admin.js";
import { seedUsers } from "./seed-users.js";

// =====================================================
// SAP FIRST-TIME DATABASE SETUP
// =====================================================
// One command creates the schema, seeds the demo accounts, and applies the
// seed data that depends on those accounts.
//
//   npm run db:setup
//
// The order matters: migration 009 only creates class offerings and
// enrollments when the demo student and teacher already exist, so it runs
// after seed-users. The command is safe to repeat.

const migrationsDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations"
);

// Seeds that reference the demo accounts created by seed-users. Migration
// 013 also removes the original single-student demo accounts.
const accountDependentSeeds = ["009", "013"];

async function findSeedFiles(prefixes) {
    const entries = (await fs.readdir(migrationsDirectory))
        .filter((name) => name.endsWith(".sql"))
        .filter((name) =>
            prefixes.some((prefix) => name.startsWith(prefix))
        )
        .sort((first, second) => first.localeCompare(second));

    return entries.map((name) => path.join(migrationsDirectory, name));
}

// These seeds are idempotent, so applying them again after the demo
// accounts exist also repairs databases where 009 ran too early and
// silently inserted nothing.
async function reapplyAccountDependentSeeds() {
    for (const file of await findSeedFiles(accountDependentSeeds)) {
        const sql = await fs.readFile(file, "utf8");
        await pool.query(sql);
        console.log(`= re-seeded ${path.basename(file)}`);
    }
}

async function main() {
    console.log("SAP database setup\n");

    // 1. Schema and reference data that do not need any user accounts.
    await runMigrations({ through: "008" });

    // 2. Demo student and teacher accounts.
    console.log("\nSeeding demo student and teacher accounts...");
    await seedUsers();

    // 3. Remaining migrations: offerings, enrollments, passkeys, admins.
    console.log("");
    await runMigrations();

    // 4. Repair account-dependent seeds that were applied too early.
    console.log("\nApplying account-dependent seed data...");
    await reapplyAccountDependentSeeds();

    // 5. Administrator account.
    console.log("\nSeeding the administrator account...");
    await seedAdministrator();

    console.log("\nDatabase setup complete.");
    console.log("Start the portal with: npm run dev");
}

main()
    .catch((error) => {
        console.error("\nDatabase setup failed.");
        console.error(error.message);

        if (error.migrationName) {
            console.error(`Migration: ${error.migrationName}`);
        }

        if (error.code === "3D000") {
            console.error(
                `The database "${process.env.DB_NAME || "sap"}" does not exist. ` +
                "Create it first, for example: createdb -U postgres sap"
            );
        } else if (
            error.code === "ECONNREFUSED" ||
            error.code === "ENOTFOUND"
        ) {
            console.error(
                "PostgreSQL is not reachable. Check DB_HOST, DB_PORT, and " +
                "that the PostgreSQL service is running."
            );
        }

        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
