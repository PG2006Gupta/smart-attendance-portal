import { Router } from "express";
import { z } from "zod";
import pool from "../config/db.js";
import { requireRole } from "../middleware/requireRole.js";
import { finalizeSession } from "../services/session-finalization.js";

const router = Router();

const createSessionSchema = z.object({
    offeringId: z.coerce.number().int().positive(),
    classroomId: z.coerce.number().int().positive()
});

function parseSessionId(value) {
    const sessionId = Number(value);
    return Number.isInteger(sessionId) && sessionId > 0
        ? sessionId
        : null;
}

router.use(requireRole("teacher"));

router.get("/classes", async (request, response, next) => {
    try {
        const result = await pool.query(
            `
            SELECT
                class_offerings.id AS offering_id,
                subjects.code AS subject_code,
                subjects.name AS subject_name,
                sections.name AS section_name,
                sections.course,
                sections.semester,
                sections.academic_year,
                (
                    SELECT COUNT(*)
                    FROM enrollments
                    WHERE
                        enrollments.offering_id = class_offerings.id
                        AND enrollments.is_active = TRUE
                )::integer AS expected_students
            FROM class_offerings
            JOIN subjects
                ON subjects.id = class_offerings.subject_id
            JOIN sections
                ON sections.id = class_offerings.section_id
            WHERE
                class_offerings.teacher_id = $1
                AND class_offerings.is_active = TRUE
            ORDER BY subjects.code
            `,
            [request.session.user.id]
        );

        response.json({ classes: result.rows });
    } catch (error) {
        next(error);
    }
});

router.get("/classrooms", async (request, response, next) => {
    try {
        const result = await pool.query(
            `
            SELECT
                id AS classroom_id,
                code,
                building,
                radius_meters,
                max_accuracy_meters,
                coordinates_verified
            FROM classrooms
            WHERE is_active = TRUE
            ORDER BY code
            `
        );

        response.json({ classrooms: result.rows });
    } catch (error) {
        next(error);
    }
});

router.get("/dashboard", async (request, response, next) => {
    try {
        const teacherId = request.session.user.id;

        const [statsResult, activeResult, profileResult] =
            await Promise.all([
                pool.query(
                    `
                    SELECT
                        (
                            SELECT COUNT(*)
                            FROM class_offerings
                            WHERE
                                teacher_id = $1
                                AND is_active = TRUE
                        )::integer AS assigned_classes,
                        (
                            SELECT COUNT(*)
                            FROM attendance_sessions
                            WHERE
                                teacher_id = $1
                                AND status IN ('closed', 'expired')
                                AND COALESCE(ended_at, expires_at)::date =
                                    CURRENT_DATE
                        )::integer AS sessions_completed,
                        (
                            SELECT COUNT(DISTINCT enrollments.student_id)
                            FROM class_offerings
                            JOIN enrollments
                                ON enrollments.offering_id =
                                    class_offerings.id
                                AND enrollments.is_active = TRUE
                            WHERE
                                class_offerings.teacher_id = $1
                                AND class_offerings.is_active = TRUE
                        )::integer AS students,
                        (
                            SELECT COUNT(*)
                            FROM attendance_sessions
                            WHERE
                                teacher_id = $1
                                AND status = 'active'
                                AND expires_at > NOW()
                        )::integer AS active_sessions
                    `,
                    [teacherId]
                ),
                pool.query(
                    `
                    SELECT
                        attendance_sessions.id AS session_id,
                        subjects.name AS subject_name,
                        sections.name AS section_name,
                        classrooms.code AS classroom_code,
                        attendance_sessions.expires_at
                    FROM attendance_sessions
                    JOIN class_offerings
                        ON class_offerings.id =
                            attendance_sessions.offering_id
                    JOIN subjects
                        ON subjects.id = class_offerings.subject_id
                    JOIN sections
                        ON sections.id = class_offerings.section_id
                    JOIN classrooms
                        ON classrooms.id =
                            attendance_sessions.classroom_id
                    WHERE
                        attendance_sessions.teacher_id = $1
                        AND attendance_sessions.status = 'active'
                        AND attendance_sessions.expires_at > NOW()
                    ORDER BY attendance_sessions.started_at DESC
                    `,
                    [teacherId]
                ),
                pool.query(
                    `
                    SELECT full_name, teacher_number, department, email
                    FROM teachers
                    WHERE user_id = $1
                    `,
                    [teacherId]
                )
            ]);

        response.json({
            profile: profileResult.rows[0] || null,
            stats: statsResult.rows[0],
            activeSessions: activeResult.rows
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
                teachers.teacher_number,
                teachers.full_name,
                teachers.department,
                teachers.email,
                users.is_active,
                (
                    SELECT COUNT(*)
                    FROM passkey_credentials
                    WHERE user_id = teachers.user_id
                )::integer AS passkey_count,
                (
                    SELECT COUNT(*)
                    FROM class_offerings
                    WHERE
                        teacher_id = teachers.user_id
                        AND is_active = TRUE
                )::integer AS assigned_classes
            FROM teachers
            JOIN users ON users.id = teachers.user_id
            WHERE teachers.user_id = $1
            `,
            [request.session.user.id]
        );

        if (result.rowCount === 0) {
            return response.status(404).json({
                error: "Teacher profile not found."
            });
        }

        response.json({ profile: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

router.get("/records", async (request, response, next) => {
    try {
        const teacherId = request.session.user.id;

        const [recordsResult, summaryResult] = await Promise.all([
            pool.query(
                `
                SELECT
                    attendance_sessions.id AS session_id,
                    attendance_sessions.started_at,
                    attendance_sessions.expires_at,
                    attendance_sessions.ended_at,
                    CASE
                        WHEN
                            attendance_sessions.status = 'active'
                            AND attendance_sessions.expires_at <= NOW()
                            THEN 'expired'
                        ELSE attendance_sessions.status
                    END AS status,
                    subjects.code AS subject_code,
                    subjects.name AS subject_name,
                    sections.name AS section_name,
                    classrooms.code AS classroom_code,
                    (
                        SELECT COUNT(*)
                        FROM enrollments
                        WHERE
                            enrollments.offering_id =
                                attendance_sessions.offering_id
                            AND enrollments.is_active = TRUE
                    )::integer AS expected_students,
                    (
                        SELECT COUNT(*)
                        FROM attendance_records
                        WHERE
                            attendance_records.session_id =
                                attendance_sessions.id
                            AND attendance_records.status = 'present'
                    )::integer AS present_count,
                    (
                        SELECT COUNT(*)
                        FROM attendance_records
                        WHERE
                            attendance_records.session_id =
                                attendance_sessions.id
                            AND attendance_records.status = 'absent'
                    )::integer AS absent_count
                FROM attendance_sessions
                JOIN class_offerings
                    ON class_offerings.id =
                        attendance_sessions.offering_id
                JOIN subjects
                    ON subjects.id = class_offerings.subject_id
                JOIN sections
                    ON sections.id = class_offerings.section_id
                JOIN classrooms
                    ON classrooms.id = attendance_sessions.classroom_id
                WHERE attendance_sessions.teacher_id = $1
                ORDER BY attendance_sessions.started_at DESC
                LIMIT 100
                `,
                [teacherId]
            ),
            pool.query(
                `
                SELECT
                    (
                        SELECT COUNT(*)
                        FROM attendance_sessions
                        WHERE teacher_id = $1
                    )::integer AS total_sessions,
                    (
                        SELECT COUNT(*)
                        FROM attendance_records
                        JOIN attendance_sessions
                            ON attendance_sessions.id =
                                attendance_records.session_id
                        WHERE
                            attendance_sessions.teacher_id = $1
                            AND attendance_records.status = 'present'
                    )::integer AS students_present,
                    (
                        SELECT COUNT(*)
                        FROM attendance_records
                        JOIN attendance_sessions
                            ON attendance_sessions.id =
                                attendance_records.session_id
                        WHERE
                            attendance_sessions.teacher_id = $1
                            AND attendance_records.status = 'absent'
                    )::integer AS students_absent
                `,
                [teacherId]
            )
        ]);

        response.json({
            records: recordsResult.rows,
            summary: summaryResult.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

router.post("/sessions", async (request, response, next) => {
    const validation = createSessionSchema.safeParse(request.body);

    if (!validation.success) {
        return response.status(400).json({
            error: "A valid class and classroom must be selected."
        });
    }

    const { offeringId, classroomId } = validation.data;
    const teacherId = request.session.user.id;
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const offeringResult = await client.query(
            `
            SELECT id
            FROM class_offerings
            WHERE
                id = $1
                AND teacher_id = $2
                AND is_active = TRUE
            FOR UPDATE
            `,
            [offeringId, teacherId]
        );

        if (offeringResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return response.status(404).json({
                error: "Class offering not found or not assigned to you."
            });
        }

        const classroomResult = await client.query(
            `
            SELECT id
            FROM classrooms
            WHERE id = $1 AND is_active = TRUE
            `,
            [classroomId]
        );

        if (classroomResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return response.status(400).json({
                error: "The selected classroom is not available."
            });
        }

        const expiredSessions = await client.query(
            `
            SELECT id
            FROM attendance_sessions
            WHERE
                offering_id = $1
                AND status = 'active'
                AND expires_at <= NOW()
            `,
            [offeringId]
        );

        for (const expired of expiredSessions.rows) {
            await finalizeSession(client, expired.id);
        }

        const activeSessionResult = await client.query(
            `
            SELECT id
            FROM attendance_sessions
            WHERE
                offering_id = $1
                AND status = 'active'
                AND expires_at > NOW()
            LIMIT 1
            `,
            [offeringId]
        );

        if (activeSessionResult.rowCount > 0) {
            await client.query("ROLLBACK");
            return response.status(409).json({
                error: "An active attendance session already exists for this class.",
                sessionId: activeSessionResult.rows[0].id
            });
        }

        const sessionResult = await client.query(
            `
            INSERT INTO attendance_sessions (
                offering_id,
                classroom_id,
                teacher_id,
                started_at,
                expires_at,
                status
            )
            VALUES (
                $1, $2, $3, NOW(), NOW() + INTERVAL '10 minutes', 'active'
            )
            RETURNING
                id, offering_id, classroom_id,
                started_at, expires_at, status
            `,
            [offeringId, classroomId, teacherId]
        );

        await client.query("COMMIT");

        response.status(201).json({
            message: "Attendance session started",
            session: sessionResult.rows[0]
        });
    } catch (error) {
        await client.query("ROLLBACK");
        next(error);
    } finally {
        client.release();
    }
});

router.get("/sessions/:sessionId", async (request, response, next) => {
    const sessionId = parseSessionId(request.params.sessionId);

    if (!sessionId) {
        return response.status(400).json({
            error: "Invalid attendance session ID."
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await finalizeSession(client, sessionId);

        const result = await client.query(
            `
            SELECT
                attendance_sessions.id AS session_id,
                attendance_sessions.offering_id,
                attendance_sessions.classroom_id,
                attendance_sessions.started_at,
                attendance_sessions.expires_at,
                attendance_sessions.ended_at,
                attendance_sessions.status,
                subjects.code AS subject_code,
                subjects.name AS subject_name,
                sections.name AS section_name,
                classrooms.code AS classroom_code,
                classrooms.building,
                classrooms.radius_meters,
                classrooms.max_accuracy_meters,
                classrooms.coordinates_verified,
                teachers.full_name AS teacher_name,
                (
                    SELECT COUNT(*)
                    FROM enrollments
                    WHERE
                        enrollments.offering_id =
                            attendance_sessions.offering_id
                        AND enrollments.is_active = TRUE
                )::integer AS expected_students,
                NOW() AS server_time
            FROM attendance_sessions
            JOIN class_offerings
                ON class_offerings.id = attendance_sessions.offering_id
            JOIN subjects
                ON subjects.id = class_offerings.subject_id
            JOIN sections
                ON sections.id = class_offerings.section_id
            JOIN classrooms
                ON classrooms.id = attendance_sessions.classroom_id
            JOIN teachers
                ON teachers.user_id = attendance_sessions.teacher_id
            WHERE
                attendance_sessions.id = $1
                AND attendance_sessions.teacher_id = $2
            `,
            [sessionId, request.session.user.id]
        );

        if (result.rowCount === 0) {
            await client.query("ROLLBACK");
            return response.status(404).json({
                error: "Attendance session not found."
            });
        }

        await client.query("COMMIT");
        const session = result.rows[0];

        response.json({
            session,
            serverTime: session.server_time
        });
    } catch (error) {
        await client.query("ROLLBACK");
        next(error);
    } finally {
        client.release();
    }
});

router.post("/sessions/:sessionId/end", async (request, response, next) => {
    const sessionId = parseSessionId(request.params.sessionId);

    if (!sessionId) {
        return response.status(400).json({
            error: "Invalid attendance session ID."
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const ownership = await client.query(
            `
            SELECT id
            FROM attendance_sessions
            WHERE id = $1 AND teacher_id = $2
            `,
            [sessionId, request.session.user.id]
        );

        if (ownership.rowCount === 0) {
            await client.query("ROLLBACK");
            return response.status(404).json({
                error: "Attendance session not found."
            });
        }

        const session = await finalizeSession(
            client,
            sessionId,
            "closed"
        );

        await client.query("COMMIT");

        response.json({
            message: "Attendance session ended",
            session
        });
    } catch (error) {
        await client.query("ROLLBACK");
        next(error);
    } finally {
        client.release();
    }
});

router.get("/sessions/:sessionId/students", async (request, response, next) => {
    const sessionId = parseSessionId(request.params.sessionId);

    if (!sessionId) {
        return response.status(400).json({
            error: "Invalid attendance session ID."
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await finalizeSession(client, sessionId);

        const sessionResult = await client.query(
            `
            SELECT id, status
            FROM attendance_sessions
            WHERE id = $1 AND teacher_id = $2
            `,
            [sessionId, request.session.user.id]
        );

        if (sessionResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return response.status(404).json({
                error: "Attendance session not found."
            });
        }

        const studentsResult = await client.query(
            `
            SELECT
                students.user_id AS student_id,
                students.student_number,
                students.full_name,
                attendance_records.status AS attendance_status,
                attendance_records.marked_at,
                latest_attempt.result AS verification_result,
                latest_attempt.rejection_reason,
                latest_attempt.device_verified,
                latest_attempt.location_verified,
                latest_attempt.distance_meters,
                latest_attempt.accuracy_meters,
                latest_attempt.created_at AS verified_at,
                student_devices.device_name,
                EXISTS (
                    SELECT 1
                    FROM verification_attempts attempts
                    WHERE
                        attempts.session_id = attendance_sessions.id
                        AND attempts.student_id = students.user_id
                        AND attempts.device_verified = TRUE
                ) AS device_detected
            FROM attendance_sessions
            JOIN enrollments
                ON enrollments.offering_id = attendance_sessions.offering_id
                AND enrollments.is_active = TRUE
            JOIN students
                ON students.user_id = enrollments.student_id
            LEFT JOIN attendance_records
                ON attendance_records.session_id = attendance_sessions.id
                AND attendance_records.student_id = students.user_id
            LEFT JOIN LATERAL (
                SELECT *
                FROM verification_attempts
                WHERE
                    verification_attempts.session_id =
                        attendance_sessions.id
                    AND verification_attempts.student_id = students.user_id
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            ) latest_attempt ON TRUE
            LEFT JOIN student_devices
                ON student_devices.id = latest_attempt.device_id
            WHERE attendance_sessions.id = $1
            ORDER BY students.full_name, students.student_number
            `,
            [sessionId]
        );

        await client.query("COMMIT");

        const students = studentsResult.rows;
        const present = students.filter(
            (student) => student.attendance_status === "present"
        ).length;
        const absent = students.filter(
            (student) => student.attendance_status === "absent"
        ).length;
        const detected = students.filter(
            (student) => student.device_detected
        ).length;

        response.json({
            students,
            totalStudents: students.length,
            sessionStatus: sessionResult.rows[0].status,
            summary: {
                totalStudents: students.length,
                detected,
                present,
                absent,
                pending: Math.max(students.length - present - absent, 0)
            }
        });
    } catch (error) {
        await client.query("ROLLBACK");
        next(error);
    } finally {
        client.release();
    }
});

export default router;
