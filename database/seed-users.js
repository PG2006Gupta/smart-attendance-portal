import "dotenv/config";
import argon2 from "argon2";
import pool from "../server/config/db.js";

async function seedUsers() {
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

    // Hash before opening the database transaction
    const [studentPasswordHash, teacherPasswordHash] = await Promise.all([
        argon2.hash(studentPassword, {
            type: argon2.argon2id
        }),

        argon2.hash(teacherPassword, {
            type: argon2.argon2id
        })
    ]);

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // ================= STUDENT USER =================

        const studentUserResult = await client.query(
            `
            INSERT INTO users (
                login_id,
                password_hash,
                role
            )
            VALUES ($1, $2, 'student')
            ON CONFLICT (login_id) DO UPDATE
            SET
                password_hash = EXCLUDED.password_hash,
                role = EXCLUDED.role,
                is_active = TRUE,
                updated_at = NOW()
            RETURNING id
            `,
            ["CU123456", studentPasswordHash]
        );

        const studentUserId = studentUserResult.rows[0].id;

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
            [studentUserId, "CU123456", "Pragun"]
        );

        // ================= TEACHER USER =================

        const teacherUserResult = await client.query(
            `
            INSERT INTO users (
                login_id,
                password_hash,
                role
            )
            VALUES ($1, $2, 'teacher')
            ON CONFLICT (login_id) DO UPDATE
            SET
                password_hash = EXCLUDED.password_hash,
                role = EXCLUDED.role,
                is_active = TRUE,
                updated_at = NOW()
            RETURNING id
            `,
            ["TCH1001", teacherPasswordHash]
        );

        const teacherUserId = teacherUserResult.rows[0].id;

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
                teacherUserId,
                "TCH1001",
                "Teacher",
                "Computer Science & Engineering",
                "teacher@sap.edu"
            ]
        );

        await client.query("COMMIT");

        console.log("Student account ready: CU123456");
        console.log("Teacher account ready: TCH1001");
        console.log("Passwords were stored only as Argon2id hashes.");

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

seedUsers()
    .catch((error) => {
        console.error("User seeding failed:");
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });