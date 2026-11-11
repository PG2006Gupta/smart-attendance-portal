// =====================================================
// SAP ADMINISTRATOR-CONTROLLED DEVICE MANAGEMENT
// =====================================================

let adminDashboardUser = null;
let adminSelectedStudentId = null;
let adminSelectionRequest = 0;
let adminActionInProgress = false;

function adminFormatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function adminActionLabel(action) {
    return String(action || "unknown").replaceAll("_", " ");
}

function adminStatusClass(status) {
    if (status === "open") return "active";
    if (status === "expired") return "expired";
    return "cancelled";
}

function setAdminControlsDisabled(disabled) {
    [
        "adminActionReason",
        "adminWindowDuration",
        "adminOpenWindowButton",
        "adminCloseWindowButton",
        "adminResetDevicesButton"
    ].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.disabled = disabled;
    });
}

async function loadAdminOverview() {
    const data = await sapApi("/admin/overview");
    const stats = data.stats || {};

    sapSetText("adminTotalStudents", stats.total_students ?? 0);
    sapSetText("adminCurrentDevices", stats.current_devices ?? 0);
    sapSetText("adminOpenWindows", stats.open_windows ?? 0);
    sapSetText("adminLockedStudents", stats.locked_students ?? 0);
    sapSetText("adminReadyClassrooms", stats.ready_classrooms ?? 0);
    sapSetText(
        "adminUnconfiguredClassrooms",
        stats.unconfigured_classrooms ?? 0
    );

    if (data.profile) {
        sapSetText("adminName", data.profile.full_name);
        sapSetText("adminAvatar", sapInitials(data.profile.full_name));
        sapSetText(
            "adminWelcomeHeading",
            `Welcome, ${data.profile.full_name}`
        );
    }
}

function renderAdminStudentResults(students) {
    const container = document.getElementById("adminStudentResults");
    if (!container) return;
    container.replaceChildren();

    if (!students.length) {
        const empty = document.createElement("p");
        empty.className = "sap-empty-state";
        empty.textContent = "No matching students found.";
        container.appendChild(empty);
        return;
    }

    students.forEach((student) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "admin-student-result";
        button.dataset.studentId = String(student.student_id);
        if (Number(student.student_id) === adminSelectedStudentId) {
            button.classList.add("selected");
        }

        const identity = document.createElement("span");
        const name = document.createElement("strong");
        name.textContent = student.full_name;
        const number = document.createElement("small");
        number.textContent = student.student_number;
        identity.append(name, number);

        const meta = document.createElement("span");
        meta.className = "admin-result-meta";
        meta.textContent =
            `${student.device_count}/2 devices • ${student.registration_status}`;

        button.append(identity, meta);
        button.addEventListener(
            "click",
            () => selectAdminStudent(student.student_id)
        );
        container.appendChild(button);
    });
}

async function searchAdminStudents() {
    const input = document.getElementById("adminStudentSearch");
    const container = document.getElementById("adminStudentResults");
    const query = input?.value.trim() || "";

    if (container) {
        const loading = document.createElement("p");
        loading.className = "sap-empty-state";
        loading.textContent = "Searching students...";
        container.replaceChildren(loading);
    }

    try {
        const data = await sapApi(
            `/admin/students?query=${encodeURIComponent(query)}`
        );
        renderAdminStudentResults(data.students || []);
    } catch (error) {
        if (container) {
            const message = document.createElement("p");
            message.className = "sap-empty-state sap-warning-text";
            message.textContent = sapNetworkMessage(error);
            container.replaceChildren(message);
        }
    }
}

function renderAdminDevices(devices) {
    const list = document.getElementById("adminDeviceList");
    if (!list) return;
    list.replaceChildren();

    if (!devices.length) {
        const empty = document.createElement("p");
        empty.className = "sap-empty-state";
        empty.textContent = "No device registrations found.";
        list.appendChild(empty);
        return;
    }

    devices.forEach((device) => {
        const current = ["pending", "active"].includes(device.status);
        const item = document.createElement("div");
        item.className = `sap-device-item admin-device-item${current ? "" : " revoked"}`;

        const details = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = device.device_name;
        const status = document.createElement("span");
        status.className =
            `admin-device-status${current ? "" : " revoked"}`;
        status.textContent = device.status;
        const meta = document.createElement("small");
        meta.textContent =
            `Slot ${device.device_slot} • Registered ${adminFormatDateTime(device.registered_at)} • Last used ${device.last_used_at ? adminFormatDateTime(device.last_used_at) : "never"}`;
        details.append(name, status, meta);

        item.appendChild(details);

        if (current) {
            const revoke = document.createElement("button");
            revoke.type = "button";
            revoke.className = "sap-danger-link";
            revoke.textContent = "Revoke";
            revoke.disabled = adminActionInProgress;
            revoke.addEventListener(
                "click",
                () => revokeAdminDevice(
                    device.device_id,
                    device.device_name
                )
            );
            item.appendChild(revoke);
        }

        list.appendChild(item);
    });
}

function renderAdminAudit(actions) {
    const list = document.getElementById("adminAuditList");
    if (!list) return;
    list.replaceChildren();

    if (!actions.length) {
        const empty = document.createElement("p");
        empty.className = "sap-empty-state";
        empty.textContent = "No administrative actions recorded for this student.";
        list.appendChild(empty);
        return;
    }

    actions.forEach((entry) => {
        const item = document.createElement("article");
        item.className = "admin-audit-item";

        const action = document.createElement("strong");
        action.textContent = adminActionLabel(entry.action);
        const actor = document.createElement("span");
        actor.textContent = `Actor: ${entry.admin_login_id}`;
        const timestamp = document.createElement("small");
        timestamp.textContent = adminFormatDateTime(entry.created_at);
        const reason = document.createElement("div");
        reason.className = "admin-audit-reason";
        reason.textContent = `Reason: ${entry.reason}`;

        item.append(action, actor, timestamp, reason);

        if (entry.device_name) {
            const device = document.createElement("small");
            device.className = "admin-audit-reason";
            device.textContent =
                `Device: ${entry.device_name} (slot ${entry.device_slot})`;
            item.appendChild(device);
        }

        list.appendChild(item);
    });
}

function renderAdminSelectedStudent(data) {
    const student = data.student;
    const registration = data.registration;
    const count = Number(student.device_count);

    sapSetText("adminSelectedStudentName", student.full_name);
    sapSetText(
        "adminSelectedStudentId",
        `${student.student_number} • ${count}/2 current devices`
    );

    const status = registration.windowOpen
        ? "open"
        : registration.expiresAt &&
            new Date(registration.expiresAt).getTime() <= Date.now()
            ? "expired"
            : "locked";
    const statusElement = document.getElementById(
        "adminRegistrationStatus"
    );
    if (statusElement) {
        statusElement.className =
            `teacher-record-status ${adminStatusClass(status)}`;
        statusElement.textContent = status.toUpperCase();
    }

    sapSetText(
        "adminWindowStatus",
        registration.windowOpen
            ? registration.canRegister
                ? "Open — student registration allowed"
                : "Open — no device slot available"
            : "Locked — student registration denied"
    );
    sapSetText(
        "adminWindowExpiry",
        registration.windowOpen
            ? `Expires ${adminFormatDateTime(registration.expiresAt)}`
            : registration.lockedAt
                ? `Locked ${adminFormatDateTime(registration.lockedAt)}`
                : "No active registration window."
    );
    sapSetText(
        "adminAuditSubtitle",
        `${student.full_name} • latest 50 actions`
    );

    renderAdminDevices(data.devices || []);
}

async function selectAdminStudent(studentId) {
    const id = Number(studentId);
    if (!Number.isInteger(id) || id <= 0) return;

    adminSelectedStudentId = id;
    const requestNumber = ++adminSelectionRequest;
    setAdminControlsDisabled(true);
    sapSetText("adminSelectedStudentName", "Loading student...");
    sapSetText("adminWindowStatus", "Loading registration state...");

    document.querySelectorAll(".admin-student-result").forEach((button) => {
        button.classList.toggle(
            "selected",
            Number(button.dataset.studentId) === id
        );
    });

    try {
        const [deviceData, auditData] = await Promise.all([
            sapApi(`/admin/students/${id}/devices`),
            sapApi(`/admin/students/${id}/device-actions`)
        ]);

        if (requestNumber !== adminSelectionRequest) return;
        renderAdminSelectedStudent(deviceData);
        renderAdminAudit(auditData.actions || []);
        setAdminControlsDisabled(false);
    } catch (error) {
        if (requestNumber !== adminSelectionRequest) return;
        showSAPToast(
            "error",
            "Student Loading Failed",
            sapNetworkMessage(error)
        );
        sapSetText("adminWindowStatus", "Could not load this student.");
    }
}

function getAdminActionReason() {
    const reason = document
        .getElementById("adminActionReason")
        ?.value.trim() || "";

    if (reason.length < 3 || reason.length > 300) {
        throw new Error(
            "Enter an administrative reason between 3 and 300 characters."
        );
    }

    return reason;
}

function getAdminWindowDuration() {
    return Number(
        document.getElementById("adminWindowDuration")?.value || 15
    );
}

async function runAdminAction({
    path,
    confirmation,
    successTitle,
    action = null
}) {
    if (!adminSelectedStudentId || adminActionInProgress) return;

    let reason;
    try {
        reason = getAdminActionReason();
    } catch (error) {
        showSAPToast("error", "Reason Required", error.message);
        return;
    }

    if (confirmation && !window.confirm(confirmation)) return;

    adminActionInProgress = true;
    setAdminControlsDisabled(true);

    try {
        const data = await sapApi(path, {
            method: "POST",
            body: {
                ...(action ? { action } : {}),
                reason,
                durationMinutes: getAdminWindowDuration()
            }
        });
        const reasonField = document.getElementById("adminActionReason");
        if (reasonField) reasonField.value = "";

        showSAPToast(
            "success",
            successTitle,
            data.message || "Administrative action completed."
        );

        const selectedId = adminSelectedStudentId;
        adminActionInProgress = false;
        await Promise.all([
            loadAdminOverview(),
            selectAdminStudent(selectedId),
            searchAdminStudents()
        ]);
    } catch (error) {
        showSAPToast(
            "error",
            "Administrative Action Failed",
            sapNetworkMessage(error)
        );
    } finally {
        adminActionInProgress = false;
        if (adminSelectedStudentId) setAdminControlsDisabled(false);
    }
}

function changeAdminRegistrationWindow(action) {
    if (!adminSelectedStudentId) return;
    const opening = action === "open";

    return runAdminAction({
        path: `/admin/students/${adminSelectedStudentId}/registration-window`,
        action,
        confirmation: opening
            ? `Allow this student to register available device slots for ${getAdminWindowDuration()} minutes?`
            : "Close the registration window and lock student device registration?",
        successTitle: opening ? "Window Opened" : "Registration Locked"
    });
}

function resetAdminStudentDevices() {
    if (!adminSelectedStudentId) return;

    return runAdminAction({
        path: `/admin/students/${adminSelectedStudentId}/reset-devices`,
        confirmation: "Revoke ALL current devices for this student and open a new registration window? Existing device keys will stop working.",
        successTitle: "Registration Reset"
    });
}

function revokeAdminDevice(deviceId, deviceName) {
    if (!adminSelectedStudentId) return;

    return runAdminAction({
        path: `/admin/devices/${deviceId}/revoke`,
        confirmation: `Revoke ${deviceName}? This device will no longer be accepted for attendance.`,
        successTitle: "Device Revoked"
    });
}

async function initializeAdminDashboard() {
    adminDashboardUser = await requireAdminSession();
    if (!adminDashboardUser) return;

    setAdminControlsDisabled(true);

    try {
        await Promise.all([
            loadAdminOverview(),
            loadAdminRanges()
        ]);
    } catch (error) {
        showSAPToast(
            "error",
            "Dashboard Loading Failed",
            sapNetworkMessage(error)
        );
    }
}

async function initializeAdminProfile() {
    const user = await requireAdminSession();
    if (!user) return;

    sapSetText("adminProfileId", user.loginId);

    try {
        const data = await sapApi("/admin/overview");
        const profile = data.profile || {};
        const stats = data.stats || {};
        const fullName = profile.full_name || user.loginId;

        sapSetText("adminName", fullName);
        sapSetText("adminProfileName", fullName);
        sapSetText("adminProfileFullName", fullName);
        sapSetText("adminProfileEmail", profile.email || "Not provided");
        sapSetText("adminProfileAvatar", sapInitials(fullName));
        sapSetText("adminProfileLargeAvatar", sapInitials(fullName));
        sapSetText("adminProfileStudents", stats.total_students ?? 0);
        sapSetText("adminProfileDevices", stats.current_devices ?? 0);
        sapSetText("adminProfileWindows", stats.open_windows ?? 0);
    } catch (error) {
        showSAPToast(
            "error",
            "Profile Loading Failed",
            sapNetworkMessage(error)
        );
    }
}

// =====================================================
// SAP ADMINISTRATOR ATTENDANCE RANGES
// =====================================================

let adminClassrooms = [];
let adminSelectedClassroomId = null;
let adminRangeInProgress = false;

function adminFormatCoordinate(value) {
    const coordinate = Number(value);

    if (!Number.isFinite(coordinate)) return "—";

    return coordinate.toFixed(6);
}

function adminClassroomState(classroom) {
    if (Number(classroom.active_sessions) > 0) {
        return { key: "busy", label: "Session running" };
    }

    if (
        classroom.coordinates_verified &&
        classroom.latitude !== null &&
        classroom.longitude !== null
    ) {
        return { key: "ready", label: "Ready" };
    }

    if (classroom.latitude !== null && classroom.longitude !== null) {
        return { key: "unverified", label: "Unverified" };
    }

    return { key: "unconfigured", label: "Not configured" };
}

function renderAdminRangeStats(stats, checks) {
    const container = document.getElementById("adminRangeStats");
    if (!container || !stats) return;

    container.replaceChildren();
    container.hidden = false;
    container.classList.add("admin-range-stats");

    const lines = [
        `${stats.ready_classrooms} of ${stats.total_classrooms} classrooms ready`,
        `${stats.active_sessions} attendance session(s) running now`,
        `${checks?.accepted_24h ?? 0} accepted check(s) in the last 24 hours`,
        `${checks?.outside_range_24h ?? 0} outside the range`,
        `${checks?.inaccurate_24h ?? 0} rejected for low accuracy`,
        `${checks?.unconfigured_24h ?? 0} rejected because the classroom was not configured`
    ];

    lines.forEach((line, index) => {
        const element = document.createElement(index === 0 ? "strong" : "span");
        element.textContent = line;
        container.appendChild(element);
    });
}

function renderAdminRangeList(classrooms) {
    const list = document.getElementById("adminRangeList");
    if (!list) return;

    list.replaceChildren();

    if (!classrooms.length) {
        const empty = document.createElement("p");
        empty.className = "sap-empty-state";
        empty.textContent = "No classrooms have been created yet.";
        list.appendChild(empty);
        return;
    }

    classrooms.forEach((classroom) => {
        const state = adminClassroomState(classroom);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "admin-range-item";
        button.dataset.classroomId = String(classroom.classroom_id);

        if (Number(classroom.classroom_id) === adminSelectedClassroomId) {
            button.classList.add("selected");
        }

        const identity = document.createElement("span");
        const code = document.createElement("strong");
        code.textContent = classroom.code;
        const details = document.createElement("small");
        details.textContent =
            `${classroom.radius_meters} m radius • ` +
            `${classroom.max_accuracy_meters} m accuracy limit`;

        identity.append(code, details);

        const badge = document.createElement("span");
        badge.className = `admin-range-state ${state.key}`;
        badge.textContent = state.label;

        button.append(identity, badge);
        button.addEventListener(
            "click",
            () => selectAdminClassroom(classroom.classroom_id)
        );
        list.appendChild(button);
    });
}

function buildAdminRangeField(label, input) {
    const wrapper = document.createElement("label");
    wrapper.textContent = label;
    wrapper.appendChild(input);
    return wrapper;
}

function buildAdminRangeInput({ id, value, step, min, max, type = "number" }) {
    const input = document.createElement("input");
    input.id = id;
    input.type = type;
    input.step = step;
    input.min = String(min);
    input.max = String(max);
    input.value = value;
    return input;
}

function renderAdminRangeEditor(classroom) {
    const editor = document.getElementById("adminRangeEditor");
    if (!editor) return;

    editor.replaceChildren();

    if (!classroom) {
        const empty = document.createElement("div");
        empty.className = "admin-range-empty";

        const title = document.createElement("strong");
        title.textContent = "Select a classroom";

        const hint = document.createElement("span");
        hint.textContent =
            "Choose a classroom on the left to review or change its " +
            "attendance range.";

        empty.append(title, hint);
        editor.appendChild(empty);
        return;
    }

    const state = adminClassroomState(classroom);
    const busy = state.key === "busy";

    const heading = document.createElement("div");
    heading.className = "admin-range-editor-heading";

    const headingText = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = `${classroom.code}${classroom.building ? ` • ${classroom.building}` : ""}`;
    const subtitle = document.createElement("p");
    subtitle.textContent = busy
        ? "A session is running in this classroom. Its range is locked until the session ends."
        : "Changes require a reason and are recorded in the audit trail.";
    headingText.append(title, subtitle);

    const badge = document.createElement("span");
    badge.className = `admin-range-state ${state.key}`;
    badge.textContent = state.label;
    heading.append(headingText, badge);

    const fields = document.createElement("div");
    fields.className = "admin-range-fields";

    const latitude = buildAdminRangeInput({
        id: "adminRangeLatitude",
        value: classroom.latitude === null ? "" : adminFormatCoordinate(classroom.latitude),
        step: "0.000001",
        min: -90,
        max: 90
    });
    const longitude = buildAdminRangeInput({
        id: "adminRangeLongitude",
        value: classroom.longitude === null ? "" : adminFormatCoordinate(classroom.longitude),
        step: "0.000001",
        min: -180,
        max: 180
    });
    const radius = buildAdminRangeInput({
        id: "adminRangeRadius",
        value: String(Number(classroom.radius_meters)),
        step: "1",
        min: 1,
        max: 500
    });
    const accuracy = buildAdminRangeInput({
        id: "adminRangeAccuracy",
        value: String(Number(classroom.max_accuracy_meters)),
        step: "1",
        min: 1,
        max: 500
    });

    [latitude, longitude, radius, accuracy].forEach((input) => {
        input.disabled = busy;
    });

    fields.append(
        buildAdminRangeField("Latitude", latitude),
        buildAdminRangeField("Longitude", longitude),
        buildAdminRangeField("Attendance radius (metres)", radius),
        buildAdminRangeField("Accuracy limit (metres)", accuracy)
    );

    const useLocation = document.createElement("button");
    useLocation.type = "button";
    useLocation.className = "teacher-records-button";
    useLocation.id = "adminRangeUseLocationButton";
    useLocation.textContent = "Use my current location";
    useLocation.disabled = busy;
    useLocation.addEventListener("click", () => fillAdminRangeFromLocation(
        useLocation
    ));

    const summary = document.createElement("div");
    summary.className = "admin-range-summary";
    summary.id = "adminRangeSummary";

    const summaryTitle = document.createElement("strong");
    summaryTitle.textContent = classroom.coordinates_verified
        ? "Attendance verification is active"
        : "Attendance is blocked for this classroom";
    const summaryText = document.createElement("span");
    summaryText.textContent = classroom.coordinates_verified
        ? "Students inside the radius with a good enough reading can mark attendance."
        : "Save and verify the coordinates to allow attendance here.";
    summary.append(summaryTitle, summaryText);

    const hint = document.createElement("p");
    hint.className = "admin-range-hint";
    hint.textContent = classroom.range_updated_at
        ? `Last changed ${adminFormatDateTime(classroom.range_updated_at)}` +
            (classroom.range_updated_by_login_id
                ? ` by ${classroom.range_updated_by_login_id}`
                : "")
        : "This range has never been changed by an administrator.";

    const reason = document.createElement("textarea");
    reason.id = "adminRangeReason";
    reason.rows = 3;
    reason.minLength = 3;
    reason.maxLength = 300;
    reason.placeholder = "For example, measured the centre of CSE-201 with a phone";
    reason.disabled = busy;

    const reasonGroup = document.createElement("div");
    reasonGroup.className = "teacher-input-group";
    const reasonLabel = document.createElement("label");
    reasonLabel.setAttribute("for", "adminRangeReason");
    reasonLabel.textContent = "Reason (required)";
    reasonGroup.append(reasonLabel, reason);

    const actions = document.createElement("div");
    actions.className = "admin-range-actions";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "start-session-button";
    saveButton.id = "adminRangeSaveButton";
    saveButton.textContent = classroom.coordinates_verified
        ? "Save & Keep Verified"
        : "Save & Verify";
    saveButton.disabled = busy;
    saveButton.addEventListener("click", saveAdminClassroomRange);

    const revokeButton = document.createElement("button");
    revokeButton.type = "button";
    revokeButton.className = "teacher-records-button admin-danger-button";
    revokeButton.id = "adminRangeRevokeButton";
    revokeButton.textContent = "Revoke Verification";
    revokeButton.disabled = busy || !classroom.coordinates_verified;
    revokeButton.addEventListener(
        "click",
        () => changeAdminClassroomVerification("revoke")
    );

    actions.append(saveButton, revokeButton);

    const history = document.createElement("div");
    history.className = "admin-range-history";
    history.id = "adminRangeHistory";
    history.replaceChildren(
        (() => {
            const loading = document.createElement("p");
            loading.className = "sap-empty-state";
            loading.textContent = "Loading audit trail...";
            return loading;
        })()
    );

    editor.append(
        heading,
        fields,
        useLocation,
        summary,
        hint,
        reasonGroup,
        actions,
        history
    );

    if (busy) {
        editor.appendChild((() => {
            const note = document.createElement("p");
            note.className = "admin-range-hint sap-warning-text";
            note.textContent =
                `${classroom.active_sessions} attendance session(s) are ` +
                "using this classroom right now.";
            return note;
        })());
    }
}

function readAdminRangeForm() {
    const fields = [
        "adminRangeLatitude",
        "adminRangeLongitude",
        "adminRangeRadius",
        "adminRangeAccuracy"
    ].map((id) => document.getElementById(id));

    if (fields.some((field) => !field)) {
        throw new Error("The range form is not available.");
    }

    const [latitudeField, longitudeField, radiusField, accuracyField] = fields;
    const latitude = Number(latitudeField.value);
    const longitude = Number(longitudeField.value);
    const radiusMeters = Number(radiusField.value);
    const maxAccuracyMeters = Number(accuracyField.value);

    if (latitudeField.value.trim() === "" || !Number.isFinite(latitude)) {
        throw new Error("Enter a valid latitude.");
    }

    if (Math.abs(latitude) > 90) {
        throw new Error("Latitude must be between -90 and 90.");
    }

    if (longitudeField.value.trim() === "" || !Number.isFinite(longitude)) {
        throw new Error("Enter a valid longitude.");
    }

    if (Math.abs(longitude) > 180) {
        throw new Error("Longitude must be between -180 and 180.");
    }

    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0 || radiusMeters > 500) {
        throw new Error("The attendance radius must be between 1 and 500 metres.");
    }

    if (
        !Number.isFinite(maxAccuracyMeters) ||
        maxAccuracyMeters <= 0 ||
        maxAccuracyMeters > 500
    ) {
        throw new Error("The accuracy limit must be between 1 and 500 metres.");
    }

    const reason = document
        .getElementById("adminRangeReason")
        ?.value.trim() || "";

    if (reason.length < 3 || reason.length > 300) {
        throw new Error(
            "Enter an administrative reason between 3 and 300 characters."
        );
    }

    return {
        latitude,
        longitude,
        radiusMeters,
        maxAccuracyMeters,
        reason
    };
}

function formatAdminCoordinates(latitude, longitude) {
    return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function fillAdminRangeFromLocation(button) {
    if (!navigator.geolocation) {
        showSAPToast(
            "error",
            "Location Unavailable",
            "This browser does not support the Geolocation API."
        );
        return;
    }

    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Reading location...";

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const latitudeField = document.getElementById(
                "adminRangeLatitude"
            );
            const longitudeField = document.getElementById(
                "adminRangeLongitude"
            );

            if (latitudeField && longitudeField) {
                latitudeField.value = adminFormatCoordinate(
                    position.coords.latitude
                );
                longitudeField.value = adminFormatCoordinate(
                    position.coords.longitude
                );
            }

            const accuracyField = document.getElementById(
                "adminRangeAccuracy"
            );

            if (accuracyField) {
                const accuracy = Math.ceil(position.coords.accuracy);

                if (
                    accuracy >= 1 &&
                    accuracy <= 500 &&
                    Number(accuracyField.value) < accuracy
                ) {
                    accuracyField.value = String(accuracy);
                }
            }

            showSAPToast(
                "success",
                "Location Captured",
                `Current position: ${formatAdminCoordinates(
                    position.coords.latitude,
                    position.coords.longitude
                )} (±${Math.round(position.coords.accuracy)} m). ` +
                "Save with a reason to apply it."
            );

            button.disabled = false;
            button.textContent = original;
        },
        (error) => {
            const messages = {
                1: "Location permission was denied. Allow it in the browser to use this shortcut.",
                2: "Your location could not be determined. Try again near a window.",
                3: "Reading your location timed out. Try again."
            };

            showSAPToast(
                "error",
                "Location Unavailable",
                messages[error.code] || "Your location could not be read."
            );

            button.disabled = false;
            button.textContent = original;
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        }
    );
}

async function loadAdminRanges() {
    const list = document.getElementById("adminRangeList");

    try {
        const data = await sapApi("/admin/attendance-ranges");
        adminClassrooms = data.classrooms || [];
        renderAdminRangeStats(data.stats, data.checks);
        renderAdminRangeList(adminClassrooms);

        if (adminSelectedClassroomId) {
            const selected = adminClassrooms.find(
                (classroom) =>
                    Number(classroom.classroom_id) ===
                    adminSelectedClassroomId
            );

            renderAdminRangeEditor(selected || null);

            if (selected) {
                await loadAdminRangeHistory(selected.classroom_id);
            }
        }
    } catch (error) {
        if (list) {
            const message = document.createElement("p");
            message.className = "sap-empty-state sap-warning-text";
            message.textContent = sapNetworkMessage(error);
            list.replaceChildren(message);
        }
    }
}

function renderAdminRangeHistory(actions) {
    const history = document.getElementById("adminRangeHistory");
    if (!history) return;

    history.replaceChildren();

    const heading = document.createElement("h4");
    heading.textContent = "Recent range changes";
    history.appendChild(heading);

    if (!actions.length) {
        const empty = document.createElement("p");
        empty.className = "sap-empty-state";
        empty.textContent = "No range changes have been recorded yet.";
        history.appendChild(empty);
        return;
    }

    actions.forEach((entry) => {
        const item = document.createElement("article");
        item.className = "admin-range-history-item";

        const action = document.createElement("strong");
        action.textContent = adminActionLabel(entry.action);

        const actor = document.createElement("span");
        actor.textContent = `Actor: ${entry.admin_login_id}`;

        const timestamp = document.createElement("small");
        timestamp.textContent = adminFormatDateTime(entry.created_at);

        item.append(action, actor, timestamp);

        if (entry.reason) {
            const reason = document.createElement("span");
            reason.textContent = `Reason: ${entry.reason}`;
            item.appendChild(reason);
        }

        if (entry.new_values) {
            const next = entry.new_values;
            const values = document.createElement("small");
            values.textContent =
                `Centre ${adminFormatCoordinate(next.latitude)}, ` +
                `${adminFormatCoordinate(next.longitude)} • ` +
                `${next.radiusMeters} m radius • ` +
                `${next.maxAccuracyMeters} m accuracy • ` +
                (next.coordinatesVerified ? "verified" : "not verified");
            item.appendChild(values);
        }

        history.appendChild(item);
    });
}

async function loadAdminRangeHistory(classroomId) {
    try {
        const data = await sapApi(
            `/admin/classrooms/${encodeURIComponent(classroomId)}/range-history`
        );
        renderAdminRangeHistory(data.actions || []);
    } catch (error) {
        renderAdminRangeHistory([]);
    }
}

async function selectAdminClassroom(classroomId) {
    const id = Number(classroomId);
    if (!Number.isInteger(id) || id <= 0) return;

    adminSelectedClassroomId = id;

    document.querySelectorAll(".admin-range-item").forEach((button) => {
        button.classList.toggle(
            "selected",
            Number(button.dataset.classroomId) === id
        );
    });

    const classroom = adminClassrooms.find(
        (item) => Number(item.classroom_id) === id
    );

    if (!classroom) return;

    renderAdminRangeEditor(classroom);
    await loadAdminRangeHistory(id);
}

async function saveAdminClassroomRange() {
    if (!adminSelectedClassroomId || adminRangeInProgress) return;

    let form;

    try {
        form = readAdminRangeForm();
    } catch (error) {
        showSAPToast("error", "Check the Range", error.message);
        return;
    }

    const classroom = adminClassrooms.find(
        (item) => Number(item.classroom_id) === adminSelectedClassroomId
    );
    const verifying = !classroom?.coordinates_verified;

    if (
        !window.confirm(
            `Save ${formatAdminCoordinates(form.latitude, form.longitude)} ` +
            `with a ${form.radiusMeters} m radius` +
            (verifying
                ? " and allow attendance in this classroom?"
                : "?")
        )
    ) {
        return;
    }

    adminRangeInProgress = true;
    setAdminRangeControlsDisabled(true);

    try {
        const data = await sapApi(
            `/admin/classrooms/${encodeURIComponent(adminSelectedClassroomId)}/range`,
            {
                method: "PUT",
                body: {
                    latitude: form.latitude,
                    longitude: form.longitude,
                    radiusMeters: Number(form.radiusMeters),
                    maxAccuracyMeters: Number(form.maxAccuracyMeters),
                    coordinatesVerified: true,
                    reason: form.reason
                }
            }
        );

        showSAPToast(
            "success",
            "Attendance Range Saved",
            data.message || "The classroom range was updated."
        );

        await Promise.all([loadAdminRanges(), loadAdminOverview()]);
    } catch (error) {
        showSAPToast(
            "error",
            "Range Update Failed",
            sapNetworkMessage(error)
        );
    } finally {
        adminRangeInProgress = false;

        if (adminSelectedClassroomId) {
            setAdminRangeControlsDisabled(false);
        }
    }
}

async function changeAdminClassroomVerification(action) {
    if (!adminSelectedClassroomId || adminRangeInProgress) return;

    const reason = document
        .getElementById("adminRangeReason")
        ?.value.trim() || "";

    if (reason.length < 3 || reason.length > 300) {
        showSAPToast(
            "error",
            "Reason Required",
            "Enter an administrative reason between 3 and 300 characters."
        );
        return;
    }

    if (
        action === "revoke" &&
        !window.confirm(
            "Revoke verification? Attendance will be blocked for this " +
            "classroom until an administrator verifies the coordinates again."
        )
    ) {
        return;
    }

    adminRangeInProgress = true;
    setAdminRangeControlsDisabled(true);

    try {
        const data = await sapApi(
            `/admin/classrooms/${encodeURIComponent(adminSelectedClassroomId)}/verification`,
            {
                method: "POST",
                body: { action, reason }
            }
        );

        showSAPToast(
            "success",
            action === "revoke"
                ? "Verification Revoked"
                : "Coordinates Verified",
            data.message || "The classroom verification state changed."
        );

        await Promise.all([loadAdminRanges(), loadAdminOverview()]);
    } catch (error) {
        showSAPToast(
            "error",
            "Verification Change Failed",
            sapNetworkMessage(error)
        );
    } finally {
        adminRangeInProgress = false;
        setAdminRangeControlsDisabled(false);

        if (adminSelectedClassroomId) {
            await loadAdminRanges();
        }
    }
}

function setAdminRangeControlsDisabled(disabled) {
    [
        "adminRangeLatitude",
        "adminRangeLongitude",
        "adminRangeRadius",
        "adminRangeAccuracy",
        "adminRangeReason",
        "adminRangeSaveButton",
        "adminRangeRevokeButton",
        "adminRangeUseLocationButton"
    ].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.disabled = disabled;
    });
}
