// =====================================================
// REAL TEACHER SESSION DETAILS, COUNTDOWN, AND CLOSE
// =====================================================

let activeTeacherSessionId = null;
let teacherSessionCountdownInterval = null;
let endTeacherSessionInProgress = false;

function setTeacherSessionText(elementId, value) {
    sapSetText(elementId, value);
}

function updateTeacherSessionStatus(status) {
    const statusText = document.getElementById("sessionStatusText");
    const statusContainer = document.getElementById("sessionLiveStatus");
    const endButton = document.getElementById("endSessionButton");

    const labels = {
        active: "Attendance Active",
        closed: "Attendance Ended",
        expired: "Attendance Expired",
        cancelled: "Attendance Cancelled"
    };

    if (statusText) {
        statusText.textContent = labels[status] || "Attendance Unavailable";
    }

    statusContainer?.classList.toggle("expired", status !== "active");

    if (endButton) {
        endButton.disabled = status !== "active";
        endButton.textContent = status === "active"
            ? "End Attendance Session"
            : labels[status] || "Session Ended";
    }
}

async function loadTeacherAttendanceSession() {
    const sessionId = new URLSearchParams(
        window.location.search
    ).get("sessionId");

    if (!sessionId) {
        setTeacherSessionText("sessionSubject", "Session not specified");
        setTeacherSessionText(
            "sessionDetails",
            "Please start a session from the teacher dashboard."
        );
        return null;
    }

    try {
        const data = await sapApi(
            `/teacher/sessions/${encodeURIComponent(sessionId)}`
        );
        const session = data.session;
        activeTeacherSessionId = session.session_id;

        setTeacherSessionText("teacherName", session.teacher_name);
        setTeacherSessionText(
            "teacherAvatar",
            sapInitials(session.teacher_name)
        );
        setTeacherSessionText("sessionSubject", session.subject_name);
        setTeacherSessionText(
            "sessionDetails",
            `Section ${session.section_name} • Classroom ${session.classroom_code}`
        );
        setTeacherSessionText(
            "sessionSubjectCard",
            `${session.subject_code} — ${session.subject_name}`
        );
        setTeacherSessionText("sessionClassroom", session.classroom_code);
        setTeacherSessionText(
            "sessionRadius",
            `${session.radius_meters} meters`
        );
        setTeacherSessionText(
            "sessionExpectedStudents",
            session.expected_students
        );

        const badge = document.querySelector(
            ".location-verification-badge"
        );

        if (badge) {
            badge.textContent = session.coordinates_verified
                ? "Location Verification Ready"
                : "Classroom Coordinates Required";
        }

        updateTeacherSessionStatus(session.status);
        return data;
    } catch (error) {
        if (error.status === 401) {
            window.location.replace("teacher-login.html");
            return null;
        }

        setTeacherSessionText("sessionSubject", "Unable to load session");
        setTeacherSessionText("sessionDetails", error.message);
        showSAPToast(
            "error",
            "Session Loading Failed",
            sapNetworkMessage(error)
        );
        return null;
    }
}

function startTeacherAttendanceCountdown(
    expiresAt,
    serverTime,
    sessionStatus
) {
    const timer = document.getElementById("sessionTimer");
    if (!timer) return;

    if (teacherSessionCountdownInterval) {
        clearInterval(teacherSessionCountdownInterval);
        teacherSessionCountdownInterval = null;
    }

    if (sessionStatus !== "active") {
        timer.textContent = "00:00";
        updateTeacherSessionStatus(sessionStatus);
        return;
    }

    const expires = Date.parse(expiresAt);
    const server = Date.parse(serverTime);

    if (!Number.isFinite(expires) || !Number.isFinite(server)) {
        timer.textContent = "—";
        return;
    }

    const offset = server - Date.now();

    function update() {
        const remainingMilliseconds = expires - (Date.now() + offset);
        const remainingSeconds = Math.max(
            0,
            Math.ceil(remainingMilliseconds / 1000)
        );
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;

        timer.textContent =
            `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

        if (remainingMilliseconds <= 0) {
            clearInterval(teacherSessionCountdownInterval);
            teacherSessionCountdownInterval = null;
            timer.textContent = "00:00";
            updateTeacherSessionStatus("expired");

            // This refreshes final absent records after the server finalizes
            // the expired session.
            if (typeof loadTeacherSessionStudents === "function") {
                setTimeout(loadTeacherSessionStudents, 500);
            }
        }
    }

    update();

    if (Date.now() + offset < expires) {
        teacherSessionCountdownInterval = setInterval(update, 1000);
    }
}

async function initializeTeacherAttendanceSessionPage() {
    const user = await requireTeacherSession();
    if (!user) return;

    const data = await loadTeacherAttendanceSession();
    if (!data) return;

    startTeacherAttendanceCountdown(
        data.session.expires_at,
        data.serverTime,
        data.session.status
    );

    if (typeof initializeTeacherSessionStudents === "function") {
        await initializeTeacherSessionStudents();
    }
}

async function endRealTeacherAttendanceSession() {
    if (!activeTeacherSessionId || endTeacherSessionInProgress) return;

    const confirmed = window.confirm(
        "End this attendance session? Students without a present record will be marked absent."
    );

    if (!confirmed) return;
    endTeacherSessionInProgress = true;

    const button = document.getElementById("endSessionButton");
    if (button) button.disabled = true;

    try {
        await sapApi(
            `/teacher/sessions/${activeTeacherSessionId}/end`,
            { method: "POST" }
        );

        if (teacherSessionCountdownInterval) {
            clearInterval(teacherSessionCountdownInterval);
            teacherSessionCountdownInterval = null;
        }

        setTeacherSessionText("sessionTimer", "00:00");
        updateTeacherSessionStatus("closed");

        if (typeof loadTeacherSessionStudents === "function") {
            await loadTeacherSessionStudents();
        }

        showSAPToast(
            "success",
            "Attendance Session Ended",
            "The session was closed and final attendance records were saved."
        );

        setTimeout(() => {
            window.location.href = "teacher-dashboard.html";
        }, 700);
    } catch (error) {
        endTeacherSessionInProgress = false;
        if (button) button.disabled = false;

        showSAPToast(
            "error",
            "End Session Failed",
            sapNetworkMessage(error)
        );
    }
}
