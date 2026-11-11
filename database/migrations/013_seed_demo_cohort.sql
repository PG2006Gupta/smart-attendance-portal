-- SAP migration 013
-- Replaces the original single-student demo data with a full demo cohort:
-- 10 students and 4 teachers.
--
-- Accounts are created by database/seed-users.js because passwords are
-- stored as Argon2id hashes that SQL cannot produce. This migration removes
-- the old demo accounts and creates everything that hangs off the cohort:
-- the second section, class offerings, and enrollments.
--
-- Safe to run more than once.

BEGIN;

-- =====================================================
-- REMOVE THE ORIGINAL DEMO ACCOUNTS
-- =====================================================
-- Deleting the users row cascades to students/teachers. Offerings,
-- enrollments, devices, sessions, and attendance records that reference
-- those rows use ON DELETE RESTRICT, so this deletes them first. Any
-- classroom range audit entries that named these accounts are detached
-- rather than blocking the delete.

DELETE FROM device_admin_actions
WHERE
    admin_id IN (
        SELECT user_id FROM teachers
        WHERE teacher_number IN ('TCH1001')
    )
    OR student_id IN (
        SELECT user_id FROM students
        WHERE student_number IN ('CU123456')
    )
    OR device_id IN (
        SELECT student_devices.id
        FROM student_devices
        JOIN students ON students.user_id = student_devices.student_id
        WHERE students.student_number IN ('CU123456')
    );

DELETE FROM classroom_admin_actions
WHERE admin_id IN (
    SELECT id FROM users
    WHERE login_id IN ('CU123456', 'TCH1001')
);

UPDATE classrooms
SET range_updated_by = NULL
WHERE range_updated_by IN (
    SELECT id FROM users
    WHERE login_id IN ('CU123456', 'TCH1001')
);

DELETE FROM attendance_challenges
WHERE
    student_id IN (
        SELECT user_id FROM students
        WHERE student_number IN ('CU123456')
    )
    OR session_id IN (
        SELECT attendance_sessions.id
        FROM attendance_sessions
        JOIN teachers
            ON teachers.user_id = attendance_sessions.teacher_id
        WHERE teachers.teacher_number IN ('TCH1001')
    );

DELETE FROM attendance_records
WHERE
    student_id IN (
        SELECT user_id FROM students
        WHERE student_number IN ('CU123456')
    )
    OR session_id IN (
        SELECT attendance_sessions.id
        FROM attendance_sessions
        JOIN teachers
            ON teachers.user_id = attendance_sessions.teacher_id
        WHERE teachers.teacher_number IN ('TCH1001')
    );

DELETE FROM verification_attempts
WHERE
    student_id IN (
        SELECT user_id FROM students
        WHERE student_number IN ('CU123456')
    )
    OR session_id IN (
        SELECT attendance_sessions.id
        FROM attendance_sessions
        JOIN teachers
            ON teachers.user_id = attendance_sessions.teacher_id
        WHERE teachers.teacher_number IN ('TCH1001')
    );

DELETE FROM attendance_sessions
WHERE teacher_id IN (
    SELECT user_id FROM teachers
    WHERE teacher_number IN ('TCH1001')
);

DELETE FROM enrollments
WHERE
    student_id IN (
        SELECT user_id FROM students
        WHERE student_number IN ('CU123456')
    )
    OR offering_id IN (
        SELECT class_offerings.id
        FROM class_offerings
        JOIN teachers ON teachers.user_id = class_offerings.teacher_id
        WHERE teachers.teacher_number IN ('TCH1001')
    );

DELETE FROM student_devices
WHERE student_id IN (
    SELECT user_id FROM students
    WHERE student_number IN ('CU123456')
);

DELETE FROM passkey_credentials
WHERE user_id IN (
    SELECT id FROM users WHERE login_id IN ('CU123456', 'TCH1001')
);

DELETE FROM class_offerings
WHERE teacher_id IN (
    SELECT user_id FROM teachers
    WHERE teacher_number IN ('TCH1001')
);

DELETE FROM users
WHERE login_id IN ('CU123456', 'TCH1001');

-- =====================================================
-- SECOND SECTION
-- =====================================================

INSERT INTO sections (name, course, semester, academic_year)
VALUES ('312/A', 'B.E. Information Technology', 1, '2026-2027')
ON CONFLICT (name, course, semester, academic_year) DO NOTHING;

-- =====================================================
-- CLASS OFFERINGS
-- =====================================================
-- Populated once seed-users.js has created the cohort. When this migration
-- runs before the accounts exist it inserts nothing, which is why
-- database/setup.js re-applies it afterwards.

INSERT INTO class_offerings (subject_id, section_id, teacher_id, is_active)
SELECT
    subjects.id,
    sections.id,
    teachers.user_id,
    TRUE
FROM subjects
JOIN teachers
    ON teachers.teacher_number IN ('TCH2001', 'TCH2002', 'TCH2003', 'TCH2004')
JOIN sections
    ON sections.name = '311/B'
CROSS JOIN (VALUES
    ('TCH2001', 'DBMS'),
    ('TCH2002', 'JAVA'),
    ('TCH2003', 'COA'),
    ('TCH2004', 'DSA')
) AS teaching(teacher_number, subject_code)
WHERE
    teachers.teacher_number = teaching.teacher_number
    AND subjects.code = teaching.subject_code
ON CONFLICT (subject_id, section_id, teacher_id) DO NOTHING;

-- Teacher 4 also teaches DBMS to the second section.
INSERT INTO class_offerings (subject_id, section_id, teacher_id, is_active)
SELECT
    subjects.id,
    sections.id,
    teachers.user_id,
    TRUE
FROM subjects
CROSS JOIN sections
CROSS JOIN teachers
WHERE
    subjects.code = 'DBMS'
    AND sections.name = '312/A'
    AND sections.academic_year = '2026-2027'
    AND teachers.teacher_number = 'TCH2004'
ON CONFLICT (subject_id, section_id, teacher_id) DO NOTHING;

-- =====================================================
-- ENROLLMENTS
-- =====================================================
-- Students 1-8 join every main-section offering.

INSERT INTO enrollments (student_id, offering_id, is_active)
SELECT
    students.user_id,
    class_offerings.id,
    TRUE
FROM students
CROSS JOIN class_offerings
JOIN sections ON sections.id = class_offerings.section_id
JOIN teachers ON teachers.user_id = class_offerings.teacher_id
WHERE
    students.student_number IN (
        'CU230101', 'CU230102', 'CU230103', 'CU230104',
        'CU230105', 'CU230106', 'CU230107', 'CU230108'
    )
    AND sections.name = '311/B'
    AND teachers.teacher_number IN
        ('TCH2001', 'TCH2002', 'TCH2003', 'TCH2004')
ON CONFLICT (student_id, offering_id) DO NOTHING;

-- Students 9 and 10 join the second-section offering.

INSERT INTO enrollments (student_id, offering_id, is_active)
SELECT
    students.user_id,
    class_offerings.id,
    TRUE
FROM students
CROSS JOIN class_offerings
JOIN sections ON sections.id = class_offerings.section_id
JOIN teachers ON teachers.user_id = class_offerings.teacher_id
WHERE
    students.student_number IN ('CU230109', 'CU230110')
    AND sections.name = '312/A'
    AND teachers.teacher_number = 'TCH2004'
ON CONFLICT (student_id, offering_id) DO NOTHING;

COMMIT;
