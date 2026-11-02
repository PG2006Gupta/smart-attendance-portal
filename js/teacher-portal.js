// =====================================================
// TEACHER DASHBOARD, RECORDS, DETAILS, AND PROFILE
// =====================================================

async function loadTeacherDashboardData() {
    try {
        const data = await sapApi("/teacher/dashboard");
        const profile = data.profile;
        const stats = data.stats;

        if (profile) {
            sapSetText("teacherName", profile.full_name);
            sapSetText("teacherWelcomeName", profile.full_name);
            sapSetText("teacherAvatar", sapInitials(profile.full_name));
            sapSetText(
                "teacherWelcomeHeading",
                `Welcome back, ${profile.full_name} 👋`
            );
        }

        sapSetText("teacherCurrentDate", new Intl.DateTimeFormat("en-IN", {
            day: "numeric",
            month: "long",
            year: "numeric"
        }).format(new Date()));

        sapSetText("teacherAssignedClasses", stats.assigned_classes);
        sapSetText("teacherCompletedSessions", stats.sessions_completed);
        sapSetText("teacherTotalStudents", stats.students);
        sapSetText("teacherActiveSessions", stats.active_sessions);

        const resume = document.getElementById("resumeActiveSessionButton");
        const active = data.activeSessions?.[0];

        if (resume && active) {
            resume.hidden = false;
            resume.textContent = `Resume ${active.subject_name} Session →`;
            resume.onclick = () => {
                window.location.href =
                    `teacher-attendance.html?sessionId=${encodeURIComponent(active.session_id)}`;
            };
        }
    } catch (error) {
        showSAPToast(
            "error",
            "Dashboard Loading Failed",
            sapNetworkMessage(error)
        );
    }
}

async function initializeTeacherDashboard() {
    const user = await requireTeacherSession();
    if (!user) return;

    await Promise.all([
        loadTeacherClasses(),
        loadTeacherClassrooms(),
        loadTeacherDashboardData()
    ]);
}

function createTeacherRecordCell(value) {
    const cell = document.createElement("td");
    cell.textContent = value;
    return cell;
}

async function initializeTeacherRecords() {
    const user = await requireTeacherSession();
    if (!user) return;

    try {
        const [data, profileData] = await Promise.all([
            sapApi("/teacher/records"),
            sapApi("/teacher/profile")
        ]);
        const summary = data.summary;

        sapSetText("teacherName", profileData.profile.full_name);
        sapSetText(
            "teacherProfileAvatar",
            sapInitials(profileData.profile.full_name)
        );

        sapSetText("recordsTotalSessions", summary.total_sessions);
        sapSetText("recordsStudentsPresent", summary.students_present);
        sapSetText("recordsStudentsAbsent", summary.students_absent);

        const body = document.getElementById("teacherRecordsRows");
        body.replaceChildren();

        if (!data.records?.length) {
            const row = document.createElement("tr");
            const cell = createTeacherRecordCell(
                "No attendance sessions have been created yet."
            );
            cell.colSpan = 8;
            row.appendChild(cell);
            body.appendChild(row);
            return;
        }

        data.records.forEach((record) => {
            const row = document.createElement("tr");
            const statusCell = document.createElement("td");
            const status = document.createElement("span");
            status.className = `teacher-record-status ${record.status}`;
            status.textContent =
                record.status.charAt(0).toUpperCase() +
                record.status.slice(1);
            statusCell.appendChild(status);

            const actionCell = document.createElement("td");
            const link = document.createElement("a");
            link.className = "view-session-button";
            link.href =
                `teacher-attendance-session.html?sessionId=${encodeURIComponent(record.session_id)}`;
            link.textContent = "View Details →";
            actionCell.appendChild(link);

            row.append(
                createTeacherRecordCell(sapFormatDate(record.started_at)),
                createTeacherRecordCell(record.subject_name),
                createTeacherRecordCell(record.section_name),
                createTeacherRecordCell(record.classroom_code),
                createTeacherRecordCell(record.present_count),
                createTeacherRecordCell(record.absent_count),
                statusCell,
                actionCell
            );

            body.appendChild(row);
        });
    } catch (error) {
        showSAPToast(
            "error",
            "Records Loading Failed",
            sapNetworkMessage(error)
        );
    }
}

function sessionVerificationLabel(student) {
    if (student.attendance_status === "present") {
        return "Device + location verified";
    }

    if (student.device_verified) {
        return "Device verified; location not accepted";
    }

    if (student.verification_result === "rejected") {
        return "Verification rejected";
    }

    return "Not checked";
}

async function initializeTeacherSessionDetails() {
    const user = await requireTeacherSession();
    if (!user) return;

    await loadTeacherProfile();

    const sessionId = new URLSearchParams(
        window.location.search
    ).get("sessionId");

    if (!sessionId) {
        sapSetText("detailsSubject", "Session not specified");
        return;
    }

    try {
        const [details, students] = await Promise.all([
            sapApi(`/teacher/sessions/${encodeURIComponent(sessionId)}`),
            sapApi(`/teacher/sessions/${encodeURIComponent(sessionId)}/students`)
        ]);

        const session = details.session;
        sapSetText("detailsSubject", session.subject_name);
        sapSetText(
            "detailsMeta",
            `${sapFormatDate(session.started_at)} • Section ${session.section_name} • Classroom ${session.classroom_code}`
        );
        sapSetText("detailsPresent", students.summary.present);
        sapSetText("detailsAbsent", students.summary.absent);
        sapSetText("detailsTotal", students.summary.totalStudents);
        sapSetText(
            "detailsStatus",
            session.status.charAt(0).toUpperCase() + session.status.slice(1)
        );

        const body = document.getElementById("detailsStudentRows");
        body.replaceChildren();

        if (!students.students.length) {
            const row = document.createElement("tr");
            const cell = createTeacherRecordCell(
                "No students were enrolled in this offering."
            );
            cell.colSpan = 5;
            row.appendChild(cell);
            body.appendChild(row);
            return;
        }

        students.students.forEach((student) => {
            const row = document.createElement("tr");
            const attendanceCell = document.createElement("td");
            const status = document.createElement("span");
            const value = student.attendance_status || "pending";
            status.className = `history-status ${value}`;
            status.textContent = value === "present"
                ? "✓ Present"
                : value === "absent"
                    ? "✕ Absent"
                    : "Pending";
            attendanceCell.appendChild(status);

            row.append(
                createTeacherRecordCell(student.full_name),
                createTeacherRecordCell(student.student_number),
                attendanceCell,
                createTeacherRecordCell(sessionVerificationLabel(student)),
                createTeacherRecordCell(sapFormatTime(student.marked_at))
            );
            body.appendChild(row);
        });
    } catch (error) {
        showSAPToast(
            "error",
            "Session Details Failed",
            sapNetworkMessage(error)
        );
    }
}

async function loadTeacherProfile() {
    try {
        const { profile } = await sapApi("/teacher/profile");
        sapSetText("teacherName", profile.full_name);
        sapSetText("teacherProfileName", profile.full_name);
        sapSetText("teacherProfileAvatar", sapInitials(profile.full_name));
        sapSetText(
            "teacherProfileLargeAvatar",
            sapInitials(profile.full_name)
        );
        sapSetText("teacherProfileId", profile.teacher_number);
        sapSetText("teacherProfileDepartment", profile.department);
        sapSetText("teacherProfileEmail", profile.email || "Not provided");
        sapSetText("teacherAssignedClassCount", profile.assigned_classes);
        sapSetText(
            "teacherPasskeyStatus",
            profile.passkey_count > 0
                ? `Password + ${profile.passkey_count} passkey${profile.passkey_count === 1 ? "" : "s"}`
                : "Password only"
        );
        sapSetText(
            "teacherAccountStatus",
            profile.is_active ? "● Account Active" : "● Account Disabled"
        );
    } catch (error) {
        showSAPToast(
            "error",
            "Profile Loading Failed",
            sapNetworkMessage(error)
        );
    }
}

async function initializeTeacherProfile() {
    const user = await requireTeacherSession();
    if (!user) return;

    await loadTeacherProfile();
    window.addEventListener(
        "sap-passkey-registered",
        loadTeacherProfile
    );
}
