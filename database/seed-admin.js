import "dotenv/config";

import argon2 from "argon2";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pool from "../server/config/db.js";

export async function seedAdministrator({ logger = console } = {}) {
    const password = process.env.SEED_ADMIN_PASSWORD;
    const loginId = (
        process.env.SEED_ADMIN_LOGIN_ID || "ADM1001"
    ).toUpperCase();
    const fullName =
        process.env.SEED_ADMIN_NAME || "SAP Administrator";
    const email = process.env.SEED_ADMIN_EMAIL || null;

    if (!password || password.length < 12) {
        throw new Error(
            "SEED_ADMIN_PASSWORD must contain at least 12 characters."
        );
    }

    if (
        password === process.env.SEED_STUDENT_PASSWORD ||
        password === process.env.SEED_TEACHER_PASSWORD
    ) {
        throw new Error(
            "The administrator password must be different from the student and teacher passwords."
        );
    }

    const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id
    });
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const userResult = await client.query(
            `
            INSERT INTO users (login_id, password_hash, role)
            VALUES ($1, $2, 'admin')
            ON CONFLICT (login_id) DO UPDATE
            SET
                password_hash = EXCLUDED.password_hash,
                is_active = TRUE,
                updated_at = NOW()
            WHERE users.role = 'admin'
            RETURNING id
            `,
            [loginId, passwordHash]
        );

        if (userResult.rowCount === 0) {
            throw new Error(
                "That login ID already belongs to a non-administrator account. Choose a different SEED_ADMIN_LOGIN_ID."
            );
        }

        await client.query(
            `
            INSERT INTO administrators (user_id, full_name, email)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE
            SET
                full_name = EXCLUDED.full_name,
                email = EXCLUDED.email,
                updated_at = NOW()
            `,
            [userResult.rows[0].id, fullName, email]
        );

        await client.query("COMMIT");
        logger.log(`Administrator account ready: ${loginId}`);
        logger.log("The password was stored only as an Argon2id hash.");

        return { administratorUserId: userResult.rows[0].id, loginId };
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
    seedAdministrator()
        .catch((error) => {
            console.error("Administrator seeding failed:");
            console.error(error.message);
            process.exitCode = 1;
        })
        .finally(async () => {
            await pool.end();
        });
}
