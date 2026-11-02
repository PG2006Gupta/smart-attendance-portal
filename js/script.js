// =====================================================
// SAP SHARED FRONTEND HELPERS, AUTH, AND CLASS SELECTION
// =====================================================

const SAP_API_BASE_URL =
    window.SAP_API_BASE_URL_OVERRIDE ||
    (window.location.protocol === "file:"
        ? "http://localhost:5000/api"
        : ["5500", "5501"].includes(window.location.port)
            ? `${window.location.protocol}//${window.location.hostname}:5000/api`
            : `${window.location.origin}/api`);

async function sapApi(path, options = {}) {
    const request = {
        method: options.method || "GET",
        credentials: "include",
        headers: {
            ...(options.body
                ? { "Content-Type": "application/json" }
                : {}),
            ...(options.headers || {})
        }
    };

    if (options.body !== undefined) {
        request.body = JSON.stringify(options.body);
    }

    const response = await fetch(
        `${SAP_API_BASE_URL}${path}`,
        request
    );

    const data = await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
        const error = new Error(
            data.error || `Request failed (${response.status}).`
        );

        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

function sapSetText(elementId, value) {
    const element = document.getElementById(elementId);

    if (element) {
        element.textContent = value ?? "—";
    }
}

function sapFormatDate(value) {
    if (!value) return "—";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    }).format(date);
}

function sapFormatTime(value) {
    if (!value) return "—";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return new Intl.DateTimeFormat("en-IN", {
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function sapInitials(name) {
    return String(name || "U")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
}

function sapNetworkMessage(error) {
    return error instanceof TypeError
        ? "Cannot connect to the SAP server. Make sure the backend is running."
        : error.message;
}

// =====================================================
// SHARED PROFILE DROPDOWNS
// =====================================================

function closeSAPProfileDropdowns() {
    document.querySelectorAll(".profile-dropdown").forEach((dropdown) => {
        const toggle = dropdown.querySelector(
            ".profile-dropdown-toggle"
        );
        const menu = dropdown.querySelector(".profile-dropdown-menu");

        if (menu) menu.hidden = true;
        if (toggle) toggle.setAttribute("aria-expanded", "false");
    });
}

function toggleSAPProfileDropdown(event) {
    event.preventDefault();
    event.stopPropagation();

    const toggle = event.currentTarget;
    const dropdown = toggle.closest(".profile-dropdown");
    const menu = dropdown?.querySelector(".profile-dropdown-menu");

    if (!dropdown || !menu) return;

    const shouldOpen = menu.hidden;
    closeSAPProfileDropdowns();

    if (shouldOpen) {
        menu.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
    }
}

document.addEventListener("click", (event) => {
    if (!event.target.closest(".profile-dropdown")) {
        closeSAPProfileDropdowns();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    const openToggle = document.querySelector(
        '.profile-dropdown-toggle[aria-expanded="true"]'
    );
    closeSAPProfileDropdowns();
    openToggle?.focus();
});

// =====================================================
// SAFE TOAST NOTIFICATIONS
// =====================================================

function showSAPToast(type, title, message) {
    let container = document.querySelector(".sap-toast-container");

    if (!container) {
        container = document.createElement("div");
        container.className = "sap-toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `sap-toast ${type}`;

    const icon = document.createElement("div");
    icon.className = "sap-toast-icon";
    icon.textContent = type === "success" ? "✓" : "✕";

    const content = document.createElement("div");
    content.className = "sap-toast-content";

    const heading = document.createElement("span");
    heading.className = "sap-toast-title";
    heading.textContent = title;

    const body = document.createElement("div");
    body.className = "sap-toast-message";
    body.textContent = message;

    const close = document.createElement("button");
    close.className = "sap-toast-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close notification");
    close.textContent = "×";

    const progress = document.createElement("div");
    progress.className = "sap-toast-progress";

    content.append(heading, body);
    toast.append(icon, content, close, progress);
    container.appendChild(toast);

    function remove() {
        if (!toast.isConnected) return;
        toast.classList.add("sap-toast-out");
        setTimeout(() => toast.remove(), 350);
    }

    close.addEventListener("click", remove);
    setTimeout(remove, 4500);
}

// =====================================================
// LOGIN AND SESSION HELPERS
// =====================================================

const sapLoginInProgress = {
    student: false,
    teacher: false,
    admin: false
};

const SAP_PORTALS = {
    student: {
        label: "Student",
        idField: "studentId",
        passwordField: "password",
        dashboard: "student-dashboard.html",
        login: "student-login.html"
    },
    teacher: {
        label: "Teacher",
        idField: "teacherId",
        passwordField: "teacherPassword",
        dashboard: "teacher-dashboard.html",
        login: "teacher-login.html"
    },
    admin: {
        label: "Administrator",
        idField: "adminId",
        passwordField: "adminPassword",
        dashboard: "admin-dashboard.html",
        login: "admin-login.html"
    }
};

async function loginWithPassword(role) {
    const portal = SAP_PORTALS[role];
    if (!portal) return;

    const idElement = document.getElementById(portal.idField);
    const passwordElement = document.getElementById(
        portal.passwordField
    );

    if (!idElement || !passwordElement) return;

    const loginId = idElement.value.trim();
    const password = passwordElement.value;

    if (!loginId || !password) {
        showSAPToast(
            "error",
            "Login Failed",
            `Please enter your ${portal.label} ID and Password.`
        );
        return;
    }

    if (sapLoginInProgress[role]) return;
    sapLoginInProgress[role] = true;

    try {
        const data = await sapApi("/auth/login", {
            method: "POST",
            body: { loginId, password }
        });

        if (data.user?.role !== role) {
            await sapApi("/auth/logout", { method: "POST" });
            throw new Error(
                `This account is not authorized for the ${portal.label} Portal.`
            );
        }

        passwordElement.value = "";
        showSAPToast(
            "success",
            "Login Successful",
            `Welcome to the ${portal.label} Portal.`
        );

        setTimeout(() => {
            window.location.href = portal.dashboard;
        }, 500);
    } catch (error) {
        showSAPToast(
            "error",
            "Login Failed",
            sapNetworkMessage(error)
        );
        sapLoginInProgress[role] = false;
    }
}

function teacherLogin() {
    return loginWithPassword("teacher");
}

function studentLogin() {
    return loginWithPassword("student");
}

function adminLogin() {
    return loginWithPassword("admin");
}

function togglePasswordField(inputId) {
    const password = document.getElementById(inputId);
    if (!password) return;

    const button = password.parentElement.querySelector(
        ".password-toggle"
    );
    const show = password.type === "password";
    password.type = show ? "text" : "password";

    if (button) {
        button.textContent = show ? "🙈" : "👁";
        button.setAttribute(
            "aria-label",
            show ? "Hide password" : "Show password"
        );
    }
}

function toggleTeacherPassword() {
    togglePasswordField("teacherPassword");
}

function toggleAdminPassword() {
    togglePasswordField("adminPassword");
}

function togglePassword() {
    togglePasswordField("password");
}

function teacherBiometricLogin() {
    if (typeof startSAPPasskeyLogin === "function") {
        return startSAPPasskeyLogin("teacher");
    }

    showSAPToast(
        "error",
        "Passkey Unavailable",
        "The passkey module could not be loaded."
    );
}

function biometricLogin() {
    if (typeof startSAPPasskeyLogin === "function") {
        return startSAPPasskeyLogin("student");
    }

    showSAPToast(
        "error",
        "Passkey Unavailable",
        "The passkey module could not be loaded."
    );
}

function forgotStudentPassword(event) {
    event?.preventDefault();
    showSAPToast(
        "success",
        "Password Help",
        "Password resets are managed by your institution. Please contact your administrator."
    );
}

async function requireRoleSession(role) {
    try {
        const data = await sapApi("/auth/me");

        if (!data.authenticated || data.user?.role !== role) {
            throw new Error("Invalid portal session.");
        }

        return data.user;
    } catch {
        window.location.replace(
            SAP_PORTALS[role]?.login || "index.html"
        );
        return null;
    }
}

function requireTeacherSession() {
    return requireRoleSession("teacher");
}

function requireStudentSession() {
    return requireRoleSession("student");
}

function requireAdminSession() {
    return requireRoleSession("admin");
}

const sapLogoutInProgress = {
    student: false,
    teacher: false,
    admin: false
};

async function logoutFromPortal(role, event) {
    event?.preventDefault();

    if (!SAP_PORTALS[role] || sapLogoutInProgress[role]) return;
    sapLogoutInProgress[role] = true;

    try {
        await sapApi("/auth/logout", { method: "POST" });
        window.location.replace("index.html");
    } catch (error) {
        showSAPToast(
            "error",
            "Logout Failed",
            sapNetworkMessage(error)
        );
        sapLogoutInProgress[role] = false;
    }
}

function teacherLogout(event) {
    return logoutFromPortal("teacher", event);
}

function studentLogout(event) {
    return logoutFromPortal("student", event);
}

function adminLogout(event) {
    return logoutFromPortal("admin", event);
}

// =====================================================
// TEACHER CLASS AND CLASSROOM SELECTION
// =====================================================

let selectedTeacherOfferingId = null;
let selectedTeacherClassroomId = null;
let teacherClassrooms = [];
let startAttendanceSessionInProgress = false;

function selectTeacherClass(
    offeringId,
    subject,
    section,
    expectedStudents
) {
    selectedTeacherOfferingId = Number(offeringId);
    sapSetText("selectedSubject", subject);
    sapSetText("selectedSection", `Section ${section}`);
    sapSetText(
        "selectedExpectedStudents",
        expectedStudents ?? 0
    );

    // Deliberately does not select a classroom automatically.
}

function updateRoomDetails() {
    const select = document.getElementById("classroomSelect");
    const selectedId = Number(select?.value);
    const classroom = teacherClassrooms.find(
        (item) => Number(item.classroom_id) === selectedId
    );

    selectedTeacherClassroomId = classroom
        ? Number(classroom.classroom_id)
        : null;

    sapSetText(
        "roomRadius",
        classroom ? `${classroom.radius_meters} meters` : "—"
    );

    sapSetText(
        "roomLocationStatus",
        classroom
            ? classroom.coordinates_verified
                ? "Coordinates verified"
                : "Coordinates not configured"
            : "—"
    );
}

function renderTeacherClasses(classes) {
    const list = document.getElementById("teacherClassList");
    if (!list) return;

    list.replaceChildren();

    if (classes.length === 0) {
        const message = document.createElement("p");
        message.textContent = "No active classes are assigned to you.";
        list.appendChild(message);
        return;
    }

    classes.forEach((classItem) => {
        const row = document.createElement("div");
        row.className = "class-row";

        const code = document.createElement("div");
        code.className = "class-time";
        code.textContent = classItem.subject_code;

        const details = document.createElement("div");
        details.className = "class-details";

        const name = document.createElement("strong");
        name.textContent = classItem.subject_name;

        const section = document.createElement("span");
        section.textContent =
            `Section ${classItem.section_name} • Semester ${classItem.semester} • ${classItem.expected_students} enrolled`;

        details.append(name, section);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "class-select-button";
        button.textContent = "Select";
        button.addEventListener("click", () => {
            selectTeacherClass(
                classItem.offering_id,
                classItem.subject_name,
                classItem.section_name,
                classItem.expected_students
            );
        });

        row.append(code, details, button);
        list.appendChild(row);
    });
}

async function loadTeacherClasses() {
    try {
        const data = await sapApi("/teacher/classes");
        renderTeacherClasses(data.classes || []);
        return data.classes || [];
    } catch (error) {
        sapSetText("teacherClassList", "Unable to load classes.");
        showSAPToast(
            "error",
            "Class Loading Failed",
            sapNetworkMessage(error)
        );
        return [];
    }
}

async function loadTeacherClassrooms() {
    const select = document.getElementById("classroomSelect");
    if (!select) return;

    select.disabled = true;

    try {
        const data = await sapApi("/teacher/classrooms");
        teacherClassrooms = data.classrooms || [];
        select.replaceChildren();

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = teacherClassrooms.length
            ? "Select classroom"
            : "No classrooms available";
        select.appendChild(placeholder);

        teacherClassrooms.forEach((classroom) => {
            const option = document.createElement("option");
            option.value = classroom.classroom_id;
            option.textContent = classroom.code;
            select.appendChild(option);
        });

        select.disabled = teacherClassrooms.length === 0;
        updateRoomDetails();
    } catch (error) {
        teacherClassrooms = [];
        selectedTeacherClassroomId = null;
        select.replaceChildren();

        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Unable to load classrooms";
        select.appendChild(option);

        showSAPToast(
            "error",
            "Classroom Loading Failed",
            sapNetworkMessage(error)
        );
    }
}

async function startAttendanceSession() {
    if (startAttendanceSessionInProgress) return;

    if (!selectedTeacherOfferingId) {
        showSAPToast(
            "error",
            "No Subject Selected",
            "Please select a subject before starting the session."
        );
        return;
    }

    if (!selectedTeacherClassroomId) {
        showSAPToast(
            "error",
            "No Classroom Selected",
            "Please manually select a classroom before starting the session."
        );
        return;
    }

    startAttendanceSessionInProgress = true;

    try {
        const data = await sapApi("/teacher/sessions", {
            method: "POST",
            body: {
                offeringId: selectedTeacherOfferingId,
                classroomId: selectedTeacherClassroomId
            }
        });

        window.location.href =
            `teacher-attendance.html?sessionId=${encodeURIComponent(data.session.id)}`;
    } catch (error) {
        if (error.status === 401) {
            window.location.replace("teacher-login.html");
            return;
        }

        if (error.status === 409 && error.data?.sessionId) {
            window.location.href =
                `teacher-attendance.html?sessionId=${encodeURIComponent(error.data.sessionId)}`;
            return;
        }

        startAttendanceSessionInProgress = false;
        showSAPToast(
            "error",
            "Session Start Failed",
            sapNetworkMessage(error)
        );
    }
}

// Enter-key support on both login pages.
document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.repeat) return;

    const activeId = document.activeElement?.id;

    if (["teacherId", "teacherPassword"].includes(activeId)) {
        event.preventDefault();
        teacherLogin();
    } else if (["studentId", "password"].includes(activeId)) {
        event.preventDefault();
        studentLogin();
    }
});
