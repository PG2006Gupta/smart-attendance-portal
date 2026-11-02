-- SAP migration 001
-- Stores shared login information for students and teachers.
-- Profile and academic information will live in separate tables.

CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Student ID or Teacher ID used during login
    login_id VARCHAR(50) NOT NULL UNIQUE,

    -- This will contain an Argon2id hash, never the actual password
    password_hash TEXT NOT NULL,

    role VARCHAR(20) NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_role_check
        CHECK (role IN ('student', 'teacher')),

    CONSTRAINT users_login_id_not_blank
        CHECK (
            login_id = TRIM(login_id)
            AND login_id <> ''
        )
);