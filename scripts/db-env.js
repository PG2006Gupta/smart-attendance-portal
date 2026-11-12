// =====================================================
// SAP DATABASE CONNECTION SETUP
// =====================================================
// Writes a .env file from one PostgreSQL connection string, so nobody has
// to retype a username, password, host, and database name by hand.
//
//   npm run db:env -- "postgresql://user:pass@host:5432/db?sslmode=require"
//
// The password may contain characters that a shell would otherwise
// mangle (@, $, ?, &, #), so quoting the whole string is the only thing
// this command asks of you. On PowerShell, wrap it in single quotes.
//
// Without an argument the connection string is read from a file, which
// is the safest route on Windows where quoting is easy to get wrong:
//
//   npm run db:env              reads connection-string.txt
//
// .env is in .gitignore, so the password is never committed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const stringFile = path.join(root, "connection-string.txt");

function fail(message) {
    console.error(`\n${message}\n`);
    process.exit(1);
}

function readConnectionString() {
    const fromArgument = process.argv[2];

    if (fromArgument) {
        return fromArgument.trim();
    }

    if (fs.existsSync(stringFile)) {
        return fs.readFileSync(stringFile, "utf8").trim();
    }

    return "";
}

const raw = readConnectionString();

if (!raw) {
    fail(
        [
            "No connection string found.",
            "",
            "Either put it in connection-string.txt, or pass it as an argument:",
            "  npm run db:env -- \"postgresql://user:pass@host/db\""
        ].join("\n")
    );
}

let url;

try {
    url = new URL(raw);
} catch {
    fail(
        [
            "That does not look like a connection string.",
            "",
            "It should start with postgresql:// and look like:",
            "  postgresql://user:password@host:5432/dbname?sslmode=require"
        ].join("\n")
    );
}

if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    fail(`Unexpected protocol "${url.protocol}". It should be postgresql://`);
}

// Neon and Supabase both offer a pooled endpoint. Migrations run inside
// transactions and rely on connection state, so the direct endpoint is
// the correct choice for db:setup and for a long-running server.
if (url.hostname.includes("-pooler")) {
    fail(
        [
            "That is the POOLED connection string (the host contains -pooler).",
            "",
            "Use the DIRECT string instead: remove '-pooler' from the host,",
            "or turn off 'Connection pooling' in the dashboard and copy again."
        ].join("\n")
    );
}

const host = url.hostname;
const port = url.port || "5432";
const database = url.pathname.replace(/^\//, "");
const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);

if (!host || !database || !user || !password) {
    fail(
        [
            "The connection string is missing a piece.",
            "",
            "Expected: postgresql://user:password@host:5432/dbname",
            `Got host=${host || "MISSING"} db=${database || "MISSING"} ` +
                `user=${user || "MISSING"} password=${password ? "ok" : "MISSING"}`
        ].join("\n")
    );
}

const values = {
    DB_HOST: host,
    DB_PORT: port,
    DB_NAME: database,
    DB_USER: user,
    DB_PASSWORD: password,
    DB_SSL: "true"
};

// Keep anything already configured, so re-running this to change only
// the host does not wipe unrelated settings.
const existing = new Map();

if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);

        if (match) {
            existing.set(match[1], match[2]);
        }
    }
}

for (const [key, value] of Object.entries(values)) {
    existing.set(key, value);
}

// Demo passwords are required by db:setup. Fill them in when absent.
existing.set("SEED_STUDENT_PASSWORD", existing.get("SEED_STUDENT_PASSWORD") || "student-password-12");
existing.set("SEED_TEACHER_PASSWORD", existing.get("SEED_TEACHER_PASSWORD") || "teacher-password-12");
existing.set("SEED_ADMIN_PASSWORD", existing.get("SEED_ADMIN_PASSWORD") || "administrator-password-12");

const order = [
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "DB_SSL",
    "SEED_STUDENT_PASSWORD",
    "SEED_TEACHER_PASSWORD",
    "SEED_ADMIN_PASSWORD"
];

const lines = [
    "# =====================================================",
    "# SAP local environment",
    "# =====================================================",
    "# Written by `npm run db:env`. This file is in .gitignore.",
    "# Never commit it: it holds a real database password.",
    "",
    "# Database (Neon, Render, or any PostgreSQL provider)",
    ...order.slice(0, 6).map((key) => `${key}=${existing.get(key)}`),
    "",
    "# Demo account passwords, used once by `npm run db:setup`",
    ...order.slice(6).map((key) => `${key}=${existing.get(key)}`),
    ""
];

fs.writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });

console.log("\nWrote .env");
console.log(`  DB_HOST     = ${host}:${port}`);
console.log(`  DB_NAME     = ${database}`);
console.log(`  DB_USER     = ${user}`);
console.log(`  DB_PASSWORD = (${password.length} characters, hidden)`);
console.log(`  DB_SSL      = true`);
console.log(`\nFile: ${envPath}`);

if (password.length < 8) {
    console.log(
        "\nWarning: that password looks short. Check that the whole" +
            " connection string was copied."
    );
}

console.log("\nNext: run  npm run db:setup\n");
