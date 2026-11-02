import { Router } from "express";
import { z } from "zod";
import pool from "../config/db.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();
router.use(requireRole("admin"));

const reasonSchema = z.string().trim().min(3).max(300);
const windowSchema = z.object({
    action: z.enum(["open", "close"]),
    durationMinutes: z.coerce.number().int().min(5).max(60).default(15),
    reason: reasonSchema
});
const resetSchema = z.object({
    durationMinutes: z.coerce.number().int().min(5).max(60).default(15),
    reason: reasonSchema
});

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

async function getStudentRegistration(client, studentId, lock = false) {
    const result = await client.query(
        `
        SELECT
            students.user_id AS student_id,
            students.student_number,
            students.full_name,
            students.device_registration_opens_at AS opens_at,
            students.device_registration_expires_at AS expires_at,
            students.device_registration_locked_at AS locked_at,
            (
                students.device_registration_locked_at IS NULL
                AND students.device_registration_opens_at <= NOW()
                AND students.device_registration_expires_at > NOW()
            ) AS window_open,
            (
                SELECT COUNT(*)
                FROM student_devices
                WHERE
                    student_id = students.user_id
                    AND status IN ('pending', 'active')
            )::integer AS device_count
        FROM students
        WHERE students.user_id = $1
        ${lock ? "FOR UPDATE" : ""}
        `,
        [studentId]
    );

    return result.rows[0] || null;
}

async function recordAction(
    client,
    { adminId, studentId, deviceId = null, action, reason }
) {
    await client.query(
        `
        INSERT INTO device_admin_actions (
            admin_id,
            student_id,
            device_id,
            action,
            reason
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [adminId, studentId, deviceId, action, reason]
    );
}

router.get("/overview", async (request, response, next) => {
    try {
        const [profileResult, statsResult] = await Promise.all([
            pool.query(
                `
                SELECT full_name, email
                FROM administrators
                WHERE user_id = $1
                `,
                [request.session.user.id]
            ),
            pool.query(
                `
                SELECT
                    (SELECT COUNT(*) FROM students)::integer AS total_students,
                    (
                        SELECT COUNT(*)
                        FROM student_devices
                        WHERE status IN ('pending', 'active')
                    )::integer AS current_devices,
                    (
                        SELECT COUNT(*)
                        FROM students
                        WHERE
                            device_registration_locked_at IS NULL
                            AND device_registration_opens_at <= NOW()
                            AND device_registration_expires_at > NOW()
                    )::integer AS open_windows,
                    (
                        SELECT COUNT(*)
                        FROM students
                        WHERE NOT (
                            device_registration_locked_at IS NULL
                            AND device_registration_opens_at <= NOW()
                            AND device_registration_expires_at > NOW()
                        )
                    )::integer AS locked_students
                `
            )
        ]);

        response.json({
            profile: profileResult.rows[0] || null,
            stats: statsResult.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

router.get("/students", async (request, response, next) => {
    try {
        const query = String(request.query.query || "")
            .trim()
            .slice(0, 100);

        const result = await pool.query(
            `
            SELECT
                students.user_id AS student_id,
                students.student_number,
                students.full_name,
                (
                    SELECT COUNT(*)
                    FROM student_devices
                    WHERE
                        student_id = students.user_id
                        AND status IN ('pending', 'active')
                )::integer AS device_count,
                CASE
                    WHEN
                        students.device_registration_locked_at IS NULL
                        AND students.device_registration_opens_at <= NOW()
                        AND students.device_registration_expires_at > NOW()
                        THEN 'open'
                    WHEN
                        students.device_registration_locked_at IS NULL
                        AND students.device_registration_expires_at <= NOW()
                        THEN 'expired'
                    ELSE 'locked'
                END AS registration_status,
                students.device_registration_expires_at
            FROM students
            WHERE
                $1 = ''
                OR students.student_number ILIKE '%' || $1 || '%'
                OR students.full_name ILIKE '%' || $1 || '%'
            ORDER BY students.full_name, students.student_number
            LIMIT 50
            `,
            [query]
        );

        response.json({ students: result.rows });
    } catch (error) {
        next(error);
    }
});

router.get("/students/:studentId/devices", async (request, response, next) => {
    const studentId = parseId(request.params.studentId);

    if (!studentId) {
        return response.status(400).json({ error: "Invalid student ID." });
    }

    const client = await pool.connect();

    try {
        const student = await getStudentRegistration(client, studentId);

        if (!student) {
            return response.status(404).json({
                error: "Student not found."
            });
        }

        const devices = await client.query(
            `
            SELECT
                id AS device_id,
                credential_id,
                device_slot,
                device_name,
                status,
                registered_at,
                last_used_at,
                revoked_at
            FROM student_devices
            WHERE student_id = $1
            ORDER BY
                CASE WHEN status = 'revoked' THEN 1 ELSE 0 END,
                device_slot,
                registered_at DESC NULLS LAST
            `,
            [studentId]
        );

        response.json({
            student,
            devices: devices.rows,
            registration: {
                windowOpen: student.window_open,
                canRegister:
                    student.window_open && student.device_count < 2,
                opensAt: student.opens_at,
                expiresAt: student.expires_at,
                lockedAt: student.locked_at
            }
        });
    } catch (error) {
        next(error);
    } finally {
        client.release();
    }
});

router.post(
    "/students/:studentId/registration-window",
    async (request, response, next) => {
        const studentId = parseId(request.params.studentId);
        const validation = windowSchema.safeParse(request.body);

        if (!studentId || !validation.success) {
            return response.status(400).json({
                error: "Provide open/close, 5-60 minutes, and a reason."
            });
        }

        const client = await pool.connect();

        try {
            await client.query("BEGIN");
            const student = await getStudentRegistration(
                client,
                studentId,
                true
            );

            if (!student) {
                await client.query("ROLLBACK");
                return response.status(404).json({
                    error: "Student not found."
                });
            }

            const { action, durationMinutes, reason } = validation.data;

            if (action === "open" && student.device_count >= 2) {
                await client.query("ROLLBACK");
                return response.status(409).json({
                    error: "Two current devices are already registered. Revoke a device or reset registration before opening a window.",
                    code: "device_limit_reached"
                });
            }

            if (action === "open") {
                await client.query(
                    `
                    UPDATE students
                    SET
                        device_registration_opens_at = NOW(),
                        device_registration_expires_at =
                            NOW() + $2 * INTERVAL '1 minute',
                        device_registration_locked_at = NULL,
                        updated_at = NOW()
                    WHERE user_id = $1
                    `,
                    [studentId, durationMinutes]
                );
            } else {
                await client.query(
                    `
                    UPDATE students
                    SET
                        device_registration_expires_at = CASE
                            WHEN device_registration_opens_at IS NOT NULL
                                THEN NOW()
                            ELSE NULL
                        END,
                        device_registration_locked_at = NOW(),
                        updated_at = NOW()
                    WHERE user_id = $1
                    `,
                    [studentId]
                );
            }

            await recordAction(client, {
                adminId: request.session.user.id,
                studentId,
                action: action === "open"
                    ? "window_opened"
                    : "window_closed",
                reason
            });

            const registration = await getStudentRegistration(
                client,
                studentId
            );

            await client.query("COMMIT");
            response.json({
                message: action === "open"
                    ? "Registration window opened."
                    : "Registration locked.",
                student: registration
            });
        } catch (error) {
            await client.query("ROLLBACK");
            next(error);
        } finally {
            client.release();
        }
    }
);

router.post("/devices/:deviceId/revoke", async (request, response, next) => {
    const deviceId = parseId(request.params.deviceId);
    const validation = reasonSchema.safeParse(request.body?.reason);

    if (!deviceId || !validation.success) {
        return response.status(400).json({
            error: "A valid device and administrative reason are required."
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const deviceResult = await client.query(
            `
            SELECT id, student_id
            FROM student_devices
            WHERE id = $1 AND status IN ('pending', 'active')
            FOR UPDATE
            `,
            [deviceId]
        );

        if (deviceResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return response.status(404).json({
                error: "Current device registration not found."
            });
        }

        const studentId = deviceResult.rows[0].student_id;

        await client.query(
            `
            UPDATE student_devices
            SET status = 'revoked', revoked_at = NOW()
            WHERE id = $1
            `,
            [deviceId]
        );

        await recordAction(client, {
            adminId: request.session.user.id,
            studentId,
            deviceId,
            action: "device_revoked",
            reason: validation.data
        });

        await client.query("COMMIT");
        response.json({ message: "Device revoked by administration." });
    } catch (error) {
        await client.query("ROLLBACK");
        next(error);
    } finally {
        client.release();
    }
});

router.post(
    "/students/:studentId/reset-devices",
    async (request, response, next) => {
        const studentId = parseId(request.params.studentId);
        const validation = resetSchema.safeParse(request.body);

        if (!studentId || !validation.success) {
            return response.status(400).json({
                error: "Provide 5-60 minutes and an administrative reason."
            });
        }

        const client = await pool.connect();

        try {
            await client.query("BEGIN");
            const student = await getStudentRegistration(
                client,
                studentId,
                true
            );

            if (!student) {
                await client.query("ROLLBACK");
                return response.status(404).json({
                    error: "Student not found."
                });
            }

            const revoked = await client.query(
                `
                UPDATE student_devices
                SET status = 'revoked', revoked_at = NOW()
                WHERE
                    student_id = $1
                    AND status IN ('pending', 'active')
                `,
                [studentId]
            );

            await client.query(
                `
                UPDATE students
                SET
                    device_registration_opens_at = NOW(),
                    device_registration_expires_at =
                        NOW() + $2 * INTERVAL '1 minute',
                    device_registration_locked_at = NULL,
                    updated_at = NOW()
                WHERE user_id = $1
                `,
                [studentId, validation.data.durationMinutes]
            );

            await recordAction(client, {
                adminId: request.session.user.id,
                studentId,
                action: "registration_reset",
                reason: validation.data.reason
            });

            await client.query("COMMIT");
            response.json({
                message: "Devices revoked and a new registration window opened.",
                revokedDevices: revoked.rowCount
            });
        } catch (error) {
            await client.query("ROLLBACK");
            next(error);
        } finally {
            client.release();
        }
    }
);

router.get(
    "/students/:studentId/device-actions",
    async (request, response, next) => {
        const studentId = parseId(request.params.studentId);

        if (!studentId) {
            return response.status(400).json({ error: "Invalid student ID." });
        }

        try {
            const result = await pool.query(
                `
                SELECT
                    device_admin_actions.id,
                    device_admin_actions.action,
                    device_admin_actions.reason,
                    device_admin_actions.created_at,
                    users.login_id AS admin_login_id,
                    student_devices.device_name,
                    student_devices.device_slot
                FROM device_admin_actions
                JOIN users ON users.id = device_admin_actions.admin_id
                LEFT JOIN student_devices
                    ON student_devices.id = device_admin_actions.device_id
                WHERE device_admin_actions.student_id = $1
                ORDER BY device_admin_actions.created_at DESC,
                    device_admin_actions.id DESC
                LIMIT 50
                `,
                [studentId]
            );

            response.json({ actions: result.rows });
        } catch (error) {
            next(error);
        }
    }
);

export default router;
