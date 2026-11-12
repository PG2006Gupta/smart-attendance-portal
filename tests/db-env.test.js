import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
);

const script = path.join(root, "scripts/db-env.js");

// Run the script inside a throwaway directory so a real .env is never
// touched. The script resolves .env relative to the repository, so the
// test copies the script next to a temporary .env instead.
async function runInSandbox(argument, { connectionStringFile } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sap-dbenv-"));

    fs.mkdirSync(path.join(directory, "scripts"));
    fs.copyFileSync(script, path.join(directory, "scripts/db-env.js"));

    if (connectionStringFile !== undefined) {
        fs.writeFileSync(
            path.join(directory, "connection-string.txt"),
            connectionStringFile
        );
    }

    try {
        const result = await run(
            process.execPath,
            [path.join(directory, "scripts/db-env.js"), ...(argument ? [argument] : [])],
            { cwd: directory }
        );

        return {
            stdout: result.stdout,
            env: fs.readFileSync(path.join(directory, ".env"), "utf8")
        };
    } catch (error) {
        return { failed: true, stderr: error.stderr || error.message };
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test("db:env writes host, port, database, user, and password", async () => {
    const { env } = await runInSandbox(
        "postgresql://neondb_owner:npg_secret123@ep-cool-darkness-a1b2c3d4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
    );

    assert.match(env, /^DB_HOST=ep-cool-darkness-a1b2c3d4\.ap-southeast-1\.aws\.neon\.tech$/m);
    assert.match(env, /^DB_PORT=5432$/m);
    assert.match(env, /^DB_NAME=neondb$/m);
    assert.match(env, /^DB_USER=neondb_owner$/m);
    assert.match(env, /^DB_PASSWORD=npg_secret123$/m);
    assert.match(env, /^DB_SSL=true$/m);
});

test("db:env decodes a password containing URL-encoded characters", async () => {
    // @ and # must be percent-encoded in a URL; the script must turn them
    // back into the real password, otherwise authentication fails.
    const { env } = await runInSandbox(
        "postgresql://user:p%40ss%23word@host.example.com:5432/db"
    );

    assert.match(env, /^DB_PASSWORD=p@ss#word$/m);
});

test("db:env fills in the demo seed passwords", async () => {
    const { env } = await runInSandbox(
        "postgresql://user:password@host.example.com/db"
    );

    assert.match(env, /^SEED_STUDENT_PASSWORD=student-password-12$/m);
    assert.match(env, /^SEED_TEACHER_PASSWORD=teacher-password-12$/m);
    assert.match(env, /^SEED_ADMIN_PASSWORD=administrator-password-12$/m);
});

test("db:env accepts the connection string from a file", async () => {
    const { env } = await runInSandbox(null, {
        connectionStringFile:
            "\n  postgresql://user:password@host.example.com:5432/db?sslmode=require  \n\n"
    });

    assert.match(env, /^DB_HOST=host\.example\.com$/m);
    assert.match(env, /^DB_NAME=db$/m);
});

test("db:env rejects a pooled connection string", async () => {
    const result = await runInSandbox(
        "postgresql://user:password@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb"
    );

    assert.equal(result.failed, true);
    assert.match(result.stderr, /POOLED/);
});

test("db:env rejects a string that is not a URL", async () => {
    const result = await runInSandbox("not-a-connection-string");

    assert.equal(result.failed, true);
    assert.match(result.stderr, /does not look like a connection string/);
});

test("db:env refuses to guess when nothing is provided", async () => {
    const result = await runInSandbox(null);

    assert.equal(result.failed, true);
    assert.match(result.stderr, /No connection string found/);
});

test("db:env keeps settings that are already in .env", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sap-dbenv-"));

    fs.mkdirSync(path.join(directory, "scripts"));
    fs.copyFileSync(script, path.join(directory, "scripts/db-env.js"));
    fs.writeFileSync(
        path.join(directory, ".env"),
        "DB_HOST=old.example.com\nDB_PASSWORD=old\nSEED_STUDENT_PASSWORD=custom-password-12\n"
    );

    await run(
        process.execPath,
        [
            path.join(directory, "scripts/db-env.js"),
            "postgresql://user:newpassword@new.example.com:5432/appdb"
        ],
        { cwd: directory }
    );

    const env = fs.readFileSync(path.join(directory, ".env"), "utf8");

    try {
        assert.match(env, /^DB_HOST=new\.example\.com$/m);
        assert.match(env, /^DB_PASSWORD=newpassword$/m);
        // A custom seed password must survive: re-running db:env to change
        // the host should not silently reset demo passwords.
        assert.match(env, /^SEED_STUDENT_PASSWORD=custom-password-12$/m);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
