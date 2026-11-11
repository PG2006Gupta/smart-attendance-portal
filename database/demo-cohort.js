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

export const DEPARTMENT = "Computer Science & Engineering";

// Each teacher owns a group of students and teaches both of their subjects
// to that group. The group sizes are uneven on purpose (4 + 3 + 2 + 1 = 10)
// so sessions with different expected counts can be demonstrated.
export const DEMO_STUDENTS = [
    { number: 1, loginId: "CU230101", fullName: "Student 1", teacher: "TCH2001" },
    { number: 2, loginId: "CU230102", fullName: "Student 2", teacher: "TCH2001" },
    { number: 3, loginId: "CU230103", fullName: "Student 3", teacher: "TCH2001" },
    { number: 4, loginId: "CU230104", fullName: "Student 4", teacher: "TCH2001" },
    { number: 5, loginId: "CU230105", fullName: "Student 5", teacher: "TCH2002" },
    { number: 6, loginId: "CU230106", fullName: "Student 6", teacher: "TCH2002" },
    { number: 7, loginId: "CU230107", fullName: "Student 7", teacher: "TCH2002" },
    { number: 8, loginId: "CU230108", fullName: "Student 8", teacher: "TCH2003" },
    { number: 9, loginId: "CU230109", fullName: "Student 9", teacher: "TCH2003" },
    { number: 10, loginId: "CU230110", fullName: "Student 10", teacher: "TCH2004" }
];

// Every teacher teaches exactly two subjects. DBMS, DSA, and MATH are each
// shared by two teachers; JAVA and COA are taught by one. Offerings are
// unique per (subject, section, teacher), so sharing a subject is allowed.
export const DEMO_TEACHERS = [
    { number: 1, loginId: "TCH2001", fullName: "Teacher 1", subjects: ["DBMS", "JAVA"] },
    { number: 2, loginId: "TCH2002", fullName: "Teacher 2", subjects: ["COA", "DSA"] },
    { number: 3, loginId: "TCH2003", fullName: "Teacher 3", subjects: ["DBMS", "MATH"] },
    { number: 4, loginId: "TCH2004", fullName: "Teacher 4", subjects: ["DSA", "MATH"] }
];

// Accounts created by the previous demo seed. They are removed by migration
// 013 so the database matches this cohort exactly.
export const REMOVED_DEMO_LOGIN_IDS = ["CU123456", "TCH1001"];

export function demoTeacherEmail(teacherNumber) {
    return `teacher${teacherNumber}@sap.edu`;
}
