-- SAP migration 010
-- Real device challenges, verification outcomes, and WebAuthn credentials.
-- Existing installations that executed 001-009 should run this file once.

BEGIN;

ALTER TABLE verification_attempts
    ADD COLUMN device_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN location_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- A challenge is short-lived, session-specific, device-specific, and single-use.
-- Raw GPS coordinates are deliberately not stored in this table.
CREATE TABLE attendance_challenges (
    id UUID PRIMARY KEY,
    session_id BIGINT NOT NULL,
    student_id BIGINT NOT NULL,
    device_id BIGINT NOT NULL,
    challenge TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT attendance_challenges_session_fk
        FOREIGN KEY (session_id)
        REFERENCES attendance_sessions(id)
        ON DELETE RESTRICT,

    CONSTRAINT attendance_challenges_student_fk
        FOREIGN KEY (student_id)
        REFERENCES students(user_id)
        ON DELETE RESTRICT,

    CONSTRAINT attendance_challenges_device_fk
        FOREIGN KEY (device_id)
        REFERENCES student_devices(id)
        ON DELETE RESTRICT,

    CONSTRAINT attendance_challenges_expiry_check
        CHECK (expires_at > created_at)
);

CREATE INDEX attendance_challenges_lookup_idx
    ON attendance_challenges(session_id, student_id, device_id);

CREATE INDEX attendance_challenges_expiry_idx
    ON attendance_challenges(expires_at);

-- WebAuthn credentials are separate from the student's two signing devices.
-- A credential can be a platform or roaming passkey authenticator.
CREATE TABLE passkey_credentials (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL,
    credential_id TEXT NOT NULL UNIQUE,
    public_key BYTEA NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    transports TEXT[],
    device_type VARCHAR(20) NOT NULL,
    backed_up BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,

    CONSTRAINT passkey_credentials_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT passkey_credentials_counter_check
        CHECK (counter >= 0),

    CONSTRAINT passkey_credentials_device_type_check
        CHECK (device_type IN ('singleDevice', 'multiDevice'))
);

CREATE INDEX passkey_credentials_user_idx
    ON passkey_credentials(user_id);

COMMIT;
