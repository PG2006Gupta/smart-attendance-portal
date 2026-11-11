import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    DEMO_STUDENTS,
    DEMO_TEACHERS,
    REMOVED_DEMO_LOGIN_IDS
} from "../database/demo-cohort.js";

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
);

const cohortMigration = fs.readFileSync(
    path.join(root, "database/migrations/013_seed_demo_cohort.sql"),
    "utf8"
);

// 014 regroups teachers and students, so it must agree with the cohort too.
const regroupMigration = fs.readFileSync(
    path.join(root, "database/migrations/014_regroup_demo_teaching.sql"),
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

test("Migration 014 assigns each teacher exactly the cohort's subjects", () => {
    for (const teacher of DEMO_TEACHERS) {
        const assignments = [
            ...regroupMigration.matchAll(
                new RegExp(`\\('${teacher.loginId}', '([A-Z]+)'\\)`, "g")
            )
        ].map((match) => match[1]);

        assert.deepEqual(
            [...new Set(assignments)].sort(),
            [...teacher.subjects].sort(),
            `${teacher.fullName} assignments in 014 do not match the cohort`
        );
    }
});

test("Migration 014 groups each student under the cohort's teacher", () => {
    for (const student of DEMO_STUDENTS) {
        const assignment = regroupMigration.match(
            new RegExp(`\\('${student.loginId}', '(TCH\\d{4})'\\)`)
        );

        assert.ok(
            assignment,
            `${student.fullName} is missing from 014`
        );
        assert.equal(
            assignment[1],
            student.teacher,
            `${student.fullName} points at the wrong teacher in 014`
        );
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

test("Every teacher teaches exactly two subjects", () => {
    for (const teacher of DEMO_TEACHERS) {
        assert.equal(
            teacher.subjects.length,
            2,
            `${teacher.fullName} has ${teacher.subjects.length} subjects`
        );
    }

    const slots = DEMO_TEACHERS.flatMap((teacher) => teacher.subjects);
    assert.equal(slots.length, 8);
});

test("Every teacher's subjects exist in the seeded subject list", () => {
    const seededSubjects = ["DBMS", "JAVA", "COA", "DSA", "MATH"];

    for (const teacher of DEMO_TEACHERS) {
        for (const subject of teacher.subjects) {
            assert.ok(
                seededSubjects.includes(subject),
                `${teacher.fullName} teaches unknown subject ${subject}`
            );
        }

        assert.equal(
            new Set(teacher.subjects).size,
            teacher.subjects.length,
            `${teacher.fullName} teaches the same subject twice`
        );
    }
});

test("Every student belongs to exactly one teacher with at least one student", () => {
    const teacherIds = DEMO_TEACHERS.map((teacher) => teacher.loginId);

    for (const student of DEMO_STUDENTS) {
        assert.ok(
            teacherIds.includes(student.teacher),
            `${student.fullName} has unknown teacher ${student.teacher}`
        );
    }

    const groups = teacherIds.map((loginId) =>
        DEMO_STUDENTS.filter((student) => student.teacher === loginId)
    );

    for (const group of groups) {
        assert.ok(group.length >= 1);
    }

    assert.equal(
        groups.reduce((total, group) => total + group.length, 0),
        DEMO_STUDENTS.length
    );
});

test("The student groups add up to 10 across 4 teachers", () => {
    const sizes = DEMO_TEACHERS.map(
        (teacher) =>
            DEMO_STUDENTS.filter(
                (student) => student.teacher === teacher.loginId
            ).length
    );

    assert.equal(sizes.length, 4);
    assert.equal(sizes.reduce((total, size) => total + size, 0), 10);
    assert.deepEqual(sizes, [4, 3, 2, 1]);
});

test("Every student ends up enrolled in both of their teacher's subjects", () => {
    // 4 + 3 + 2 + 1 students, 2 subjects each.
    const expectedEnrollments = DEMO_STUDENTS.reduce((total, student) => {
        const teacher = DEMO_TEACHERS.find(
            (item) => item.loginId === student.teacher
        );

        return total + teacher.subjects.length;
    }, 0);

    assert.equal(expectedEnrollments, 20);
});
