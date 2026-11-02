import pool from "../config/db.js";

async function insertMissingAbsences(client, sessionId) {
    await client.query(
        `
        INSERT INTO attendance_records (
            session_id,
            student_id,
            status
        )
        SELECT
            attendance_sessions.id,
            enrollments.student_id,
            'absent'
        FROM attendance_sessions
        JOIN enrollments
            ON enrollments.offering_id =
                attendance_sessions.offering_id
            AND enrollments.is_active = TRUE
        WHERE
            attendance_sessions.id = $1
            AND attendance_sessions.status IN ('closed', 'expired')
        ON CONFLICT (session_id, student_id) DO NOTHING
        `,
        [sessionId]
    );
}

// Call inside a transaction. The session row is locked so attendance marking
// and session finalization cannot race each other.
export async function finalizeSession(
    client,
    sessionId,
    requestedStatus = null
) {
    const result = await client.query(
        `
        SELECT
            id,
            offering_id,
            status,
            started_at,
            expires_at,
            ended_at
        FROM attendance_sessions
        WHERE id = $1
        FOR UPDATE
        `,
        [sessionId]
    );

    if (result.rowCount === 0) {
        return null;
    }

    const previousStatus = result.rows[0].status;

    const updated = await client.query(
        `
        UPDATE attendance_sessions
        SET
            status = CASE
                WHEN
                    status = 'active'
                    AND expires_at <= NOW()
                    THEN 'expired'
                WHEN
                    status = 'active'
                    AND $2 = 'closed'
                    THEN 'closed'
                ELSE status
            END,
            ended_at = CASE
                WHEN
                    status = 'active'
                    AND (
                        expires_at <= NOW()
                        OR $2 = 'closed'
                    )
                    THEN COALESCE(ended_at, NOW())
                ELSE ended_at
            END,
            updated_at = CASE
                WHEN
                    status = 'active'
                    AND (
                        expires_at <= NOW()
                        OR $2 = 'closed'
                    )
                    THEN NOW()
                ELSE updated_at
            END
        WHERE id = $1
        RETURNING
            id AS session_id,
            offering_id,
            status,
            started_at,
            expires_at,
            ended_at
        `,
        [sessionId, requestedStatus]
    );

    const session = updated.rows[0];
    session.previous_status = previousStatus;

    if (["closed", "expired"].includes(session.status)) {
        await insertMissingAbsences(client, sessionId);
    }

    return session;
}

export async function expireDueSessions() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await client.query(
            `
            WITH expired_sessions AS (
                UPDATE attendance_sessions
                SET
                    status = 'expired',
                    ended_at = COALESCE(ended_at, NOW()),
                    updated_at = NOW()
                WHERE
                    status = 'active'
                    AND expires_at <= NOW()
                RETURNING id, offering_id
            )
            INSERT INTO attendance_records (
                session_id,
                student_id,
                status
            )
            SELECT
                expired_sessions.id,
                enrollments.student_id,
                'absent'
            FROM expired_sessions
            JOIN enrollments
                ON enrollments.offering_id =
                    expired_sessions.offering_id
                AND enrollments.is_active = TRUE
            ON CONFLICT (session_id, student_id) DO NOTHING
            `
        );

        await client.query(
            `
            DELETE FROM attendance_challenges
            WHERE expires_at < NOW() - INTERVAL '1 day'
            `
        );

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

// Backfills records for sessions that were closed before finalization existed.
export async function backfillFinalizedAttendanceRecords() {
    await pool.query(
        `
        INSERT INTO attendance_records (
            session_id,
            student_id,
            status
        )
        SELECT
            attendance_sessions.id,
            enrollments.student_id,
            'absent'
        FROM attendance_sessions
        JOIN enrollments
            ON enrollments.offering_id =
                attendance_sessions.offering_id
            AND enrollments.is_active = TRUE
        WHERE attendance_sessions.status IN ('closed', 'expired')
        ON CONFLICT (session_id, student_id) DO NOTHING
        `
    );
}
