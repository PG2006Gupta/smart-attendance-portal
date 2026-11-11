import crypto from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import pool from "../config/db.js";
import { requireRole } from "../middleware/requireRole.js";
import {
    isDeviceRegistrationWindowOpen,
    shouldLockRegistrationAfterDevice
} from "../services/device-policy.js";
import {
    createDeviceChallenge,
    validateDevicePublicKey,
    verifyDeviceSignature
} from "../services/verification.js";
import {
    describeRange,
    evaluateAttendanceRange,
    formatDistanceMeters,
    measureClassroomDistance
} from "../services/attendance-range.js";

const router = Router();

const attendanceLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Too many verification attempts. Please wait before trying again."
    }
});

const registerDeviceSchema = z.object({
    deviceName: z.string().trim().min(2).max(100),
    publicKey: z.string().min(100).max(4096),
    credentialId: z.string().uuid().optional()
});

const challengeSchema = z.object({
    sessionId: z.coerce.number().int().positive(),
    credentialId: z.string().uuid()
});

const markAttendanceSchema = z.object({
    sessionId: z.coerce.number().int().positive(),
    challengeId: z.string().uuid(),
    credentialId: z.string().uuid(),
    requestId: z.string().uuid(),
    signature: z.string().min(64).max(512),
    location: z.object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
        accuracy: z.number().finite().nonnegative().max(10000),
        capturedAt: z.number().int().positive()
    })
});

async function getActiveSessions(studentId) {
    const result = await pool.query(
        `
        SELECT
            attendance_sessions.id AS session_id,
            attendance_sessions.started_at,
            attendance_sessions.expires_at,
            subjects.code AS subject_code,
            subjects.name AS subject_name,
            sections.name AS section_name,
            teachers.full_name AS teacher_name,
            classrooms.code AS classroom_code,
            classrooms.radius_meters,
            classrooms.max_accuracy_meters,
            classrooms.coordinates_verified,
            (
                classrooms.coordinates_verified = TRUE
                AND classrooms.latitude IS NOT NULL
                AND classrooms.longitude IS NOT NULL
            ) AS classroom_ready,
            attendance_records.status AS attendance_status,
            attendance_records.marked_at,
            NOW() AS server_time
        FROM attendance_sessions
        JOIN class_offerings
            ON class_offerings.id = attendance_sessions.offering_id
            AND class_offerings.is_active = TRUE
        JOIN enrollments
            ON enrollments.offering_id = class_offerings.id
            AND enrollments.is_active = TRUE
            AND enrollments.student_id = $1
        JOIN subjects ON subjects.id = class_offerings.subject_id
        JOIN sections ON sections.id = class_offerings.section_id
        JOIN teachers ON teachers.user_id = attendance_sessions.teacher_id
        JOIN classrooms
            ON classrooms.id = attendance_sessions.classroom_id
        LEFT JOIN attendance_records
            ON attendance_records.session_id = attendance_sessions.id
            AND attendance_records.student_id = $1
        WHERE
            attendance_sessions.status = 'active'
            AND attendance_sessions.expires_at > NOW()
        ORDER BY attendance_sessions.started_at DESC
        `,
        [studentId]
    );

    return result.rows;
}

async function getStudentAttendanceStats(studentId) {
    const result = await pool.query(
        `
        SELECT
            COUNT(*) FILTER (
                WHERE attendance_records.status = 'present'
            )::integer AS present,
            COUNT(*) FILTER (
                WHERE attendance_records.status = 'absent'
            )::integer AS absent
        FROM attendance_records
        WHERE attendance_records.student_id = $1
        `,
        [studentId]
    );

    const stats = result.rows[0];
    const total = stats.present + stats.absent;

    return {
        ...stats,
        total,
        percentage: total > 0
            ? Number((stats.present * 100 / total).toFixed(1))
            : 0
    };
}

router.use(requireRole("student"));

router.get("/dashboard", async (request, response, next) => {
    try {
        const studentId = request.session.user.id;

        const [profileResult, stats, activeSessions, todayResult] =
            await Promise.all([
                pool.query(
                    `
                    SELECT full_name, student_number
                    FROM students
                    WHERE user_id = $1
                    `,
                    [studentId]
                ),
                getStudentAttendanceStats(studentId),
                getActiveSessions(studentId),
                pool.query(
                    `
                    SELECT
                        attendance_sessions.id AS session_id,
                        attendance_sessions.started_at,
                        attendance_sessions.status AS session_status,
                        subjects.code AS subject_code,
                        subjects.name AS subject_name,
                        classrooms.code AS classroom_code,
                        attendance_records.status AS attendance_status
                    FROM attendance_sessions
                    JOIN class_offerings
                        ON class_offerings.id = attendance_sessions.offering_id
                    JOIN enrollments
                        ON enrollments.offering_id = class_offerings.id
                        AND enrollments.is_active = TRUE
                        AND enrollments.student_id = $1
                    JOIN subjects ON subjects.id = class_offerings.subject_id
                    JOIN classrooms
                        ON classrooms.id = attendance_sessions.classroom_id
                    LEFT JOIN attendance_records
                        ON attendance_records.session_id = attendance_sessions.id
                        AND attendance_records.student_id = $1
                    WHERE attendance_sessions.started_at::date = CURRENT_DATE
                    ORDER BY attendance_sessions.started_at DESC
                    LIMIT 20
                    `,
                    [studentId]
                )
            ]);

        response.json({
            profile: profileResult.rows[0] || null,
            stats,
            activeSessions,
            today: todayResult.rows
        });
    } catch (error) {
        next(error);
    }
});

router.get("/sessions/active", async (request, response, next) => {
    try {
        const sessions = await getActiveSessions(request.session.user.id);
        const presented = sessions.map((session) => ({
            ...session,
            radius_description: describeRange(session)
        }));

        response.json({
            sessions: presented,
            session: presented[0] || null,
            serverTime: sessions[0]?.server_time || new Date().toISOString()
        });
    } catch (error) {
        next(error);
    }
});

router.get("/attendance/history", async (request, response, next) => {
    try {
        const studentId = request.session.user.id;
        const [recordsResult, stats] = await Promise.all([
            pool.query(
                `
                SELECT
                    attendance_sessions.id AS session_id,
                    attendance_sessions.started_at,
                    attendance_sessions.ended_at,
                    subjects.code AS subject_code,
                    subjects.name AS subject_name,
                    sections.name AS section_name,
                    classrooms.code AS classroom_code,
                    attendance_records.status,
                    attendance_records.marked_at
                FROM attendance_records
                JOIN attendance_sessions
                    ON attendance_sessions.id = attendance_records.session_id
                JOIN class_offerings
                    ON class_offerings.id = attendance_sessions.offering_id
                JOIN subjects ON subjects.id = class_offerings.subject_id
                JOIN sections ON sections.id = class_offerings.section_id
                JOIN classrooms
                    ON classrooms.id = attendance_sessions.classroom_id
                WHERE attendance_records.student_id = $1
                ORDER BY attendance_sessions.started_at DESC
                LIMIT 100
                `,
                [studentId]
            ),
            getStudentAttendanceStats(studentId)
        ]);

        response.json({
            records: recordsResult.rows,
            summary: stats
        });
    } catch (error) {
        next(error);
    }
});

router.get("/profile", async (request, response, next) => {
    try {
        const result = await pool.query(
            `
            SELECT
                students.student_number,
                students.full_name,
                users.is_active,
                COALESCE(
                    JSONB_AGG(
                        DISTINCT JSONB_BUILD_OBJECT(
                            'course', sections.course,
                            'section', sections.name,
                            'semester', sections.semester,
                            'academicYear', sections.academic_year
                        )
                    ) FILTER (WHERE sections.id IS NOT NULL),
                    '[]'::jsonb
                ) AS sections,
                (
                    SELECT COUNT(*)
                    FROM student_devices
                    WHERE
                        student_id = students.user_id
                        AND status IN ('pending', 'active')
                )::integer AS registered_devices,
                (
                    SELECT COUNT(*)
                    FROM passkey_credentials
                    WHERE user_id = students.user_id
                )::integer AS passkey_count
            FROM students
            JOIN users ON users.id = students.user_id
            LEFT JOIN enrollments
                ON enrollments.student_id = students.user_id
                AND enrollments.is_active = TRUE
            LEFT JOIN class_offerings
                ON class_offerings.id = enrollments.offering_id
                AND class_offerings.is_active = TRUE
            LEFT JOIN sections
                ON sections.id = class_offerings.section_id
            WHERE students.user_id = $1
            GROUP BY students.user_id, users.id
            `,
            [request.session.user.id]
        );

        if (result.rowCount === 0) {
            return response.status(404).json({
                error: "Student profile not found."
            });
        }

        response.json({ profile: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

router.get("/devices", async (request, response, next) => {
    try {
        const result = await pool.query(
            `
            SELECT
                id AS device_id,
                credential_id,
                device_slot,
                device_name,
                status,
                registered_at,
                last_used_at
            FROM student_devices
            WHERE student_id = $1 AND status <> 'revoked'
            ORDER BY device_slot
            `,
            [request.session.user.id]
        );

        const registrationResult = await pool.query(
            `
            SELECT
                device_registration_opens_at AS opens_at,
                device_registration_expires_at AS expires_at,
                device_registration_locked_at AS locked_at,
                (
                    device_registration_locked_at IS NULL
                    AND device_registration_opens_at <= NOW()
                    AND device_registration_expires_at > NOW()
                ) AS window_open
            FROM students
            WHERE user_id = $1
            `,
            [request.session.user.id]
        );

        const registration = registrationResult.rows[0];

        if (!registration) {
            return response.status(404).json({
                error: "Student profile not found."
            });
        }

        response.json({
            devices: result.rows,
            registration: {
                windowOpen: registration.window_open,
                canRegister:
                    registration.window_open && result.rowCount < 2,
                opensAt: registration.opens_at,
                expiresAt: registration.expires_at,
                lockedAt: registration.locked_at
            }
        });
    } catch (error) {
        next(error);
    }
});

router.post("/devices", attendanceLimiter, async (request, response, next) => {
    const validation = registerDeviceSchema.safeParse(request.body);

    if (!validation.success) {
        return response.status(400).json({
            error: "A valid device name and public key are required."
        });
    }

    try {
        validateDevicePublicKey(validation.data.publicKey);
    } catch (error) {
        return response.status(400).json({ error: error.message });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Serializes registrations and enforces the administrator's window.
        const registrationResult = await client.query(
            `
            SELECT
                user_id,
                device_registration_locked_at,
                device_registration_opens_at,
                device_registration_expires_at
            FROM students
            WHERE user_id = $1
            FOR UPDATE
            `,
            [request.session.user.id]
        );

        const registration = registrationResult.rows[0];
        const windowOpen = isDeviceRegistrationWindowOpen(registration);

        if (!windowOpen) {
            await client.query("ROLLBACK");
            return response.status(403).json({
                error: "Device registration is locked. Contact the SAP administrator.",
                code: "device_registration_locked"
            });
        }

        const slotsResult = await client.query(
            `
            SELECT device_slot
            FROM student_devices
            WHERE student_id = $1 AND status IN ('pending', 'active')
            ORDER BY device_slot
            `,
            [request.session.user.id]
        );

        if (slotsResult.rowCount >= 2) {
            await client.query("ROLLBACK");
            return response.status(409).json({
                error: "Maximum two registered devices are allowed. Contact the administrator for any device change.",
                code: "device_limit_reached"
            });
        }

        const usedSlots = new Set(
            slotsResult.rows.map((row) => row.device_slot)
        );
        const deviceSlot = usedSlots.has(1) ? 2 : 1;

        const inserted = await client.query(
            `
            INSERT INTO student_devices (
                student_id,
                device_slot,
                device_name,
                credential_id,
                device_public_key,
                status,
                registered_at
            )
            VALUES ($1, $2, $3, $4, $5, 'active', NOW())
            RETURNING
                id AS device_id,
                credential_id,
                device_slot,
                device_name,
                status,
                registered_at
            `,
            [
                request.session.user.id,
                deviceSlot,
                validation.data.deviceName,
                validation.data.credentialId || crypto.randomUUID(),
                validation.data.publicKey
            ]
        );

        const registrationLocked = shouldLockRegistrationAfterDevice(
            slotsResult.rowCount + 1
        );

        if (registrationLocked) {
            await client.query(
                `
                UPDATE students
                SET
                    device_registration_locked_at = NOW(),
                    device_registration_expires_at = NOW(),
                    updated_at = NOW()
                WHERE user_id = $1
                `,
                [request.session.user.id]
            );
        }

        await client.query("COMMIT");

        response.status(201).json({
            message: registrationLocked
                ? "Device registered. The two-device limit is complete and registration is now locked."
                : "Device registered successfully.",
            device: inserted.rows[0],
            registrationLocked
        });
    } catch (error) {
        await client.query("ROLLBACK");
        next(error);
    } finally {
        client.release();
    }
});

// Kept as an explicit denial for compatibility with older frontend copies.
// Only the administrator router may revoke or replace a device.
router.post("/devices/:deviceId/revoke", (request, response) => {
    response.status(403).json({
        error: "Students cannot revoke devices. Contact the SAP administrator.",
        code: "device_changes_admin_only"
    });
});

router.post("/attendance/challenge", attendanceLimiter, async (request, response, next) => {
    const validation = challengeSchema.safeParse(request.body);

    if (!validation.success) {
        return response.status(400).json({
            error: "A valid session and registered device are required."
        });
    }

    const { sessionId, credentialId } = validation.data;

    try {
        const result = await pool.query(
            `
            SELECT student_devices.id AS device_id
            FROM attendance_sessions
            JOIN enrollments
                ON enrollments.offering_id = attendance_sessions.offering_id
                AND enrollments.is_active = TRUE
                AND enrollments.student_id = $2
            JOIN student_devices
                ON student_devices.student_id = $2
                AND student_devices.credential_id = $3
                AND student_devices.status = 'active'
            WHERE
                attendance_sessions.id = $1
                AND attendance_sessions.status = 'active'
                AND attendance_sessions.expires_at > NOW()
            `,
            [sessionId, request.session.user.id, credentialId]
        );

        if (result.rowCount === 0) {
            return response.status(403).json({
                error: "The session is unavailable or this device is not registered to your account.",
                code: "session_or_device_invalid"
            });
        }

        const challengeId = crypto.randomUUID();
        const challenge = createDeviceChallenge();

        const inserted = await pool.query(
            `
            INSERT INTO attendance_challenges (
                id,
                session_id,
                student_id,
                device_id,
                challenge,
                expires_at
            )
            VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '2 minutes')
            RETURNING expires_at
            `,
            [
                challengeId,
                sessionId,
                request.session.user.id,
                result.rows[0].device_id,
                challenge
            ]
        );

        response.json({
            challengeId,
            challenge,
            expiresAt: inserted.rows[0].expires_at
        });
    } catch (error) {
        next(error);
    }
});

router.post("/attendance/mark", attendanceLimiter, async (request, response, next) => {
    const validation = markAttendanceSchema.safeParse(request.body);

    if (!validation.success) {
        return response.status(400).json({
            error: "The attendance verification request is invalid."
        });
    }

    const {
        sessionId,
        challengeId,
        credentialId,
        requestId,
        signature,
        location
    } = validation.data;

    const studentId = request.session.user.id;
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const duplicateRequest = await client.query(
            `SELECT id FROM verification_attempts WHERE request_id = $1`,
            [requestId]
        );

        if (duplicateRequest.rowCount > 0) {
            await client.query("ROLLBACK");
            return response.status(409).json({
                error: "This verification request has already been processed.",
                code: "request_replayed"
            });
        }

        const challengeResult = await client.query(
            `
            SELECT
                attendance_challenges.*,
                student_devices.device_public_key,
                student_devices.credential_id
            FROM attendance_challenges
            JOIN student_devices
                ON student_devices.id = attendance_challenges.device_id
            WHERE
                attendance_challenges.id = $1
                AND attendance_challenges.session_id = $2
                AND attendance_challenges.student_id = $3
                AND student_devices.credential_id = $4
                AND student_devices.status = 'active'
            FOR UPDATE OF attendance_challenges
            `,
            [challengeId, sessionId, studentId, credentialId]
        );

        if (challengeResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return response.status(403).json({
                error: "The verification challenge is invalid.",
                code: "challenge_invalid"
            });
        }

        const challenge = challengeResult.rows[0];

        if (
            challenge.used_at ||
            new Date(challenge.expires_at).getTime() <= Date.now()
        ) {
            await client.query("ROLLBACK");
            return response.status(409).json({
                error: "The verification challenge has expired or was already used. Request a new one.",
                code: "challenge_unavailable"
            });
        }

        await client.query(
            `UPDATE attendance_challenges SET used_at = NOW() WHERE id = $1`,
            [challengeId]
        );

        const sessionResult = await client.query(
            `
            SELECT
                attendance_sessions.id,
                attendance_sessions.status,
                attendance_sessions.expires_at,
                classrooms.latitude,
                classrooms.longitude,
                classrooms.radius_meters,
                classrooms.max_accuracy_meters,
                classrooms.coordinates_verified
            FROM attendance_sessions
            JOIN enrollments
                ON enrollments.offering_id = attendance_sessions.offering_id
                AND enrollments.is_active = TRUE
                AND enrollments.student_id = $2
            JOIN classrooms
                ON classrooms.id = attendance_sessions.classroom_id
            WHERE attendance_sessions.id = $1
            FOR UPDATE OF attendance_sessions
            `,
            [sessionId, studentId]
        );

        if (sessionResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return response.status(403).json({
                error: "You are not enrolled in this session.",
                code: "enrollment_invalid"
            });
        }

        const attendanceSession = sessionResult.rows[0];
        const capturedAt = new Date(location.capturedAt);
        const distanceMeters = measureClassroomDistance(
            attendanceSession,
            location
        );

        async function rejectAttempt({
            status = 403,
            code,
            message,
            deviceVerified = false,
            locationVerified = false
        }) {
            await client.query(
                `
                INSERT INTO verification_attempts (
                    session_id,
                    student_id,
                    device_id,
                    request_id,
                    result,
                    rejection_reason,
                    distance_meters,
                    accuracy_meters,
                    location_captured_at,
                    device_verified,
                    location_verified
                )
                VALUES (
                    $1, $2, $3, $4, 'rejected', $5, $6, $7, $8, $9, $10
                )
                `,
                [
                    sessionId,
                    studentId,
                    challenge.device_id,
                    requestId,
                    code,
                    distanceMeters,
                    location.accuracy,
                    capturedAt,
                    deviceVerified,
                    locationVerified
                ]
            );

            await client.query("COMMIT");

            return response.status(status).json({
                error: message,
                code,
                deviceVerified,
                locationVerified,
                distanceMeters: formatDistanceMeters(distanceMeters),
                radiusMeters: Number(attendanceSession.radius_meters)
            });
        }

        if (
            attendanceSession.status !== "active" ||
            new Date(attendanceSession.expires_at).getTime() <= Date.now()
        ) {
            return rejectAttempt({
                status: 409,
                code: "session_not_active",
                message: "The attendance session is no longer active."
            });
        }

        const existingRecord = await client.query(
            `
            SELECT id, status, marked_at
            FROM attendance_records
            WHERE session_id = $1 AND student_id = $2
            `,
            [sessionId, studentId]
        );

        if (existingRecord.rowCount > 0) {
            await client.query("COMMIT");
            return response.json({
                message: "Attendance was already recorded for this session.",
                alreadyMarked: true,
                attendance: existingRecord.rows[0]
            });
        }

        const signatureValid = verifyDeviceSignature({
            publicKeyBase64: challenge.device_public_key,
            challenge: challenge.challenge,
            signatureBase64: signature
        });

        if (!signatureValid) {
            return rejectAttempt({
                code: "device_signature_invalid",
                message: "This device could not prove its registered identity."
            });
        }

        await client.query(
            `UPDATE student_devices SET last_used_at = NOW() WHERE id = $1`,
            [challenge.device_id]
        );

        if (
            !attendanceSession.coordinates_verified ||
            attendanceSession.latitude === null ||
            attendanceSession.longitude === null
        ) {
            return rejectAttempt({
                status: 409,
                code: "classroom_not_configured",
                message: "This classroom does not have verified coordinates yet. Ask your teacher or administrator to configure it.",
                deviceVerified: true
            });
        }

        const capturedAtMilliseconds = capturedAt.getTime();
        const maximumAge = Number(
            process.env.LOCATION_MAX_AGE_MS || 120000
        );

        if (
            !Number.isFinite(capturedAtMilliseconds) ||
            Date.now() - capturedAtMilliseconds > maximumAge ||
            capturedAtMilliseconds - Date.now() > 120000
        ) {
            return rejectAttempt({
                code: "location_reading_stale",
                message: "The location reading is stale or has an invalid timestamp. Refresh your location and try again.",
                deviceVerified: true
            });
        }

        const rangeDecision = evaluateAttendanceRange({
            classroom: attendanceSession,
            location,
            distanceMeters
        });

        if (!rangeDecision.accepted) {
            // The classroom-not-configured case is checked earlier so that
            // it keeps its distinct HTTP status.
            return rejectAttempt({
                code: rangeDecision.code,
                message: rangeDecision.message,
                deviceVerified: true
            });
        }

        const radiusMeters = rangeDecision.radiusMeters;

        const acceptedAttempt = await client.query(
            `
            INSERT INTO verification_attempts (
                session_id,
                student_id,
                device_id,
                request_id,
                result,
                rejection_reason,
                distance_meters,
                accuracy_meters,
                location_captured_at,
                device_verified,
                location_verified
            )
            VALUES (
                $1, $2, $3, $4, 'accepted', NULL, $5, $6, $7, TRUE, TRUE
            )
            RETURNING id
            `,
            [
                sessionId,
                studentId,
                challenge.device_id,
                requestId,
                distanceMeters,
                location.accuracy,
                capturedAt
            ]
        );

        const attendance = await client.query(
            `
            INSERT INTO attendance_records (
                session_id,
                student_id,
                verification_attempt_id,
                status,
                marked_at
            )
            VALUES ($1, $2, $3, 'present', NOW())
            RETURNING id, session_id, student_id, status, marked_at
            `,
            [sessionId, studentId, acceptedAttempt.rows[0].id]
        );

        await client.query("COMMIT");

        response.status(201).json({
            message: "Attendance marked successfully.",
            attendance: attendance.rows[0],
            distanceMeters: formatDistanceMeters(distanceMeters),
            radiusMeters
        });
    } catch (error) {
        await client.query("ROLLBACK");
        next(error);
    } finally {
        client.release();
    }
});

export default router;
