-- SAP migration 008
-- Initial subjects, section, and classroom configurations.
-- Safe to run more than once.

BEGIN;

INSERT INTO subjects (code, name, department)
VALUES
    (
        'DBMS',
        'Database Management',
        'Computer Science & Engineering'
    ),
    (
        'JAVA',
        'Java Programming',
        'Computer Science & Engineering'
    ),
    (
        'COA',
        'Computer Organization',
        'Computer Science & Engineering'
    ),
    (
        'DSA',
        'Data Structures',
        'Computer Science & Engineering'
    ),
    (
        'MATH',
        'Mathematics',
        'Mathematics'
    )
ON CONFLICT (code) DO UPDATE
SET
    name = EXCLUDED.name,
    department = EXCLUDED.department;

INSERT INTO sections (
    name,
    course,
    semester,
    academic_year
)
VALUES (
    '311/B',
    'B.E. Information Technology',
    1,
    '2026-2027'
)
ON CONFLICT (name, course, semester, academic_year)
DO NOTHING;

INSERT INTO classrooms (
    code,
    building,
    radius_meters
)
VALUES
    ('CSE-201', 'CSE Block', 20),
    ('CSE-203', 'CSE Block', 25),
    ('CSE-204', 'CSE Block', 30),
    ('CSE-205', 'CSE Block', 35)
ON CONFLICT (code) DO UPDATE
SET
    building = EXCLUDED.building,
    radius_meters = EXCLUDED.radius_meters,
    updated_at = NOW();

-- Latitude, longitude, and coordinates_verified are deliberately
-- not changed by this seed. Real measurements must be added separately.

COMMIT;