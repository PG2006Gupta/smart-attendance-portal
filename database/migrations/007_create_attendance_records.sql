-- SAP migration 007
-- Verification history and final attendance records.

CREATE TABLE verification_attempts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    session_id BIGINT NOT NULL,
    student_id BIGINT NOT NULL,
    device_id BIGINT,

    -- Client-generated request ID used to prevent request replay
    request_id UUID NOT NULL UNIQUE,

    result VARCHAR(20) NOT NULL,
    rejection_reason VARCHAR(100),

    -- Calculated by the server; raw coordinates are not stored here
    distance_meters NUMERIC(10, 2),
    accuracy_meters NUMERIC(8, 2),
    location_captured_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT verification_attempts_session_fk
        FOREIGN KEY (session_id)
        REFERENCES attendance_sessions(id)
        ON DELETE RESTRICT,

    CONSTRAINT verification_attempts_student_fk
        FOREIGN KEY (student_id)
        REFERENCES students(user_id)
        ON DELETE RESTRICT,

    CONSTRAINT verification_attempts_device_fk
        FOREIGN KEY (device_id)
        REFERENCES student_devices(id)
        ON DELETE RESTRICT,

    CONSTRAINT verification_attempts_result_check
        CHECK (result IN ('accepted', 'rejected')),

    CONSTRAINT verification_attempts_reason_check
        CHECK (
            (result = 'accepted' AND rejection_reason IS NULL)
            OR
            (result = 'rejected' AND rejection_reason IS NOT NULL)
        ),

    CONSTRAINT verification_attempts_distance_check
        CHECK (distance_meters IS NULL OR distance_meters >= 0),

    CONSTRAINT verification_attempts_accuracy_check
        CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0)
);

CREATE TABLE attendance_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    session_id BIGINT NOT NULL,
    student_id BIGINT NOT NULL,

    -- Required for a present record; empty for system-generated absences
    verification_attempt_id BIGINT UNIQUE,

    status VARCHAR(20) NOT NULL,
    marked_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT attendance_records_session_fk
        FOREIGN KEY (session_id)
        REFERENCES attendance_sessions(id)
        ON DELETE RESTRICT,

    CONSTRAINT attendance_records_student_fk
        FOREIGN KEY (student_id)
        REFERENCES students(user_id)
        ON DELETE RESTRICT,

    CONSTRAINT attendance_records_attempt_fk
        FOREIGN KEY (verification_attempt_id)
        REFERENCES verification_attempts(id)
        ON DELETE RESTRICT,

    -- Prevent duplicate attendance for a student in one session
    CONSTRAINT attendance_records_unique
        UNIQUE (session_id, student_id),

    CONSTRAINT attendance_records_status_check
        CHECK (status IN ('present', 'absent')),

    CONSTRAINT attendance_records_present_check
        CHECK (
            status = 'absent'
            OR (
                status = 'present'
                AND verification_attempt_id IS NOT NULL
                AND marked_at IS NOT NULL
            )
        )
);

CREATE INDEX verification_attempts_session_student_idx
    ON verification_attempts(session_id, student_id);

CREATE INDEX verification_attempts_device_idx
    ON verification_attempts(device_id);

CREATE INDEX attendance_records_student_idx
    ON attendance_records(student_id);