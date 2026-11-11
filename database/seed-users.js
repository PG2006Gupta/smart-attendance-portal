import "dotenv/config";

import argon2 from "argon2";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pool from "../server/config/db.js";
import {
    DEMO_STUDENTS,
    DEMO_TEACHERS,
    DEPARTMENT,
    demoTeacherEmail
} from "./demo-cohort.js";

// =====================================================
// SAP DEMO ACCOUNTS
// =====================================================
// Creates the 10 demo students and 4 demo teachers defined in
// database/demo-cohort.js. Every account in a group shares that group's
// password from .env, so a demo does not need 14 passwords.
//
//   SEED_STUDENT_PASSWORD   used by all 10 students
//   SEED_TEACHER_PASSWORD   used by all 4 teachers
//
// Passwords are Argon2id hashes, which is why accounts are created here
// rather than in SQL. Offerings and enrollments live in migration 013.

const HASH_OPTIONS = { type: argon2.argon2id };

export function readSeedPasswords() {
    const studentPassword = process.env.SEED_STUDENT_PASSWORD;
    const teacherPassword = process.env.SEED_TEACHER_PASSWORD;

    if (!studentPassword || !teacherPassword) {
        throw new Error(
            "SEED_STUDENT_PASSWORD and SEED_TEACHER_PASSWORD must be set in .env"
        );
    }

    if (studentPassword.length < 12 || teacherPassword.length < 12) {
        throw new Error(
            "Both development passwords must contain at least 12 characters."
        );
    }

    if (studentPassword === teacherPassword) {
        throw new Error(
            "Student and teacher development passwords must be different."
        );
    }

    return { studentPassword, teacherPassword };
}

// Hash once per group. Argon2 is deliberately slow, and every account in a
// group shares the same password anyway.
async function hashGroupPasswords({ studentPassword, teacherPassword }) {
    const [studentHash, teacherHash] = await Promise.all([
        argon2.hash(studentPassword, HASH_OPTIONS),
        argon2.hash(teacherPassword, HASH_OPTIONS)
    ]);

    return { studentHash, teacherHash };
}

async function upsertUser(client, { loginId, passwordHash, role }) {
    const result = await client.query(
        `
        INSERT INTO users (login_id, password_hash, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (login_id) DO UPDATE
        SET
            password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role,
            is_active = TRUE,
            updated_at = NOW()
        RETURNING id
        `,
        [loginId, passwordHash, role]
    );

    return result.rows[0].id;
}

export async function seedUsers({ logger = console } = {}) {
    const passwords = await hashGroupPasswords(readSeedPasswords());

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // ================= STUDENTS =================

        for (const student of DEMO_STUDENTS) {
            const userId = await upsertUser(client, {
                loginId: student.loginId,
                passwordHash: passwords.studentHash,
                role: "student"
            });

            await client.query(
                `
                INSERT INTO students (
                    user_id,
                    student_number,
                    full_name
                )
                VALUES ($1, $2, $3)
                ON CONFLICT (user_id) DO UPDATE
                SET
                    student_number = EXCLUDED.student_number,
                    full_name = EXCLUDED.full_name,
                    updated_at = NOW()
                `,
                [userId, student.loginId, student.fullName]
            );
        }

        // ================= TEACHERS =================

        for (const teacher of DEMO_TEACHERS) {
            const userId = await upsertUser(client, {
                loginId: teacher.loginId,
                passwordHash: passwords.teacherHash,
                role: "teacher"
            });

            await client.query(
                `
                INSERT INTO teachers (
                    user_id,
                    teacher_number,
                    full_name,
                    department,
                    email
                )
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (user_id) DO UPDATE
                SET
                    teacher_number = EXCLUDED.teacher_number,
                    full_name = EXCLUDED.full_name,
                    department = EXCLUDED.department,
                    email = EXCLUDED.email,
                    updated_at = NOW()
                `,
                [
                    userId,
                    teacher.loginId,
                    teacher.fullName,
                    DEPARTMENT,
                    demoTeacherEmail(teacher.number)
                ]
            );
        }

        await client.query("COMMIT");

        logger.log(
            `${DEMO_STUDENTS.length} student accounts ready: ` +
            `${DEMO_STUDENTS[0].loginId} to ` +
            `${DEMO_STUDENTS[DEMO_STUDENTS.length - 1].loginId}`
        );

        logger.log(
            `${DEMO_TEACHERS.length} teacher accounts ready: ` +
            `${DEMO_TEACHERS[0].loginId} to ` +
            `${DEMO_TEACHERS[DEMO_TEACHERS.length - 1].loginId}`
        );

        logger.log("Passwords were stored only as Argon2id hashes.");

        return {
            students: DEMO_STUDENTS.length,
            teachers: DEMO_TEACHERS.length
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

const isMainModule =
    process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
    seedUsers()
        .catch((error) => {
            console.error("User seeding failed:");
            console.error(error.message);
            process.exitCode = 1;
        })
        .finally(async () => {
            await pool.end();
        });
}
