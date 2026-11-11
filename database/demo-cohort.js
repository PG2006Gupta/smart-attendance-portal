// =====================================================
// SAP DEMO COHORT
// =====================================================
// The demo accounts that `npm run db:setup` creates. Passwords are stored
// only as Argon2id hashes, which SQL cannot produce, so accounts are
// created by seed-users.js. Everything that hangs off an account (class
// offerings, enrollments) lives in migration 013.
//
// Keep the numbers below in sync with:
//   database/migrations/013_seed_demo_cohort.sql
//   tests/demo-cohort.test.js (verifies the two agree)

export const SECTION = {
    name: "311/B",
    course: "B.E. Information Technology",
    semester: 1,
    academicYear: "2026-2027"
};

// Second section, so a smaller class can be timetabled alongside the main
// one. Class offerings are unique per (subject, section, teacher).
export const SECONDARY_SECTION = {
    name: "312/A",
    course: "B.E. Information Technology",
    semester: 1,
    academicYear: "2026-2027"
};

export const DEPARTMENT = "Computer Science & Engineering";

// Students 1-8 are enrolled in every subject. Students 9 and 10 share the
// second section with teacher 4, which makes a smaller class to demonstrate
// a session with only a few expected students.
export const DEMO_STUDENTS = [
    { number: 1, loginId: "CU230101", fullName: "Student 1", subjects: "all", section: "main" },
    { number: 2, loginId: "CU230102", fullName: "Student 2", subjects: "all", section: "main" },
    { number: 3, loginId: "CU230103", fullName: "Student 3", subjects: "all", section: "main" },
    { number: 4, loginId: "CU230104", fullName: "Student 4", subjects: "all", section: "main" },
    { number: 5, loginId: "CU230105", fullName: "Student 5", subjects: "all", section: "main" },
    { number: 6, loginId: "CU230106", fullName: "Student 6", subjects: "all", section: "main" },
    { number: 7, loginId: "CU230107", fullName: "Student 7", subjects: "all", section: "main" },
    { number: 8, loginId: "CU230108", fullName: "Student 8", subjects: "all", section: "main" },
    { number: 9, loginId: "CU230109", fullName: "Student 9", subjects: "secondary", section: "secondary" },
    { number: 10, loginId: "CU230110", fullName: "Student 10", subjects: "secondary", section: "secondary" }
];

// Each teacher takes one of the main subjects in the main section. Teacher 4
// also takes DBMS in the second section, so students 9 and 10 have a class.
export const DEMO_TEACHERS = [
    { number: 1, loginId: "TCH2001", fullName: "Teacher 1", subjects: ["DBMS"], sections: ["main"] },
    { number: 2, loginId: "TCH2002", fullName: "Teacher 2", subjects: ["JAVA"], sections: ["main"] },
    { number: 3, loginId: "TCH2003", fullName: "Teacher 3", subjects: ["COA"], sections: ["main"] },
    { number: 4, loginId: "TCH2004", fullName: "Teacher 4", subjects: ["DSA"], sections: ["main", "secondary"] }
];

// Accounts created by the previous demo seed. They are removed by migration
// 013 so the database matches this cohort exactly.
export const REMOVED_DEMO_LOGIN_IDS = ["CU123456", "TCH1001"];

export function demoTeacherEmail(teacherNumber) {
    return `teacher${teacherNumber}@sap.edu`;
}
