-- SAP migration 002
-- Student and teacher profile information.
-- Each profile belongs to one row in the users table.

CREATE TABLE students (
    user_id BIGINT PRIMARY KEY,

    student_number VARCHAR(50) NOT NULL UNIQUE,
    full_name VARCHAR(100) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT students_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT students_name_not_blank
        CHECK (
            full_name = TRIM(full_name)
            AND full_name <> ''
        )
);

CREATE TABLE teachers (
    user_id BIGINT PRIMARY KEY,

    teacher_number VARCHAR(50) NOT NULL UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    department VARCHAR(120) NOT NULL,
    email VARCHAR(254) UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT teachers_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT teachers_name_not_blank
        CHECK (
            full_name = TRIM(full_name)
            AND full_name <> ''
        )
);
