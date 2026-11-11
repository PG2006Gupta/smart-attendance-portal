-- SAP migration 014
-- Regroups the demo teaching structure:
--   * every teacher teaches exactly two subjects
--   * students are split into four groups, one group per teacher
--
-- Only demo class structure is touched. Attendance history is preserved:
-- sessions keep their offering, and enrollments that already have
-- attendance records are left in place.
--
-- Safe to run more than once.

BEGIN;

-- =====================================================
-- CLOSE THE 013 TIMETABLE
-- =====================================================
-- Class offerings are never deleted here because attendance sessions
-- reference them. They are deactivated and rebuilt below.

UPDATE class_offerings
SET is_active = FALSE
WHERE teacher_id IN (
    SELECT user_id FROM teachers
    WHERE teacher_number IN ('TCH2001', 'TCH2002', 'TCH2003', 'TCH2004')
);

-- Drop the demo enrollments, except any that already carry attendance.
DELETE FROM enrollments
WHERE
    student_id IN (
        SELECT user_id FROM students
        WHERE student_number IN (
            'CU230101', 'CU230102', 'CU230103', 'CU230104', 'CU230105',
            'CU230106', 'CU230107', 'CU230108', 'CU230109', 'CU230110'
        )
    )
    AND NOT EXISTS (
        SELECT 1
        FROM attendance_records
        WHERE
            attendance_records.session_id IN (
                SELECT attendance_sessions.id
                FROM attendance_sessions
                WHERE attendance_sessions.offering_id =
                    enrollments.offering_id
            )
            AND attendance_records.student_id = enrollments.student_id
    );

-- =====================================================
-- TEACHERS AND THEIR TWO SUBJECTS
-- =====================================================
-- Teacher 1: DBMS, JAVA
-- Teacher 2: COA, DSA
-- Teacher 3: DBMS, MATH
-- Teacher 4: DSA, MATH
--
-- All four teach section 311/B. DBMS, DSA, and MATH are shared by two
-- teachers each; the unique constraint is (subject, section, teacher), so
-- the same subject can be offered by more than one teacher.

INSERT INTO class_offerings (subject_id, section_id, teacher_id, is_active)
SELECT
    subjects.id,
    sections.id,
    teachers.user_id,
    TRUE
FROM (VALUES
    ('TCH2001', 'DBMS'),
    ('TCH2001', 'JAVA'),
    ('TCH2002', 'COA'),
    ('TCH2002', 'DSA'),
    ('TCH2003', 'DBMS'),
    ('TCH2003', 'MATH'),
    ('TCH2004', 'DSA'),
    ('TCH2004', 'MATH')
) AS teaching(teacher_number, subject_code)
JOIN teachers ON teachers.teacher_number = teaching.teacher_number
JOIN subjects ON subjects.code = teaching.subject_code
JOIN sections
    ON sections.name = '311/B'
    AND sections.course = 'B.E. Information Technology'
    AND sections.semester = 1
    AND sections.academic_year = '2026-2027'
ON CONFLICT (subject_id, section_id, teacher_id) DO UPDATE
SET is_active = TRUE;

-- =====================================================
-- STUDENT GROUPS
-- =====================================================
-- Teacher 1: Student 1-4
-- Teacher 2: Student 5-7
-- Teacher 3: Student 8-9
-- Teacher 4: Student 10
--
-- Students are enrolled in both of their teacher's subjects.

INSERT INTO enrollments (student_id, offering_id, is_active)
SELECT
    students.user_id,
    class_offerings.id,
    TRUE
FROM (VALUES
    ('CU230101', 'TCH2001'),
    ('CU230102', 'TCH2001'),
    ('CU230103', 'TCH2001'),
    ('CU230104', 'TCH2001'),
    ('CU230105', 'TCH2002'),
    ('CU230106', 'TCH2002'),
    ('CU230107', 'TCH2002'),
    ('CU230108', 'TCH2003'),
    ('CU230109', 'TCH2003'),
    ('CU230110', 'TCH2004')
) AS groups(student_number, teacher_number)
JOIN students ON students.student_number = groups.student_number
JOIN class_offerings
    ON class_offerings.teacher_id = (
        SELECT user_id FROM teachers
        WHERE teacher_number = groups.teacher_number
    )
    AND class_offerings.is_active = TRUE
ON CONFLICT (student_id, offering_id) DO UPDATE
SET is_active = TRUE;

COMMIT;
