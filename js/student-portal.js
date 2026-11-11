// =====================================================
// STUDENT DASHBOARD, ATTENDANCE, HISTORY, AND PROFILE
// =====================================================

let studentAttendanceUser = null;
let studentAttendanceSession = null;
let studentAttendanceInProgress = false;

function createStudentCell(value) {
    const cell = document.createElement("td");
    cell.textContent = value;
    return cell;
}

function setStudentVerificationStatus(elementId, text, state) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.textContent = text;
    element.className = `verification-step-status ${state}`;
}

async function initializeStudentDashboard() {
    const user = await requireStudentSession();
    if (!user) return;

    try {
        const data = await sapApi("/student/dashboard");
        const { profile, stats } = data;

        if (profile) {
            sapSetText("studentName", profile.full_name);
            sapSetText("studentAvatar", sapInitials(profile.full_name));
            sapSetText(
                "studentWelcomeHeading",
                `Welcome back, ${profile.full_name} 👋`
            );
        }

        sapSetText("studentCurrentDate", new Intl.DateTimeFormat("en-IN", {
            day: "numeric",
            month: "long",
            year: "numeric"
        }).format(new Date()));
        sapSetText("studentOverallPercentage", `${stats.percentage}%`);
        sapSetText("studentPresentCount", stats.present);
        sapSetText("studentAbsentCount", stats.absent);
        sapSetText("studentTotalClasses", stats.total);
        sapSetText("studentCirclePercentage", `${stats.percentage}%`);
        sapSetText("studentOverviewPresent", stats.present);
        sapSetText("studentOverviewAbsent", stats.absent);
        sapSetText(
            "studentAttendanceNote",
            stats.total > 0
                ? `${stats.percentage}% across completed sessions`
                : "No completed attendance sessions yet"
        );

        const circle = document.getElementById("studentAttendanceCircle");
        if (circle) {
            circle.style.background =
                `conic-gradient(#2563eb ${stats.percentage * 3.6}deg, #e5edfb 0deg)`;
        }

        const active = data.activeSessions?.[0];
        sapSetText(
            "studentActiveSessionMessage",
            active
                ? `${active.subject_name} is active in ${active.classroom_code}. Complete verification before the session expires.`
                : "There is no active attendance session for your enrolled classes right now."
        );

        const markButton = document.getElementById(
            "studentMarkAttendanceButton"
        );

        if (markButton && active) {
            markButton.href =
                `student-attendance.html?sessionId=${encodeURIComponent(active.session_id)}`;
        }

        const list = document.getElementById(
            "studentTodayAttendanceList"
        );
        list.replaceChildren();

        if (!data.today?.length) {
            const empty = document.createElement("p");
            empty.className = "sap-empty-state";
            empty.textContent = "No attendance sessions were started today.";
            list.appendChild(empty);
        } else {
            data.today.forEach((item) => {
                const row = document.createElement("div");
                row.className = "attendance-row";

                const subject = document.createElement("div");
                subject.className = "subject-info";
                const icon = document.createElement("div");
                icon.className = "subject-icon";
                icon.textContent = item.subject_code.slice(0, 2);

                const details = document.createElement("div");
                const name = document.createElement("strong");
                name.textContent = item.subject_name;
                const meta = document.createElement("small");
                meta.textContent =
                    `${sapFormatTime(item.started_at)} • ${item.classroom_code}`;
                details.append(name, meta);
                subject.append(icon, details);

                const status = document.createElement("span");
                const statusValue = item.attendance_status ||
                    (item.session_status === "active"
                        ? "pending"
                        : "absent");
                status.className = `status ${statusValue}`;
                status.textContent = item.attendance_status
                    ? item.attendance_status.charAt(0).toUpperCase() +
                        item.attendance_status.slice(1)
                    : item.session_status === "active"
                        ? "Action Required"
                        : "Not Recorded";

                row.append(subject, status);
                list.appendChild(row);
            });
        }
    } catch (error) {
        showSAPToast(
            "error",
            "Dashboard Loading Failed",
            sapNetworkMessage(error)
        );
    }
}

function renderStudentAttendanceSession(session) {
    studentAttendanceSession = session;
    const verifyButton = document.getElementById(
        "studentVerifyAttendanceButton"
    );
    const registerButton = document.getElementById(
        "studentRegisterDeviceButton"
    );

    if (!session) {
        sapSetText("studentSessionSubject", "No Active Class Session");
        sapSetText("studentSessionSection", "Your teacher has not started an attendance session for your enrolled classes.");
        sapSetText("studentSessionClassroom", "—");
        sapSetText("studentSessionRadius", "—");
        sapSetText("studentSessionRangeSummary", "—");
        sapSetText("studentSessionTeacher", "—");
        sapSetText("studentSessionStatus", "INACTIVE");
        setStudentVerificationStatus(
            "deviceStatus",
            "Unavailable",
            "waiting"
        );
        setStudentVerificationStatus(
            "locationStatus",
            "Unavailable",
            "waiting"
        );
        if (verifyButton) verifyButton.disabled = true;
        if (registerButton) registerButton.hidden = true;
        return;
    }

    sapSetText("studentSessionSubject", session.subject_name);
    sapSetText(
        "studentSessionSection",
        `Section ${session.section_name}`
    );
    sapSetText("studentSessionClassroom", session.classroom_code);
    sapSetText(
        "studentSessionRadius",
        `${Number(session.radius_meters)} meters`
    );
    sapSetText(
        "studentSessionRangeSummary",
        session.radius_description ||
            `Accuracy limit ${session.max_accuracy_meters} m`
    );
    sapSetText("studentSessionTeacher", session.teacher_name);
    sapSetText("studentSessionStatus", "ACTIVE");

    if (session.attendance_status === "present") {
        setStudentVerificationStatus(
            "deviceStatus",
            "✓ Verified",
            "success"
        );
        setStudentVerificationStatus(
            "locationStatus",
            "✓ Verified",
            "success"
        );
        const result = document.getElementById("attendanceResult");
        if (result) result.style.display = "block";
        sapSetText(
            "attendanceResultText",
            `Your attendance was recorded at ${sapFormatTime(session.marked_at)}.`
        );
        if (verifyButton) {
            verifyButton.disabled = true;
            verifyButton.textContent = "Attendance Already Marked";
        }
        if (registerButton) registerButton.hidden = true;
        return;
    }

    if (!session.coordinates_verified) {
        setStudentVerificationStatus(
            "locationStatus",
            "Classroom setup required",
            "error"
        );
        sapSetText(
            "studentLocationConfigurationNote",
            "The classroom's verified GPS coordinates have not been configured. Attendance cannot be accepted until an administrator configures them."
        );
        if (verifyButton) verifyButton.disabled = true;
    }
}

async function refreshStudentDeviceState() {
    if (!studentAttendanceUser || !studentAttendanceSession) return;

    const registerButton = document.getElementById(
        "studentRegisterDeviceButton"
    );

    try {
        const [serverData, localDevice] = await Promise.all([
            sapApi("/student/devices"),
            getSAPLocalDevice(studentAttendanceUser.id)
        ]);

        const active = (serverData.devices || []).find(
            (device) =>
                device.credential_id === localDevice?.credentialId &&
                device.status === "active"
        );

        if (active) {
            setStudentVerificationStatus(
                "deviceStatus",
                "Registered on this device",
                "ready"
            );
            if (registerButton) registerButton.hidden = true;
        } else {
            const canRegister =
                serverData.registration?.canRegister === true;

            setStudentVerificationStatus(
                "deviceStatus",
                canRegister
                    ? "Registration required"
                    : "Registration locked by administration",
                "waiting"
            );
            if (registerButton) {
                registerButton.hidden = !canRegister;
                registerButton.disabled = false;
                registerButton.textContent = "Register This Device";
            }
        }
    } catch (error) {
        setStudentVerificationStatus(
            "deviceStatus",
            "Device status unavailable",
            "error"
        );
    }
}

async function initializeStudentAttendancePage() {
    studentAttendanceUser = await requireStudentSession();
    if (!studentAttendanceUser) return;

    try {
        const [data, profileData] = await Promise.all([
            sapApi("/student/sessions/active"),
            sapApi("/student/profile")
        ]);

        sapSetText("studentName", profileData.profile.full_name);
        sapSetText(
            "studentAvatar",
            sapInitials(profileData.profile.full_name)
        );

        const requestedId = Number(
            new URLSearchParams(window.location.search).get("sessionId")
        );
        const session = (data.sessions || []).find(
            (item) => Number(item.session_id) === requestedId
        ) || data.session;

        renderStudentAttendanceSession(session);

        if (session && session.attendance_status !== "present") {
            await refreshStudentDeviceState();
        }
    } catch (error) {
        showSAPToast(
            "error",
            "Session Loading Failed",
            sapNetworkMessage(error)
        );
        renderStudentAttendanceSession(null);
    }
}

async function registerStudentDeviceForAttendance() {
    const button = document.getElementById(
        "studentRegisterDeviceButton"
    );

    if (button) button.disabled = true;

    try {
        await registerSAPStudentDevice();
        showSAPToast(
            "success",
            "Device Registered",
            "This browser now has a registered device key."
        );
        await refreshStudentDeviceState();
    } catch (error) {
        if (button) button.disabled = false;
        showSAPToast(
            "error",
            "Device Registration Failed",
            sapNetworkMessage(error)
        );
    }
}

function getStudentBrowserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("This browser does not support geolocation."));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            resolve,
            (error) => {
                const messages = {
                    1: "Location permission was denied. Allow location access and try again.",
                    2: "Your current location is unavailable. Check GPS and location services.",
                    3: "Location request timed out. Move to an area with a better signal and try again."
                };
                reject(new Error(
                    messages[error.code] || "Unable to obtain your location."
                ));
            },
            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            }
        );
    });
}

async function beginRealStudentAttendanceVerification() {
    if (
        studentAttendanceInProgress ||
        !studentAttendanceSession ||
        studentAttendanceSession.attendance_status === "present"
    ) {
        return;
    }

    studentAttendanceInProgress = true;
    const button = document.getElementById(
        "studentVerifyAttendanceButton"
    );
    if (button) button.disabled = true;

    try {
        setStudentVerificationStatus(
            "deviceStatus",
            "Checking registration...",
            "waiting"
        );

        const [serverDevices, localDevice] = await Promise.all([
            sapApi("/student/devices"),
            getSAPLocalDevice(studentAttendanceUser.id)
        ]);

        const registered = (serverDevices.devices || []).some(
            (device) =>
                device.credential_id === localDevice?.credentialId &&
                device.status === "active"
        );

        if (!registered) {
            const registerButton = document.getElementById(
                "studentRegisterDeviceButton"
            );
            const canRegister =
                serverDevices.registration?.canRegister === true;

            if (registerButton) {
                registerButton.hidden = !canRegister;
            }

            throw new Error(
                canRegister
                    ? "Register this browser before marking attendance."
                    : "This device is not registered. Contact the SAP administrator for device access."
            );
        }

        setStudentVerificationStatus(
            "locationStatus",
            "Requesting GPS location...",
            "waiting"
        );

        const position = await getStudentBrowserLocation();
        const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: position.timestamp
        };

        setStudentVerificationStatus(
            "locationStatus",
            "Location received; server checking...",
            "waiting"
        );
        setStudentVerificationStatus(
            "deviceStatus",
            "Creating signed proof...",
            "waiting"
        );

        const challenge = await sapApi(
            "/student/attendance/challenge",
            {
                method: "POST",
                body: {
                    sessionId: studentAttendanceSession.session_id,
                    credentialId: localDevice.credentialId
                }
            }
        );

        const signature = await signSAPDeviceChallenge(
            challenge.challenge,
            localDevice
        );

        const result = await sapApi("/student/attendance/mark", {
            method: "POST",
            body: {
                sessionId: studentAttendanceSession.session_id,
                challengeId: challenge.challengeId,
                credentialId: localDevice.credentialId,
                requestId: crypto.randomUUID(),
                signature,
                location
            }
        });

        if (result.alreadyMarked) {
            studentAttendanceSession.attendance_status =
                result.attendance?.status || "present";

            const resultBox = document.getElementById("attendanceResult");
            if (resultBox) resultBox.style.display = "block";
            sapSetText(
                "attendanceResultText",
                "An attendance record already exists for this session."
            );
            if (button) button.textContent = "Attendance Already Marked";

            showSAPToast(
                "success",
                "Already Recorded",
                "No duplicate attendance record was created."
            );
            return;
        }

        if (result.attendance?.status !== "present") {
            throw new Error(
                "An attendance record already exists for this session."
            );
        }

        setStudentVerificationStatus(
            "deviceStatus",
            "✓ Verified",
            "success"
        );
        setStudentVerificationStatus(
            "locationStatus",
            `✓ Inside range${result.distanceMeters !== undefined ? ` · ${result.distanceMeters} m` : ""}`,
            "success"
        );

        studentAttendanceSession.attendance_status = "present";
        const resultBox = document.getElementById("attendanceResult");
        if (resultBox) resultBox.style.display = "block";
        sapSetText(
            "attendanceResultText",
            "The server verified your registered device and classroom location."
        );

        if (button) button.textContent = "Attendance Marked";

        showSAPToast(
            "success",
            "Attendance Marked",
            "Your present record was saved successfully."
        );
    } catch (error) {
        if (error.data?.deviceVerified) {
            setStudentVerificationStatus(
                "deviceStatus",
                "✓ Verified",
                "success"
            );
        } else {
            setStudentVerificationStatus(
                "deviceStatus",
                "Not verified",
                "error"
            );
        }

        if (error.data?.locationVerified) {
            setStudentVerificationStatus(
                "locationStatus",
                "✓ Verified",
                "success"
            );
        } else if ([
            "classroom_not_configured",
            "location_reading_stale",
            "location_accuracy_too_low",
            "outside_classroom"
        ].includes(error.data?.code)) {
            setStudentVerificationStatus(
                "locationStatus",
                "Not accepted",
                "error"
            );
        }

        if (button) {
            button.disabled = false;
            button.textContent = "Verify & Mark Attendance →";
        }

        showSAPToast(
            "error",
            "Attendance Not Marked",
            sapNetworkMessage(error)
        );
    } finally {
        studentAttendanceInProgress = false;
    }
}

async function initializeStudentHistoryPage() {
    const user = await requireStudentSession();
    if (!user) return;

    try {
        const [data, profileData] = await Promise.all([
            sapApi("/student/attendance/history"),
            sapApi("/student/profile")
        ]);
        const summary = data.summary;

        sapSetText("studentName", profileData.profile.full_name);
        sapSetText(
            "studentAvatar",
            sapInitials(profileData.profile.full_name)
        );

        sapSetText("historyOverallPercentage", `${summary.percentage}%`);
        sapSetText("historyPresentCount", summary.present);
        sapSetText("historyAbsentCount", summary.absent);
        sapSetText(
            "historyClassCount",
            `Of ${summary.total} completed session${summary.total === 1 ? "" : "s"}`
        );

        const body = document.getElementById("studentHistoryRows");
        body.replaceChildren();

        if (!data.records?.length) {
            const row = document.createElement("tr");
            const cell = createStudentCell(
                "No attendance records are available yet."
            );
            cell.colSpan = 6;
            row.appendChild(cell);
            body.appendChild(row);
            return;
        }

        data.records.forEach((record) => {
            const row = document.createElement("tr");
            const statusCell = document.createElement("td");
            const status = document.createElement("span");
            status.className = `history-status ${record.status}`;
            status.textContent = record.status === "present"
                ? "✓ Present"
                : "✕ Absent";
            statusCell.appendChild(status);

            row.append(
                createStudentCell(sapFormatDate(record.started_at)),
                createStudentCell(record.subject_name),
                createStudentCell(record.section_name),
                createStudentCell(sapFormatTime(record.started_at)),
                createStudentCell(record.classroom_code),
                statusCell
            );
            body.appendChild(row);
        });
    } catch (error) {
        showSAPToast(
            "error",
            "History Loading Failed",
            sapNetworkMessage(error)
        );
    }
}

function semesterLabel(value) {
    const number = Number(value);
    const suffix = number % 10 === 1 && number % 100 !== 11
        ? "st"
        : number % 10 === 2 && number % 100 !== 12
            ? "nd"
            : number % 10 === 3 && number % 100 !== 13
                ? "rd"
                : "th";
    return `${number}${suffix} Semester`;
}

function renderStudentDevices(devices) {
    const list = document.getElementById("studentDeviceList");
    if (!list) return;

    list.replaceChildren();

    if (!devices.length) {
        const empty = document.createElement("p");
        empty.className = "sap-empty-state";
        empty.textContent = "No devices are registered yet.";
        list.appendChild(empty);
        return;
    }

    devices.forEach((device) => {
        const item = document.createElement("div");
        item.className = "sap-device-item";

        const details = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = device.device_name;
        const meta = document.createElement("small");
        meta.textContent =
            `Slot ${device.device_slot} • Last used ${device.last_used_at ? sapFormatDate(device.last_used_at) : "never"}`;
        details.append(name, meta);

        const status = document.createElement("span");
        status.className = "security-status";
        status.textContent = "Read only";

        item.append(details, status);
        list.appendChild(item);
    });
}

async function loadStudentProfile() {
    try {
        const [profileData, deviceData] = await Promise.all([
            sapApi("/student/profile"),
            sapApi("/student/devices")
        ]);
        const profile = profileData.profile;
        const section = profile.sections?.[0];

        sapSetText("studentName", profile.full_name);
        sapSetText("studentAvatar", sapInitials(profile.full_name));
        sapSetText(
            "studentProfileAvatar",
            sapInitials(profile.full_name)
        );
        sapSetText("studentProfileName", profile.full_name);
        sapSetText("studentProfileId", profile.student_number);
        sapSetText("studentProfileFullName", profile.full_name);
        sapSetText("studentProfileCourse", section?.course || "Not assigned");
        sapSetText("studentProfileSection", section?.section || "—");
        sapSetText(
            "studentProfileSemester",
            section ? semesterLabel(section.semester) : "—"
        );
        sapSetText(
            "studentProfileAcademicYear",
            section?.academicYear || "—"
        );
        sapSetText(
            "studentRegisteredDevices",
            `${profile.registered_devices} / 2 Devices`
        );
        sapSetText(
            "studentAuthenticationMethod",
            profile.passkey_count > 0
                ? `Password + ${profile.passkey_count} passkey${profile.passkey_count === 1 ? "" : "s"}`
                : "Password only"
        );
        sapSetText(
            "studentAccountStatus",
            profile.is_active ? "● Account Active" : "● Account Disabled"
        );

        renderStudentDevices(deviceData.devices || []);

        const registration = deviceData.registration;
        const registerButton = document.getElementById(
            "studentProfileRegisterDeviceButton"
        );

        if (registerButton) {
            registerButton.hidden = !registration?.canRegister;
        }

        sapSetText(
            "studentDevicePolicy",
            registration?.canRegister
                ? `Registration is open until ${sapFormatTime(registration.expiresAt)}. It locks automatically after the second device or when the window closes.`
                : "Device registration is locked. Contact the SAP administrator for any device change."
        );
    } catch (error) {
        showSAPToast(
            "error",
            "Profile Loading Failed",
            sapNetworkMessage(error)
        );
    }
}

async function registerStudentDeviceFromProfile() {
    try {
        await registerSAPStudentDevice();
        showSAPToast(
            "success",
            "Device Registered",
            "This browser was added to your registered devices."
        );
        await loadStudentProfile();
    } catch (error) {
        showSAPToast(
            "error",
            "Device Registration Failed",
            sapNetworkMessage(error)
        );
    }
}

async function initializeStudentProfilePage() {
    const user = await requireStudentSession();
    if (!user) return;

    await loadStudentProfile();
    window.addEventListener(
        "sap-passkey-registered",
        loadStudentProfile
    );
}
