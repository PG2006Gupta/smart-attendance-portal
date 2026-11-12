# 🎓 Smart Attendance Portal (SAP)

**A Smart, Secure & Location-Based Student Attendance Management System**

[🌐 Live Project](https://smart-attendance-portal-7yh1.onrender.com)

## 📌 About the Project

**Smart Attendance Portal (SAP)** is a web-based attendance management system designed to modernize the traditional classroom attendance process.

The project aims to provide an automated, secure, and convenient way for teachers to manage student attendance while reducing manual work, proxy attendance, and attendance-related errors.

Unlike traditional attendance systems that rely entirely on manual entries or shared QR codes, SAP is designed around student authentication and location-based verification.

Students can access the portal using their registered credentials, while teachers can initiate attendance sessions for specific subjects and classrooms.

The system aims to verify whether a student is physically present within the designated classroom area before accepting their attendance.

## 🎯 Problem Statement

Traditional attendance management systems face several challenges:

- Manual attendance consumes valuable classroom time.
- Proxy attendance allows students to mark attendance for others.
- Paper-based records are difficult to maintain and manage.
- Shared QR codes can be forwarded to absent students.
- Managing attendance across multiple classrooms and subjects can become complicated.
- Lack of real-time attendance monitoring.

## 💡 Our Solution

Smart Attendance Portal aims to solve these challenges through a centralized digital attendance platform.

The system introduces:

- Secure student and teacher authentication.
- Location-based attendance verification.
- Classroom-specific attendance boundaries.
- Time-limited attendance sessions.
- Registered-device verification.
- Automated attendance record management.

The main objective is to ensure that attendance is recorded only when the student satisfies the required authentication and classroom-presence conditions.

## ✨ Key Features

### 👨‍🎓 1. Student Portal
- Secure student login.
- Personalized student profile.
- Attendance dashboard.
- Access to attendance-related information.
- Registered-device-based access restrictions.

### 👨‍🏫 2. Teacher Portal
- Dedicated teacher login.
- Subject selection.
- Classroom selection.
- Start and manage attendance sessions.
- Monitor student attendance submissions.

### 📍 3. Location-Based Attendance Verification
- Verify student device location during attendance.
- Use classroom-specific location boundaries.
- Compare student device location with the designated classroom area.
- Accept or reject attendance based on verification conditions.

### ⏱️ 4. Time-Limited Attendance Sessions
- Teachers initiate attendance sessions.
- Students can submit attendance only during the active session.
- Designed around a limited attendance window of approximately 10 minutes.
- Prevents late or unauthorized attendance submissions.

### 🔐 5. Device Authentication
- Limit the number of devices associated with a student account.
- Proposed maximum of two registered devices per student.
- Reduce unauthorized account sharing.
- Add another layer of verification alongside student credentials.

### 🚫 6. Anti-Proxy Attendance
The system aims to reduce proxy attendance through multiple verification layers:

- Student authentication.
- Device verification.
- Classroom location verification.
- Teacher-controlled attendance sessions.
- Time-restricted attendance submission.

## ⚙️ How It Works

### Student Workflow

1. Student opens the Smart Attendance Portal.
2. Logs in using registered credentials.
3. Accesses the student dashboard.
4. Checks for an active attendance session.
5. Submits attendance during the permitted time window.
6. The system performs the required verification checks.
7. Attendance is accepted or rejected based on the verification result.

### Teacher Workflow

1. Teacher logs into the teacher portal.
2. Selects the subject.
3. Selects the classroom. The portal shows that classroom's radius, accuracy limit, and whether its coordinates are verified.
4. Teacher starts the attendance session. Sessions run for 10 minutes.
5. Student submissions are checked against the classroom's range, their device signature, and the session window.
6. Attendance records are maintained for management and monitoring.

## 🏗️ System Architecture

The proposed system follows a client-server architecture.

**Frontend Layer**
- Student login interface.
- Teacher login interface.
- Student dashboard.
- Teacher dashboard.
- Attendance management interface.

**Backend Layer**
- User authentication.
- Attendance session management.
- Student and teacher verification.
- Location validation.
- Attendance processing.

**Database Layer**
- Student information.
- Teacher information.
- Subject records.
- Classroom information.
- Attendance records.
- Registered device information.

## 🛠️ Technology Stack

The architecture is designed around the following technologies and capabilities:

| Technology | Purpose |
|---|---|
| HTML5 | Frontend structure |
| CSS3 | Responsive user interface |
| JavaScript (ES modules) | Frontend interactions and Web Crypto device signing |
| Node.js + Express 5 | Server-side API and page serving |
| PostgreSQL | Student, teacher, classroom, and attendance records |
| `pg` | Database access and connection pooling |
| `express-session` + `connect-pg-simple` | Server-side sessions stored in PostgreSQL |
| Argon2id (`argon2`) | Password hashing |
| WebAuthn (`@simplewebauthn/server`) | Optional passkey sign-in |
| Geolocation API + Haversine | Device location verification against the classroom range |
| Helmet, CORS, `express-rate-limit` | Security headers, origin allowlist, and rate limiting |
| `zod` | Request validation |

## 🚦 Running the Project

### 1. Prerequisites

- Node.js 20 or newer
- PostgreSQL 14 or newer
- A browser with the Geolocation API (location checks need HTTPS or `localhost`)

### 2. Create the database

```bash
createdb -U postgres sap
```

### 3. Configure the environment

If you have a single PostgreSQL connection string (Neon, Supabase, Render,
Railway, or a managed database), let the setup script write `.env` for you:

```bash
npm run db:env -- "postgresql://user:password@host:5432/dbname?sslmode=require"
```

On Windows PowerShell, quoting a long string with `@`, `?`, and `&` inside it
is easy to get wrong. Save it to `connection-string.txt` instead and run
`npm run db:env` with no argument. That file is in `.gitignore`.

The script also rejects a pooled connection string (`-pooler` in the host).
Migrations run inside transactions and depend on connection state, so the
direct endpoint is the correct one for both `db:setup` and the running app.

To configure by hand instead:

```bash
cp .env.example .env
```

Fill in `DB_*` for your PostgreSQL server and generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set `SEED_STUDENT_PASSWORD`, `SEED_TEACHER_PASSWORD`, and `SEED_ADMIN_PASSWORD` too. Each needs at least 12 characters, and they must all differ. Every variable is documented inside `.env.example`.

### 4. Create the schema and demo accounts

```bash
npm install
npm run db:setup
```

`db:setup` applies every migration in order, creates the demo cohort, then the administrator. It is safe to repeat.

Demo accounts it creates:

| Role | Name | Login ID | Password |
|---|---|---|---|
| Student | Student 1 | `CU230101` | `SEED_STUDENT_PASSWORD` |
| Student | Student 2 | `CU230102` | `SEED_STUDENT_PASSWORD` |
| Student | Student 3 | `CU230103` | `SEED_STUDENT_PASSWORD` |
| Student | Student 4 | `CU230104` | `SEED_STUDENT_PASSWORD` |
| Student | Student 5 | `CU230105` | `SEED_STUDENT_PASSWORD` |
| Student | Student 6 | `CU230106` | `SEED_STUDENT_PASSWORD` |
| Student | Student 7 | `CU230107` | `SEED_STUDENT_PASSWORD` |
| Student | Student 8 | `CU230108` | `SEED_STUDENT_PASSWORD` |
| Student | Student 9 | `CU230109` | `SEED_STUDENT_PASSWORD` |
| Student | Student 10 | `CU230110` | `SEED_STUDENT_PASSWORD` |
| Teacher | Teacher 1 | `TCH2001` | `SEED_TEACHER_PASSWORD` |
| Teacher | Teacher 2 | `TCH2002` | `SEED_TEACHER_PASSWORD` |
| Teacher | Teacher 3 | `TCH2003` | `SEED_TEACHER_PASSWORD` |
| Teacher | Teacher 4 | `TCH2004` | `SEED_TEACHER_PASSWORD` |
| Administrator | SAP Administrator | `ADM1001` | `SEED_ADMIN_PASSWORD` |

All students share `SEED_STUDENT_PASSWORD` and all teachers share `SEED_TEACHER_PASSWORD`, so a demo needs three passwords rather than fifteen.

### Demo teaching structure

Every teacher teaches **two subjects** to their **own group of students** in section 311/B.

| Teacher | Subjects | Students | Count |
|---|---|---|---|
| Teacher 1 | DBMS, JAVA | Students 1-4 | 4 |
| Teacher 2 | COA, DSA | Students 5-7 | 3 |
| Teacher 3 | DBMS, MATH | Students 8-9 | 2 |
| Teacher 4 | DSA, MATH | Student 10 | 1 |

Each student therefore takes two subjects, both taught by their own teacher. The groups are uneven (4 + 3 + 2 + 1 = 10) so class sizes of 4, 3, 2, and 1 can all be demonstrated. DBMS, DSA, and MATH are each taught by two different teachers, which is allowed because a class offering is unique per subject, section, and teacher.

The cohort is defined in `database/demo-cohort.js`. Accounts are created by `npm run seed-users` because passwords are Argon2id hashes, which SQL cannot produce. The teaching structure lives in SQL:

- `013_seed_demo_cohort.sql` removes the earlier `CU123456` and `TCH1001` demo accounts and everything that depended on them.
- `014_regroup_demo_teaching.sql` builds the current timetable and student groups above.

### 5. Start the portal

```bash
npm run dev
```

Open `http://localhost:5000`.

### Database commands

| Command | What it does |
|---|---|
| `npm run db:env -- "<url>"` | Write `.env` from one connection string |
| `npm run db:setup` | First-time setup: schema, demo accounts, and seed data |
| `npm run migrate` | Apply only the migrations that are still pending |
| `npm run db:status` | Show which migrations are applied and which are pending |
| `npm run seed-users` | Recreate the demo student and teacher |
| `npm run seed-admin` | Recreate the administrator |

Migrate options:

```bash
npm run migrate -- --status        # same as npm run db:status
npm run migrate -- --through=008   # stop after a given migration
npm run migrate -- --baseline      # record an existing schema without running it
```

Use `--baseline` once on a database that was created manually before the migration runner existed. It records every migration file as applied so the runner can take over. The runner stores its history in the `schema_migrations` table, wraps each migration in a transaction, and warns when a migration file changes after it was applied.

### Attendance ranges

Every classroom needs a verified GPS centre before students can mark attendance. Until then the student page reports that the classroom is not configured and the backend rejects submissions with `classroom_not_configured`.

An administrator configures it on the admin dashboard, under **Attendance Ranges**:

1. Select a classroom.
2. Enter its latitude and longitude, or use **Use my current location** while standing in the classroom.
3. Set the attendance radius (1–500 m) and the accuracy limit (1–500 m). A reading less accurate than the limit is rejected before distance is judged.
4. Enter a reason and choose **Save & Verify**.

The coordinates must be verified in the same save, because an unverified classroom keeps attendance blocked. **Revoke Verification** blocks attendance again without deleting the coordinates, which is useful when a room is temporarily reassigned.

Every change is recorded with the administrator, reason, previous values, and new values. A classroom's range cannot be changed while an attendance session is using it, so the rule students are being measured against cannot shift mid-session.

## 🔒 Security & Verification Approach

SAP focuses on reducing attendance manipulation through multiple verification layers.

| Security Layer | Purpose |
|---|---|
| Student Authentication | Verify student identity |
| Teacher Authentication | Restrict attendance session creation |
| Device Restriction | Reduce account sharing |
| Device Signature | Prove the registered device made the request |
| Location Verification | Check classroom presence |
| Session Time Limit | Prevent late submissions |
| Classroom-Specific Range | Apply different verification boundaries to classrooms |
| Verified Coordinates | Block attendance in classrooms whose range is not approved |

**Important:** Location verification is designed as an additional presence check, not as absolute proof of physical presence. Actual implementation may require additional safeguards against GPS spoofing and device manipulation.

## 🚀 Future Scope

The project can be extended with several advanced features:

- Biometric authentication integration.
- Bluetooth Low Energy (BLE) proximity verification.
- NFC-based classroom verification.
- Real-time teacher attendance monitoring.
- Advanced analytics and attendance reports.
- Automatic shortage-of-attendance notifications.
- Parent and student notification systems.
- Integration with university ERP systems.
- AI-based attendance anomaly detection.
- Advanced device and location fraud detection.

## 🎓 Academic Project

**Project Name:** Smart Attendance Portal (SAP)

**Project Category:** Full-Stack Web Development / Smart Campus Technology

**Project Objective:** To develop a secure and automated attendance management system that reduces proxy attendance and simplifies classroom attendance operations.

The project demonstrates the practical application of web development, authentication systems, database management, and location-based verification technologies.

## 🌍 Our Vision

We believe attendance management should be smart, transparent, and reliable.

Smart Attendance Portal aims to reduce administrative workload, improve classroom accountability, and create a more efficient digital attendance ecosystem for educational institutions.

**Smarter Attendance. Stronger Verification. Better Campus Management.**

---

⭐ If you find this project interesting, consider giving the repository a star!
