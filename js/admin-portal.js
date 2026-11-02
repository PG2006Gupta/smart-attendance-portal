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
        await loadAdminOverview();
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
