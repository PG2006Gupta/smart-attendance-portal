// =====================================================
// SAP DATABASE CONNECTION DIAGNOSTIC
// =====================================================
// Answers one question: can this machine log in to the database with the
// settings in .env?
//
//   npm run db:check
//
// It prints everything that commonly differs between a working setup and a
// failing one: the exact host, port, user, database, and password length,
// plus whether any stray characters ended up in the values. The password
// itself is never printed.
//
// Exit codes: 0 = connected, 1 = could not connect.

import "dotenv/config";

import pg from "pg";

const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
const missing = required.filter((key) => !process.env[key]);

console.log("Settings loaded from .env\n");

for (const key of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER"]) {
    console.log(`  ${key.padEnd(12)} = ${process.env[key] || "(missing)"}`);
}

const password = process.env.DB_PASSWORD || "";

console.log(
    `  DB_PASSWORD  = (${password.length} characters, not shown here)`
);
console.log(`  DB_SSL       = ${process.env.DB_SSL || "(not set)"}`);
console.log("");

if (missing.length > 0) {
    console.error(`Missing required settings: ${missing.join(", ")}`);
    console.error("Run `npm run db:env` to create .env from a connection string.");
    process.exit(1);
}

// Whitespace and quoting are the two ways a password silently breaks. A
// value copied from a web page often carries a trailing space or newline.
const problems = [];

if (password !== password.trim()) {
    problems.push(
        "DB_PASSWORD starts or ends with whitespace." +
            " Re-copy it without selecting the space around it."
    );
}

if (
    (password.startsWith('"') && password.endsWith('"')) ||
    (password.startsWith("'") && password.endsWith("'"))
) {
    problems.push(
        "DB_PASSWORD is wrapped in quotes. The quotes are stored as part" +
            " of the value and make the password wrong."
    );
}

if (password.includes("@")) {
    problems.push(
        "DB_PASSWORD contains an '@'. That usually means the host name" +
            " was copied into the password."
    );
}

if (/^DB_[A-Z_]+=/.test(password)) {
    problems.push(
        "DB_PASSWORD contains 'KEY=value'. Paste only the password," +
            " not the whole line."
    );
}

if (/\s/.test(password)) {
    problems.push("DB_PASSWORD contains a space inside it.");
}

// Neon passwords are npg_ followed by 16 characters. A different length
// means the copy was cut short, or extra text got included.
if (password.startsWith("npg_") && password.length !== 20) {
    const explanation =
        password.length < 20
            ? "The copy was probably cut off."
            : "Something extra was copied along with it.";

    problems.push(
        `DB_PASSWORD looks like a Neon password but is ${password.length}` +
            ` characters. Neon passwords are 20 (npg_ plus 16). ${explanation}`
    );
}

if (problems.length > 0) {
    console.log("Problems found in .env:\n");

    for (const problem of problems) {
        console.log(`  - ${problem}`);
    }

    console.log("");
}

const useSsl = process.env.DB_SSL === "true";

const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password,
    ssl: useSsl
        ? {
            rejectUnauthorized:
                process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false"
        }
        : undefined,
    connectionTimeoutMillis: 15000
});

try {
    const result = await pool.query(
        "SELECT current_database() AS database_name, current_user AS user_name"
    );

    console.log("Connected successfully.");
    console.log(`  database = ${result.rows[0].database_name}`);
    console.log(`  user     = ${result.rows[0].user_name}`);
    console.log("");

    if (problems.length > 0) {
        console.log(
            "Note: the connection worked even though the warnings above" +
                " were reported. Worth cleaning up, but not the cause of a" +
                " failure."
        );
    }

    await pool.end();
    process.exit(0);
} catch (error) {
    console.error("Could not connect.\n");
    console.error(`  message = ${error.message}`);

    if (error.code) {
        console.error(`  code    = ${error.code}`);
    }

    console.error("");

    if (error.code === "28P01") {
        console.log("28P01 means the password was rejected.");
        console.log("  The host and user are correct, so the password is wrong.");
        console.log("  Copy it again from Neon (Roles -> Reset password shows it once).");
    } else if (error.code === "3D000") {
        console.log("3D000 means that database does not exist on this server.");
        console.log("  Check DB_NAME. Neon creates a database called neondb.");
    } else if (error.code === "ENOTFOUND") {
        console.log("ENOTFOUND means the host name does not resolve.");
        console.log("  Check DB_HOST for typos: letter i vs digit 1 is common,");
        console.log("  and the host must not contain '-pooler' for migrations.");
    } else if (error.code === "ETIMEDOUT" || /timeout/i.test(error.message)) {
        console.log("A timeout usually means the host is unreachable.");
        console.log("  Check DB_HOST and that the Neon project is awake.");
    } else if (error.code === "28000") {
        console.log("28000 is an authentication or access-rule rejection.");
        console.log("  Check DB_USER and any IP allow-list on the database.");
    }

    await pool.end();
    process.exit(1);
}
