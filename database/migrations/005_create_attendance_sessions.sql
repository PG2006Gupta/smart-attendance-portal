-- SAP migration 005
-- Teacher-created attendance sessions.

CREATE TABLE attendance_sessions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    offering_id BIGINT NOT NULL,
    classroom_id BIGINT NOT NULL,
    teacher_id BIGINT NOT NULL,

    -- The backend will generate and validate these timestamps
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,

    status VARCHAR(20) NOT NULL DEFAULT 'active',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT attendance_sessions_offering_fk
        FOREIGN KEY (offering_id)
        REFERENCES class_offerings(id)
        ON DELETE RESTRICT,

    CONSTRAINT attendance_sessions_classroom_fk
        FOREIGN KEY (classroom_id)
        REFERENCES classrooms(id)
        ON DELETE RESTRICT,

    -- Preserve the teacher who originally created the session
    CONSTRAINT attendance_sessions_teacher_fk
        FOREIGN KEY (teacher_id)
        REFERENCES teachers(user_id)
        ON DELETE RESTRICT,

    CONSTRAINT attendance_sessions_status_check
        CHECK (
            status IN ('active', 'closed', 'expired', 'cancelled')
        ),

    CONSTRAINT attendance_sessions_expiry_check
        CHECK (expires_at > started_at),

    CONSTRAINT attendance_sessions_ending_check
        CHECK (
            ended_at IS NULL
            OR ended_at >= started_at
        )
);

-- Indexes for teacher dashboards and active-session lookups
CREATE INDEX attendance_sessions_teacher_idx
    ON attendance_sessions(teacher_id);

CREATE INDEX attendance_sessions_offering_idx
    ON attendance_sessions(offering_id);

CREATE INDEX attendance_sessions_status_expiry_idx
    ON attendance_sessions(status, expires_at);