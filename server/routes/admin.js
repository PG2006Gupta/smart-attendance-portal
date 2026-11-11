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

// Attendance range limits match the classrooms table constraints from
// migration 004. The database remains the final authority.
const MAX_RADIUS_METERS = 500;
const MAX_ACCURACY_LIMIT_METERS = 500;

const classroomRangeSchema = z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    radiusMeters: z.coerce.number().finite().positive().max(MAX_RADIUS_METERS),
    maxAccuracyMeters: z.coerce
        .number()
        .finite()
        .positive()
        .max(MAX_ACCURACY_LIMIT_METERS),
    coordinatesVerified: z.boolean(),
    reason: reasonSchema
});

const classroomVerificationSchema = z.object({
    action: z.enum(["verify", "revoke"]),
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


// =====================================================
// ATTENDANCE RANGE HELPERS
// =====================================================

async function getClassroom(client, classroomId, lock = false) {
    const result = await client.query(
        `
        SELECT
            classrooms.id AS classroom_id,
            classrooms.code,
            classrooms.building,
            classrooms.latitude,
            classrooms.longitude,
            classrooms.radius_meters,
            classrooms.max_accuracy_meters,
            classrooms.coordinates_verified,
            classrooms.is_active,
            classrooms.range_updated_at,
            users.login_id AS range_updated_by_login_id,
            (
                SELECT COUNT(*)
                FROM attendance_sessions
                WHERE
                    attendance_sessions.classroom_id = classrooms.id
                    AND attendance_sessions.status = 'active'
                    AND attendance_sessions.expires_at > NOW()
            )::integer AS active_sessions,
            (
                SELECT COUNT(*)
                FROM attendance_sessions
                WHERE attendance_sessions.classroom_id = classrooms.id
            )::integer AS total_sessions
        FROM classrooms
        LEFT JOIN users ON users.id = classrooms.range_updated_by
        WHERE classrooms.id = $1
        ${lock ? "FOR UPDATE OF classrooms" : ""}
        `,
        [classroomId]
    );

    return result.rows[0] || null;
}

function presentClassroom(classroom) {
    if (!classroom) return null;

    return {
        ...classroom,
        latitude: classroom.latitude === null
            ? null
            : Number(classroom.latitude),
        longitude: classroom.longitude === null
            ? null
            : Number(classroom.longitude),
        radius_meters: Number(classroom.radius_meters),
        max_accuracy_meters: Number(classroom.max_accuracy_meters)
    };
}

function classroomRangeValues(classroom) {
    return {
        latitude: classroom.latitude === null
            ? null
            : Number(classroom.latitude),
        longitude: classroom.longitude === null
            ? null
            : Number(classroom.longitude),
        radiusMeters: Number(classroom.radius_meters),
        maxAccuracyMeters: Number(classroom.max_accuracy_meters),
        coordinatesVerified: classroom.coordinates_verified
    };
}

function describeRangeChanges(previous, next) {
    const changes = [];

    if (previous.latitude === null && next.latitude !== null) {
        changes.push("coordinates set");
    } else if (
        previous.latitude !== null &&
        (Math.abs(previous.latitude - next.latitude) > 0.0000005 ||
            Math.abs(previous.longitude - next.longitude) > 0.0000005)
    ) {
        changes.push("coordinates updated");
    }

    if (previous.radiusMeters !== next.radiusMeters) {
        changes.push(
            `radius ${previous.radiusMeters} m to ${next.radiusMeters} m`
        );
    }

    if (previous.maxAccuracyMeters !== next.maxAccuracyMeters) {
        changes.push(
            `accuracy limit ${previous.maxAccuracyMeters} m to ` +
            `${next.maxAccuracyMeters} m`
        );
    }

    if (previous.coordinatesVerified !== next.coordinatesVerified) {
        changes.push(
            next.coordinatesVerified
                ? "coordinates verified"
                : "verification revoked"
        );
    }

    return changes.length > 0
        ? changes.join("; ")
        : "saved without changes";
}

async function recordClassroomAction(
    client,
    { adminId, classroomId, action, reason = null, previous, next }
) {
    await client.query(
        `
        INSERT INTO classroom_admin_actions (
            admin_id,
            classroom_id,
            action,
            reason,
            previous_values,
            new_values
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
            adminId,
            classroomId,
            action,
            reason,
            JSON.stringify(previous),
            JSON.stringify(next)
        ]
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
                    )::integer AS locked_students,
                    (
                        SELECT COUNT(*)
                        FROM classrooms
                        WHERE
                            is_active = TRUE
                            AND coordinates_verified = TRUE
                            AND latitude IS NOT NULL
                            AND longitude IS NOT NULL
                    )::integer AS ready_classrooms,
                    (
                        SELECT COUNT(*)
                        FROM classrooms
                        WHERE
                            coordinates_verified = FALSE
                            OR latitude IS NULL
                            OR longitude IS NULL
                    )::integer AS unconfigured_classrooms
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

// =====================================================
// ATTENDANCE RANGES
// =====================================================

async function loadAttendanceRangeOverview(client) {
    // A single pooled client cannot run queries concurrently, so these run
    // one after another.
    const classrooms = await client.query(
        `
        SELECT
            classrooms.id AS classroom_id,
            classrooms.code,
            classrooms.building,
            classrooms.latitude,
            classrooms.longitude,
            classrooms.radius_meters,
            classrooms.max_accuracy_meters,
            classrooms.coordinates_verified,
            classrooms.is_active,
            classrooms.range_updated_at,
            users.login_id AS range_updated_by_login_id,
            (
                SELECT COUNT(*)
                FROM attendance_sessions
                WHERE
                    attendance_sessions.classroom_id = classrooms.id
                    AND attendance_sessions.status = 'active'
                    AND attendance_sessions.expires_at > NOW()
            )::integer AS active_sessions
        FROM classrooms
        LEFT JOIN users ON users.id = classrooms.range_updated_by
        ORDER BY classrooms.is_active DESC, classrooms.code
        `
    );

    const stats = await client.query(
        `
        SELECT
            (SELECT COUNT(*) FROM classrooms)::integer AS total_classrooms,
            (
                SELECT COUNT(*)
                FROM classrooms
                WHERE
                    is_active = TRUE
                    AND coordinates_verified = TRUE
                    AND latitude IS NOT NULL
                    AND longitude IS NOT NULL
            )::integer AS ready_classrooms,
            (
                SELECT COUNT(*)
                FROM classrooms
                WHERE
                    coordinates_verified = FALSE
                    OR latitude IS NULL
                    OR longitude IS NULL
            )::integer AS unconfigured_classrooms,
            (
                SELECT COUNT(*)
                FROM attendance_sessions
                WHERE status = 'active' AND expires_at > NOW()
            )::integer AS active_sessions
        `
    );

    const checks = await client.query(
        `
        SELECT
            (
                SELECT COUNT(*)
                FROM verification_attempts
                WHERE
                    created_at > NOW() - INTERVAL '24 hours'
                    AND result = 'accepted'
            )::integer AS accepted_24h,
            (
                SELECT COUNT(*)
                FROM verification_attempts
                WHERE
                    created_at > NOW() - INTERVAL '24 hours'
                    AND result = 'rejected'
                    AND rejection_reason = 'outside_classroom'
            )::integer AS outside_range_24h,
            (
                SELECT COUNT(*)
                FROM verification_attempts
                WHERE
                    created_at > NOW() - INTERVAL '24 hours'
                    AND result = 'rejected'
                    AND rejection_reason = 'location_accuracy_too_low'
            )::integer AS inaccurate_24h,
            (
                SELECT COUNT(*)
                FROM verification_attempts
                WHERE
                    created_at > NOW() - INTERVAL '24 hours'
                    AND result = 'rejected'
                    AND rejection_reason = 'classroom_not_configured'
            )::integer AS unconfigured_24h
        `
    );

    return {
        classrooms: classrooms.rows.map(presentClassroom),
        stats: stats.rows[0],
        checks: checks.rows[0]
    };
}

router.get("/attendance-ranges", async (request, response, next) => {
    const client = await pool.connect();

    try {
        response.json(await loadAttendanceRangeOverview(client));
    } catch (error) {
        next(error);
    } finally {
        client.release();
    }
});

router.get(
    "/classrooms/:classroomId/range-history",
    async (request, response, next) => {
        const classroomId = parseId(request.params.classroomId);

        if (!classroomId) {
            return response.status(400).json({
                error: "Invalid classroom ID."
            });
        }

        try {
            const result = await pool.query(
                `
                SELECT
                    classroom_admin_actions.id,
                    classroom_admin_actions.action,
                    classroom_admin_actions.reason,
                    classroom_admin_actions.previous_values,
                    classroom_admin_actions.new_values,
                    classroom_admin_actions.created_at,
                    users.login_id AS admin_login_id,
                    administrators.full_name AS admin_name
                FROM classroom_admin_actions
                JOIN administrators
                    ON administrators.user_id =
                        classroom_admin_actions.admin_id
                JOIN users ON users.id = classroom_admin_actions.admin_id
                WHERE classroom_admin_actions.classroom_id = $1
                ORDER BY
                    classroom_admin_actions.created_at DESC,
                    classroom_admin_actions.id DESC
                LIMIT 50
                `,
                [classroomId]
            );

            response.json({ actions: result.rows });
        } catch (error) {
            next(error);
        }
    }
);

// Saves the range and, in the same step, the verification state. Turning
// verification off is always allowed. Turning it on means an administrator
// has reviewed the coordinates, so it is audited as a verification.
router.put(
    "/classrooms/:classroomId/range",
    async (request, response, next) => {
        const classroomId = parseId(request.params.classroomId);
        const validation = classroomRangeSchema.safeParse(request.body);

        if (!classroomId) {
            return response.status(400).json({
                error: "Invalid classroom ID."
            });
        }

        if (!validation.success) {
            return response.status(400).json({
                error:
                    "Provide coordinates within their valid ranges, a radius " +
                    "of 1 to 500 metres, an accuracy limit of 1 to 500 " +
                    "metres, a verification state, and a reason of 3 to 300 " +
                    "characters."
            });
        }

        const {
            latitude,
            longitude,
            radiusMeters,
            maxAccuracyMeters,
            coordinatesVerified,
            reason
        } = validation.data;

        const adminId = request.session.user.id;
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            const classroom = await getClassroom(client, classroomId, true);

            if (!classroom) {
                await client.query("ROLLBACK");
                return response.status(404).json({
                    error: "Classroom not found."
                });
            }

            const previous = classroomRangeValues(classroom);
            const next = {
                latitude,
                longitude,
                radiusMeters,
                maxAccuracyMeters,
                coordinatesVerified
            };
            // The attendance check reads the classroom row while a session
            // is running, so editing the range mid-session would silently
            // change the rule that students are measured against.
            if (Number(classroom.active_sessions) > 0) {
                await client.query("ROLLBACK");
                return response.status(409).json({
                    error:
                        "An attendance session is using this classroom. " +
                        "Wait until it ends before changing its range or " +
                        "verification.",
                    code: "classroom_session_active"
                });
            }

            await client.query(
                `
                UPDATE classrooms
                SET
                    latitude = $2,
                    longitude = $3,
                    radius_meters = $4,
                    max_accuracy_meters = $5,
                    coordinates_verified = $6,
                    range_updated_at = NOW(),
                    range_updated_by = $7,
                    updated_at = NOW()
                WHERE id = $1
                `,
                [
                    classroomId,
                    latitude,
                    longitude,
                    radiusMeters,
                    maxAccuracyMeters,
                    coordinatesVerified,
                    adminId
                ]
            );

            await recordClassroomAction(client, {
                adminId,
                classroomId,
                action: next.coordinatesVerified
                    ? "range_updated"
                    : "verification_revoked",
                reason,
                previous,
                next
            });

            const updated = await getClassroom(client, classroomId);

            await client.query("COMMIT");

            response.json({
                message: coordinatesVerified
                    ? "Attendance range saved and coordinates verified."
                    : "Attendance range saved. Attendance stays blocked until the coordinates are verified.",
                changes: describeRangeChanges(previous, next),
                classroom: presentClassroom(updated)
            });
        } catch (error) {
            await client.query("ROLLBACK");
            next(error);
        } finally {
            client.release();
        }
    }
);

// Reviews the saved coordinates without changing them.
router.post(
    "/classrooms/:classroomId/verification",
    async (request, response, next) => {
        const classroomId = parseId(request.params.classroomId);
        const validation = classroomVerificationSchema.safeParse(
            request.body
        );

        if (!classroomId) {
            return response.status(400).json({
                error: "Invalid classroom ID."
            });
        }

        if (!validation.success) {
            return response.status(400).json({
                error:
                    "Provide verify or revoke and a reason of 3 to 300 " +
                    "characters."
            });
        }

        const { action, reason } = validation.data;
        const adminId = request.session.user.id;
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            const classroom = await getClassroom(client, classroomId, true);

            if (!classroom) {
                await client.query("ROLLBACK");
                return response.status(404).json({
                    error: "Classroom not found."
                });
            }

            const previous = classroomRangeValues(classroom);

            if (Number(classroom.active_sessions) > 0) {
                await client.query("ROLLBACK");
                return response.status(409).json({
                    error:
                        "An attendance session is using this classroom. " +
                        "Wait until it ends before changing its " +
                        "verification.",
                    code: "classroom_session_active"
                });
            }

            if (previous.latitude === null || previous.longitude === null) {
                await client.query("ROLLBACK");
                return response.status(409).json({
                    error:
                        "Save the classroom coordinates before verifying " +
                        "them.",
                    code: "coordinates_missing"
                });
            }

            const next = {
                ...previous,
                coordinatesVerified: action === "verify"
            };

            await client.query(
                `
                UPDATE classrooms
                SET
                    coordinates_verified = $2,
                    range_updated_at = NOW(),
                    range_updated_by = $3,
                    updated_at = NOW()
                WHERE id = $1
                `,
                [classroomId, next.coordinatesVerified, adminId]
            );

            await recordClassroomAction(client, {
                adminId,
                classroomId,
                action: next.coordinatesVerified
                    ? "coordinates_verified"
                    : "verification_revoked",
                reason,
                previous,
                next
            });

            const updated = await getClassroom(client, classroomId);

            await client.query("COMMIT");

            response.json({
                message: next.coordinatesVerified
                    ? "Coordinates verified. Students can now be checked against this classroom."
                    : "Verification revoked. Attendance is blocked for this classroom.",
                classroom: presentClassroom(updated)
            });
        } catch (error) {
            await client.query("ROLLBACK");
            next(error);
        } finally {
            client.release();
        }
    }
);

export default router;

