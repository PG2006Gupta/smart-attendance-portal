import test from "node:test";
import assert from "node:assert/strict";
import {
    checksum,
    parseMigrationArguments,
    stripTransactionControl
} from "../database/migrate.js";

test("Transaction control lines are removed from migration files", () => {
    const sql = [
        "-- SAP migration 009",
        "BEGIN;",
        "",
        "INSERT INTO subjects (code) VALUES ('DBMS');",
        "  commit ;",
        "COMMIT;",
        ""
    ].join("\r\n");

    const cleaned = stripTransactionControl(sql);

    assert.ok(!/^\s*(BEGIN|COMMIT)\s*;/im.test(cleaned));
    assert.ok(cleaned.includes("INSERT INTO subjects"));
    assert.ok(cleaned.includes("-- SAP migration 009"));
});

test("Words that merely start with BEGIN are preserved", () => {
    const sql = [
        "BEGIN;",
        "SELECT * FROM beginners;",
        "COMMIT;"
    ].join("\n");

    const cleaned = stripTransactionControl(sql);

    assert.ok(cleaned.includes("SELECT * FROM beginners;"));
});

test("A byte order mark does not change the applied checksum", () => {
    const plain = "-- SAP migration 001\nCREATE TABLE demo ();\n";
    const withBom = `\uFEFF${plain}`;

    assert.equal(checksum(withBom), checksum(plain));
    assert.match(checksum(plain), /^[0-9a-f]{64}$/);
});

test("Migration arguments default to a normal apply", () => {
    assert.deepEqual(parseMigrationArguments([]), {
        through: null,
        baseline: false,
        status: false,
        help: false
    });
});

test("Migration arguments support status, baseline, and through", () => {
    assert.deepEqual(
        parseMigrationArguments(["--through=008", "--baseline"]),
        {
            through: "008",
            baseline: true,
            status: false,
            help: false
        }
    );

    assert.equal(
        parseMigrationArguments(["--status"]).status,
        true
    );
    assert.equal(parseMigrationArguments(["-h"]).help, true);
});

test("A malformed through value is rejected", () => {
    assert.throws(
        () => parseMigrationArguments(["--through=8"]),
        /three-digit/
    );
});

test("An unknown flag is rejected", () => {
    assert.throws(
        () => parseMigrationArguments(["--force"]),
        /Unknown migration option/
    );
});
