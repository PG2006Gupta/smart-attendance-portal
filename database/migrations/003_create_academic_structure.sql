-- SAP migration 003
-- Subjects, sections, teaching assignments, and student enrollments.

CREATE TABLE subjects (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    department VARCHAR(120) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sections (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    name VARCHAR(50) NOT NULL,
    course VARCHAR(120) NOT NULL,
    semester SMALLINT NOT NULL,
    academic_year VARCHAR(9) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sections_semester_check
        CHECK (semester BETWEEN 1 AND 20),

    CONSTRAINT sections_unique
        UNIQUE (name, course, semester, academic_year)
);

-- A class offering connects a subject and section
-- with the teacher responsible for teaching it.
CREATE TABLE class_offerings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    subject_id BIGINT NOT NULL,
    section_id BIGINT NOT NULL,
    teacher_id BIGINT NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT class_offerings_subject_fk
        FOREIGN KEY (subject_id)
        REFERENCES subjects(id),

    CONSTRAINT class_offerings_section_fk
        FOREIGN KEY (section_id)
        REFERENCES sections(id),

    CONSTRAINT class_offerings_teacher_fk
        FOREIGN KEY (teacher_id)
        REFERENCES teachers(user_id)
        ON DELETE RESTRICT,

    CONSTRAINT class_offerings_unique
        UNIQUE (subject_id, section_id, teacher_id)
);

-- A student may be enrolled only once in a particular offering.
CREATE TABLE enrollments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    student_id BIGINT NOT NULL,
    offering_id BIGINT NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT enrollments_student_fk
        FOREIGN KEY (student_id)
        REFERENCES students(user_id)
        ON DELETE CASCADE,

    CONSTRAINT enrollments_offering_fk
        FOREIGN KEY (offering_id)
        REFERENCES class_offerings(id)
        ON DELETE CASCADE,

    CONSTRAINT enrollments_unique
        UNIQUE (student_id, offering_id)
);

-- Indexes for common dashboard and attendance queries
CREATE INDEX class_offerings_teacher_idx
    ON class_offerings(teacher_id);

CREATE INDEX enrollments_student_idx
    ON enrollments(student_id);

CREATE INDEX enrollments_offering_idx
    ON enrollments(offering_id);