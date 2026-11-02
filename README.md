# Smart Attendance Portal (SAP)

This is the existing SAP project with PostgreSQL-backed attendance, signed device verification, WebAuthn passkeys, and a separate administrator-controlled device-registration workflow. The original HTML/CSS design and page structure are retained.

## Included functionality

- Argon2id password login, protected sessions, role guards, and logout
- Real WebAuthn/passkey registration and login for students and teachers
- Teacher class/classroom selection and ten-minute attendance sessions
- Server-synchronized session countdown and manual session closing
- Student active-session discovery for enrolled offerings
- Separate administrator login and device-administration dashboard
- Administrator-approved, 5–60 minute student device-registration windows
- Maximum two current attendance devices per student, enforced in a database transaction
- Automatic registration locking after the second successful device registration
- Read-only student device lists; students cannot revoke, replace, or reset devices
- Administrator revocation, registration reset, and window opening/closing with actor, reason, action, and timestamp audit records
- ECDSA P-256 device keys; private keys are non-extractable and stored in IndexedDB
- Single-use, two-minute, device-bound attendance challenges
- Server verification of device signatures, enrollment, session state, GPS timestamp, GPS accuracy, and Haversine classroom distance
- One attendance record per student/session and request replay protection
- Automatic absent records when a session closes or expires
- Three-second live teacher polling with real device/location outcomes
- Real student/teacher/administrator dashboards, attendance history, session records, and profiles
- Shared profile dropdown with Profile and Logout actions on every authenticated page
- Static frontend serving without exposing `.env`, server source, or migrations

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- A modern browser with Web Crypto, IndexedDB, Geolocation, and WebAuthn support
- HTTPS in production; `localhost` is accepted for local browser security features

## Update the previous complete SAP installation

These instructions assume the previous installation already executed migrations **001–010**. Do not run those migrations again.

1. **Back up your project and database.**
2. Extract this project over the existing SAP files. Keep your real `.env` private and do not replace it with `.env.example`.
3. Compare `.env.example` with your private `.env` and add any missing non-secret settings. Add a new, strong `SEED_ADMIN_PASSWORD` only when you are ready to seed the administrator.
4. Install the updated dependencies:

   ```bash
   npm install
   ```

5. Run **only migration 011 once**, using the same PostgreSQL user and database as the existing installation:

   ```bash
   psql -h localhost -U YOUR_DB_USER -d YOUR_DB_NAME -W -f database/migrations/011_admin_controlled_devices.sql
   ```

   Migration 011 adds the administrator role/profile, registration-window fields, and device-administration audit table. Existing students start **locked**. Their existing current device records are not deleted.

6. Create the separate administrator account. Set these values in your private `.env`:

   ```text
   SEED_ADMIN_PASSWORD=use_a_new_strong_password_here
   SEED_ADMIN_LOGIN_ID=ADM1001
   SEED_ADMIN_NAME=SAP Administrator
   SEED_ADMIN_EMAIL=
   ```

   Then run:

   ```bash
   npm run seed-admin
   ```

   `ADM1001` is the default login ID, not a default password. The password is stored only as an Argon2id hash. Use a password different from the student and teacher development passwords. Existing seeded student and teacher credentials remain unchanged.

7. Start SAP:

   ```bash
   npm run dev
   ```

8. Open **http://localhost:5000**. Use this same-origin URL consistently to avoid cookie and WebAuthn hostname mismatches.

If upgrading an installation older than the previous complete delivery, apply only its missing migrations in numeric order after taking a backup. Do not repeat migrations that have already run.

## Fresh installation only

For a new empty database:

1. Run migrations **001–008** in order with `psql`.
2. Set private seed passwords in `.env` and run `npm run seed-users`.
3. Run migrations **009**, **010**, and **011** in order with `psql`.
4. Set a private administrator seed password and run `npm run seed-admin`.
5. Run `npm run dev`.

Migration 009 assigns the seeded student/teacher to class offerings, so `npm run seed-users` must run before 009. No real seed password is included in this project.

## Administrator-controlled device workflow

1. Log in through **Administrator Portal**.
2. Search for a student by name or student ID and select the record.
3. Enter an administrative reason and choose a registration-window duration.
4. Select **Open Registration Window**. If two current devices already exist, revoke one first or use **Revoke All Devices & Start Again**.
5. During the open window, the student can register available device slots from **Student Profile → Attendance Devices** or the attendance page.
6. Register at most two devices, each from its own normal browser/browser profile. The second successful registration automatically closes further registration and locks the window. Expiry also prevents further registration.
7. Outside an approved window, registration controls are unavailable and the student device list is read-only. Students have no Revoke, Replace, or Reset control; the legacy student revoke API explicitly returns `403`.
8. Later device changes require an administrator action and a new reason. The administrator dashboard displays the audit actor, action, reason, device where applicable, and timestamp.

Opening a window does **not** remove existing devices. **Revoke All Devices & Start Again** explicitly revokes all current devices and opens a new window. Revoked records remain visible to the administrator for history; they no longer count toward the two-current-device limit and cannot mark attendance.

Do not use incognito for persistent registration. Its IndexedDB private key is normally erased when the incognito session closes, while the server-side registration can remain. Use normal separate browser profiles instead.

## Normal attendance workflow

1. Ensure the student has an active registered device through the administrator-controlled workflow above.
2. Log in to the Teacher Portal.
3. Select a class and manually select a classroom.
4. Start the ten-minute session.
5. In the student's registered browser, open **Mark Attendance**, allow GPS access, and select **Verify & Mark Attendance**.
6. The server checks the active session, enrollment, registered device, expiring single-use challenge signature, request uniqueness, GPS freshness/accuracy, and classroom distance. A QR code or device registration alone is never treated as sufficient attendance proof.
7. The teacher page updates with the server-verified result. Device registration by itself leaves the teacher at **Not checked** until an attendance attempt occurs.
8. Closing or expiring the session creates absent records for enrolled students who did not mark attendance.

## Classroom coordinates

The seed deliberately does **not** invent campus coordinates. Until real coordinates are deliberately configured, a valid device attempt is rejected with `classroom_not_configured`; it does not create a Present record.

After measuring and reviewing a classroom location, update it using SQL similar to this example. Replace every placeholder first:

```sql
UPDATE classrooms
SET
    latitude = REPLACE_WITH_MEASURED_LATITUDE,
    longitude = REPLACE_WITH_MEASURED_LONGITUDE,
    coordinates_verified = TRUE,
    max_accuracy_meters = 100,
    updated_at = NOW()
WHERE code = 'CSE-201';
```

Repeat for other classrooms and choose accuracy limits through field testing. The classroom radii remain 20, 25, 30, and 35 metres. GPS cannot reliably verify an exact floor or altitude in this application; no floor/altitude enforcement is claimed.

## Passkeys

- Register a passkey while logged in through **Student Profile** or **Teacher Profile**.
- Use **Login with Passkey** on the corresponding login page.
- Registration creates a discoverable credential with user verification required.
- Local development should use `localhost`, not a mixture of `localhost` and `127.0.0.1`.
- In production, set `WEBAUTHN_RP_ID` to your domain and `WEBAUTHN_ORIGINS` to the exact HTTPS frontend origin.

Password login remains available when no passkey is registered. The separate administrator currently uses password login.

## Validation commands

```bash
npm run check   # JavaScript syntax, HTML IDs, and local file references
npm test        # Haversine, device signatures, challenges, and device-window policy tests
npm audit       # Dependency vulnerability report
```

The project was also exercised against a fresh PostgreSQL database after migrations 001–011. API checks covered role isolation, initial locking, administrator window open/close, two-device automatic locking, denied student revocation, administrator revoke/reset, audit records, accepted/rejected attendance, replay protection, `classroom_not_configured`, final absence records, dashboards, and records. Browser checks used two separate browser profiles and covered administrator reset, student read-only controls, automatic locking, virtual WebAuthn registration/login, device-signed GPS attendance, live teacher updates, and session closing. A separate navigation suite verified Profile/Logout dropdowns and real logout on every authenticated student, teacher, and administrator page.

For accepted-attendance tests, coordinates were deliberately configured only in the disposable test database. The delivered classroom seed remains unconfigured.

## Production configuration

Use the same Express origin for frontend and API where possible. Set:

```text
NODE_ENV=production
FRONTEND_URLS=https://attendance.example.edu
WEBAUTHN_RP_ID=attendance.example.edu
WEBAUTHN_ORIGINS=https://attendance.example.edu
DB_SSL=true
```

Use your provider's real hostname and database SSL requirements. Keep `DB_SSL_REJECT_UNAUTHORIZED=true` unless your provider explicitly requires a different setting. Deploy behind HTTPS and a trusted reverse proxy. Never upload, commit, or include a real `.env` in an archive.

## Security boundaries

- GPS is imprecise and can be spoofed. The server checks accuracy, freshness, and distance, but no web application can guarantee physical presence from GPS alone.
- Device signatures prove possession of a registered private key; they do not prove that the key's owner is physically present.
- An administrator-approved self-registration window does **not**, by itself, prevent proxy attendance. A student could still share an account, a registered browser, or a device. Use appropriate institutional supervision and additional controls where required.
- Passkeys provide strong account authentication but do not independently prove classroom location.
- Raw student GPS coordinates are not stored in `verification_attempts`; only calculated distance, accuracy, timestamp, and outcome are stored.
- Teacher-device proximity, Bluetooth/NFC, network attestation, hardware-backed device attestation, and stronger anti-spoofing controls would require additional infrastructure and field testing.
- There is no timetable table in the current schema. Dashboard class lists therefore show assigned offerings and sessions actually started, not invented scheduled times.
