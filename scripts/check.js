import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
);
const errors = [];
let javascriptFiles = 0;
let htmlFiles = 0;

function walk(directory) {
    if (!fs.existsSync(directory)) return [];

    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(
        (entry) => {
            const fullPath = path.join(directory, entry.name);

            if (entry.isDirectory()) return walk(fullPath);
            return [fullPath];
        }
    );
}

for (const directory of ["server", "js", "database", "scripts", "tests"]) {
    for (const file of walk(path.join(root, directory))) {
        if (!file.endsWith(".js")) continue;

        javascriptFiles += 1;
        const result = spawnSync(
            process.execPath,
            ["--check", file],
            { encoding: "utf8" }
        );

        if (result.status !== 0) {
            errors.push(`${path.relative(root, file)}\n${result.stderr}`);
        }
    }
}

for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".html")) continue;

    htmlFiles += 1;
    const content = fs.readFileSync(path.join(root, name), "utf8");

    if (content.includes("<<script")) {
        errors.push(`${name}: malformed <<script tag`);
    }

    const ids = [...content.matchAll(/\bid="([^"]+)"/g)]
        .map((match) => match[1]);
    const duplicates = ids.filter(
        (id, index) => ids.indexOf(id) !== index
    );

    if (duplicates.length) {
        errors.push(
            `${name}: duplicate IDs: ${[...new Set(duplicates)].join(", ")}`
        );
    }

    for (const match of content.matchAll(
        /(?:src|href)="([^"]+)"/g
    )) {
        const reference = match[1];

        if (
            !reference ||
            reference.startsWith("#") ||
            /^[a-z]+:/i.test(reference) ||
            reference.startsWith("//")
        ) {
            continue;
        }

        const clean = reference.split(/[?#]/)[0];
        const target = path.resolve(root, clean);

        if (!target.startsWith(`${root}${path.sep}`)) {
            errors.push(`${name}: unsafe local reference ${reference}`);
        } else if (!fs.existsSync(target)) {
            errors.push(`${name}: missing local file ${reference}`);
        }
    }
}

const authenticatedPages = {
    "student-dashboard.html": ["student-profile.html", "studentLogout"],
    "student-profile.html": ["student-profile.html", "studentLogout"],
    "student-attendance.html": ["student-profile.html", "studentLogout"],
    "student-attendance-history.html": ["student-profile.html", "studentLogout"],
    "teacher-dashboard.html": ["teacher-profile.html", "teacherLogout"],
    "teacher-profile.html": ["teacher-profile.html", "teacherLogout"],
    "teacher-attendance.html": ["teacher-profile.html", "teacherLogout"],
    "teacher-attendance-records.html": ["teacher-profile.html", "teacherLogout"],
    "teacher-attendance-session.html": ["teacher-profile.html", "teacherLogout"],
    "admin-dashboard.html": ["admin-profile.html", "adminLogout"],
    "admin-profile.html": ["admin-profile.html", "adminLogout"]
};

for (const [name, [profilePage, logoutFunction]] of Object.entries(
    authenticatedPages
)) {
    const content = fs.readFileSync(path.join(root, name), "utf8");

    for (const required of [
        "profile-dropdown-toggle",
        "profile-dropdown-menu",
        `href=\"${profilePage}\"`,
        `${logoutFunction}(event)`
    ]) {
        if (!content.includes(required)) {
            errors.push(`${name}: missing profile-dropdown requirement ${required}`);
        }
    }

    if (/<footer[\s\S]*?Logout[\s\S]*?<\/footer>/i.test(content)) {
        errors.push(`${name}: footer logout must be inside the profile dropdown instead`);
    }
}

if (errors.length) {
    console.error(errors.join("\n\n"));
    process.exit(1);
}

console.log(
    `SAP checks passed: ${javascriptFiles} JavaScript files and ${htmlFiles} HTML files.`
);
