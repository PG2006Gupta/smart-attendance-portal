BEGIN;

-- =====================================================
-- CREATE CLASS OFFERINGS FOR TCH1001
-- =====================================================

WITH target_teacher_section AS (
    SELECT
        teachers.user_id AS teacher_id,
        sections.id AS section_id

    FROM teachers

    CROSS JOIN sections

    WHERE
        teachers.teacher_number = 'TCH1001'
        AND sections.name = '311/B'
        AND sections.course = 'B.E. Information Technology'
        AND sections.semester = 1
        AND sections.academic_year = '2026-2027'
),

required_subjects AS (
    SELECT id, code
    FROM subjects
    WHERE code IN ('DBMS', 'JAVA', 'COA', 'DSA')
)

INSERT INTO class_offerings (
    subject_id,
    section_id,
    teacher_id,
    is_active
)

SELECT
    required_subjects.id,
    target_teacher_section.section_id,
    target_teacher_section.teacher_id,
    TRUE

FROM required_subjects

CROSS JOIN target_teacher_section

WHERE NOT EXISTS (
    SELECT 1
    FROM class_offerings
    WHERE
        class_offerings.subject_id = required_subjects.id
        AND class_offerings.section_id =
            target_teacher_section.section_id
);


-- =====================================================
-- ENROLL CU123456 IN THOSE OFFERINGS
-- =====================================================

WITH target_student AS (
    SELECT user_id AS id
    FROM students
    WHERE student_number = 'CU123456'
),

target_offerings AS (
    SELECT class_offerings.id

    FROM class_offerings

    JOIN subjects
        ON subjects.id = class_offerings.subject_id

    JOIN sections
        ON sections.id = class_offerings.section_id

   JOIN teachers
    ON teachers.user_id = class_offerings.teacher_id

    WHERE
        subjects.code IN ('DBMS', 'JAVA', 'COA', 'DSA')
        AND sections.name = '311/B'
        AND sections.academic_year = '2026-2027'
        AND teachers.teacher_number = 'TCH1001'
)

INSERT INTO enrollments (
    student_id,
    offering_id,
    is_active
)

SELECT
    target_student.id,
    target_offerings.id,
    TRUE

FROM target_student

CROSS JOIN target_offerings

WHERE NOT EXISTS (
    SELECT 1
    FROM enrollments
    WHERE
        enrollments.student_id = target_student.id
        AND enrollments.offering_id = target_offerings.id
);

COMMIT;