-- SAP migration 011
-- Administrator-controlled student device registration and audit history.
-- Existing installations that executed 001-010 should run this file once.

BEGIN;

ALTER TABLE users
    DROP CONSTRAINT users_role_check;

ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('student', 'teacher', 'admin'));

CREATE TABLE administrators (
    user_id BIGINT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(254) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT administrators_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT administrators_name_not_blank
        CHECK (full_name = TRIM(full_name) AND full_name <> '')
);

ALTER TABLE students
    ADD COLUMN device_registration_opens_at TIMESTAMPTZ,
    ADD COLUMN device_registration_expires_at TIMESTAMPTZ,
    ADD COLUMN device_registration_locked_at TIMESTAMPTZ
        DEFAULT NOW(),
    ADD CONSTRAINT students_device_window_check
        CHECK (
            (
                device_registration_opens_at IS NULL
                AND device_registration_expires_at IS NULL
            )
            OR
            (
                device_registration_opens_at IS NOT NULL
                AND device_registration_expires_at IS NOT NULL
                AND device_registration_expires_at >
                    device_registration_opens_at
            )
        );

CREATE TABLE device_admin_actions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    student_id BIGINT NOT NULL,
    device_id BIGINT,
    action VARCHAR(40) NOT NULL,
    reason VARCHAR(300) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT device_admin_actions_admin_fk
        FOREIGN KEY (admin_id)
        REFERENCES administrators(user_id)
        ON DELETE RESTRICT,

    CONSTRAINT device_admin_actions_student_fk
        FOREIGN KEY (student_id)
        REFERENCES students(user_id)
        ON DELETE RESTRICT,

    CONSTRAINT device_admin_actions_device_fk
        FOREIGN KEY (device_id)
        REFERENCES student_devices(id)
        ON DELETE RESTRICT,

    CONSTRAINT device_admin_actions_action_check
        CHECK (
            action IN (
                'window_opened',
                'window_closed',
                'device_revoked',
                'registration_reset'
            )
        ),

    CONSTRAINT device_admin_actions_reason_not_blank
        CHECK (reason = TRIM(reason) AND reason <> '')
);

CREATE INDEX students_device_window_idx
    ON students(
        device_registration_locked_at,
        device_registration_expires_at
    );

CREATE INDEX device_admin_actions_student_idx
    ON device_admin_actions(student_id, created_at DESC);

CREATE INDEX device_admin_actions_admin_idx
    ON device_admin_actions(admin_id, created_at DESC);

COMMIT;
