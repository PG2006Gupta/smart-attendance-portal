import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    DEMO_STUDENTS,
    DEMO_TEACHERS,
    REMOVED_DEMO_LOGIN_IDS,
    SECONDARY_SECTION,
    SECTION
} from "../database/demo-cohort.js";

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
);

const cohortMigration = fs.readFileSync(
    path.join(root, "database/migrations/013_seed_demo_cohort.sql"),
    "utf8"
);

test("The demo cohort has 10 students and 4 teachers", () => {
    assert.equal(DEMO_STUDENTS.length, 10);
    assert.equal(DEMO_TEACHERS.length, 4);
});

test("Students are named Student 1 through Student 10", () => {
    assert.deepEqual(
        DEMO_STUDENTS.map((student) => student.fullName),
        Array.from({ length: 10 }, (_, index) => `Student ${index + 1}`)
    );
});

test("Teachers are named Teacher 1 through Teacher 4", () => {
    assert.deepEqual(
        DEMO_TEACHERS.map((teacher) => teacher.fullName),
        Array.from({ length: 4 }, (_, index) => `Teacher ${index + 1}`)
    );
});

test("Login IDs are unique and use the documented formats", () => {
    const loginIds = [
        ...DEMO_STUDENTS.map((student) => student.loginId),
        ...DEMO_TEACHERS.map((teacher) => teacher.loginId)
    ];

    assert.equal(new Set(loginIds).size, loginIds.length);

    for (const student of DEMO_STUDENTS) {
        assert.match(student.loginId, /^CU\d{6}$/);
        assert.equal(student.number, Number(student.loginId.slice(2)) - 230100);
    }

    for (const teacher of DEMO_TEACHERS) {
        assert.match(teacher.loginId, /^TCH\d{4}$/);
    }
});

test("The previous demo accounts are recorded as removed", () => {
    assert.deepEqual(REMOVED_DEMO_LOGIN_IDS, ["CU123456", "TCH1001"]);

    for (const loginId of REMOVED_DEMO_LOGIN_IDS) {
        assert.ok(cohortMigration.includes(loginId));

        const stillSeeded = [
            ...DEMO_STUDENTS.map((student) => student.loginId),
            ...DEMO_TEACHERS.map((teacher) => teacher.loginId)
        ].includes(loginId);

        assert.equal(stillSeeded, false);
    }
});

test("Migration 013 seeds exactly the students and teachers in the cohort", () => {
    const studentIds = DEMO_STUDENTS.map((student) => student.loginId);
    const teacherIds = DEMO_TEACHERS.map((teacher) => teacher.loginId);

    for (const loginId of [...studentIds, ...teacherIds]) {
        assert.ok(
            cohortMigration.includes(loginId),
            `${loginId} is missing from migration 013`
        );
    }

    // No other CU/TCH numbers are seeded.
    const seededLogins = [
        ...cohortMigration.matchAll(/\b(CU\d{6}|TCH\d{4})\b/g)
    ].map((match) => match[1]);

    const unexpected = [...new Set(seededLogins)].filter(
        (loginId) =>
            ![...studentIds, ...teacherIds, ...REMOVED_DEMO_LOGIN_IDS]
                .includes(loginId)
    );

    assert.deepEqual(unexpected, []);
});

test("Every teacher takes at least one subject in at least one section", () => {
    for (const teacher of DEMO_TEACHERS) {
        assert.ok(teacher.subjects.length > 0);
        assert.ok(teacher.sections.length > 0);
    }
});

test("The second section is used only by the students assigned to it", () => {
    const secondaryStudents = DEMO_STUDENTS.filter(
        (student) => student.section === "secondary"
    );
    const mainStudents = DEMO_STUDENTS.filter(
        (student) => student.section === "main"
    );

    assert.equal(secondaryStudents.length, 2);
    assert.equal(mainStudents.length, 8);
    assert.notEqual(SECTION.name, SECONDARY_SECTION.name);

    for (const student of secondaryStudents) {
        assert.equal(student.subjects, "secondary");
    }
});
