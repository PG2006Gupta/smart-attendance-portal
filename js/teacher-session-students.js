// =====================================================
// LIVE ENROLLED STUDENTS AND VERIFICATION OUTCOMES
// Polls the owning teacher's session every three seconds.
// =====================================================

let teacherStudentsPollingInterval = null;
let teacherStudentsRequestInProgress = false;
let teacherStudentsErrorShown = false;

function createTeacherStudentCell(value) {
    const cell = document.createElement("td");
    cell.textContent = value;
    return cell;
}

function teacherDeviceLabel(student) {
    if (student.device_verified) {
        return student.device_name
            ? `✓ ${student.device_name}`
            : "✓ Verified";
    }

    if (student.rejection_reason === "device_signature_invalid") {
        return "Verification failed";
    }

    return "Not checked";
}

function teacherLocationLabel(student) {
    if (student.location_verified) {
        const distance = student.distance_meters === null
            ? null
            : Number(student.distance_meters).toFixed(1);

        return distance === null
            ? "✓ Inside range"
            : `✓ Inside · ${distance} m`;
    }

    if (student.rejection_reason === "outside_classroom") {
        return `Outside · ${Number(student.distance_meters).toFixed(1)} m`;
    }

    if (student.rejection_reason === "location_accuracy_too_low") {
        return "Accuracy too low";
    }

    if (student.rejection_reason === "classroom_not_configured") {
        return "Classroom not configured";
    }

    if (student.rejection_reason === "location_reading_stale") {
        return "Stale reading";
    }

    return "Not checked";
}

function renderTeacherSessionStudents(data) {
    const tableBody = document.getElementById("sessionStudentRows");
    if (!tableBody) return;

    const students = data.students || [];
    const summary = data.summary || {
        detected: 0,
        present: 0,
        absent: 0,
        pending: students.length
    };

    sapSetText("sessionDetectedCount", summary.detected);
    sapSetText("sessionPresentCount", summary.present);
    sapSetText("sessionPendingCount", summary.pending);
    sapSetText("sessionAbsentCount", summary.absent);

    if (data.sessionStatus) {
        updateTeacherSessionStatus(data.sessionStatus);
    }

    tableBody.replaceChildren();

    if (students.length === 0) {
        const row = document.createElement("tr");
        const cell = createTeacherStudentCell(
            "No enrolled students found for this class."
        );
        cell.colSpan = 5;
        row.appendChild(cell);
        tableBody.appendChild(row);
        return;
    }

    students.forEach((student) => {
        const row = document.createElement("tr");

        const nameCell = document.createElement("td");
        const name = document.createElement("strong");
        name.textContent = student.full_name;
        nameCell.appendChild(name);

        const statusCell = document.createElement("td");
        const status = document.createElement("span");
        const attendanceStatus = student.attendance_status || "pending";
        status.className = `attendance-status ${attendanceStatus}`;
        status.textContent =
            attendanceStatus.charAt(0).toUpperCase() +
            attendanceStatus.slice(1);
        statusCell.appendChild(status);

        row.append(
            nameCell,
            createTeacherStudentCell(student.student_number),
            createTeacherStudentCell(teacherDeviceLabel(student)),
            createTeacherStudentCell(teacherLocationLabel(student)),
            statusCell
        );

        tableBody.appendChild(row);
    });
}

async function loadTeacherSessionStudents() {
    if (teacherStudentsRequestInProgress) return;

    const sessionId = activeTeacherSessionId || new URLSearchParams(
        window.location.search
    ).get("sessionId");

    if (!sessionId) return;
    teacherStudentsRequestInProgress = true;

    try {
        const data = await sapApi(
            `/teacher/sessions/${encodeURIComponent(sessionId)}/students`
        );

        renderTeacherSessionStudents(data);
        teacherStudentsErrorShown = false;
    } catch (error) {
        if (error.status === 401) {
            window.location.replace("teacher-login.html");
            return;
        }

        if (!teacherStudentsErrorShown) {
            showSAPToast(
                "error",
                "Student Loading Failed",
                sapNetworkMessage(error)
            );
            teacherStudentsErrorShown = true;
        }
    } finally {
        teacherStudentsRequestInProgress = false;
    }
}

async function initializeTeacherSessionStudents() {
    await loadTeacherSessionStudents();

    if (teacherStudentsPollingInterval) {
        clearInterval(teacherStudentsPollingInterval);
    }

    teacherStudentsPollingInterval = setInterval(() => {
        if (!document.hidden) {
            loadTeacherSessionStudents();
        }
    }, 3000);
}
