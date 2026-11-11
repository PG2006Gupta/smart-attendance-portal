import { calculateDistanceMeters } from "./verification.js";

// =====================================================
// ATTENDANCE RANGE PRESENTATION AND DECISION HELPERS
// =====================================================
// The marking route in server/routes/student.js uses these helpers so the
// acceptance rule can be unit tested without a database.

export function formatDistanceMeters(value) {
    // Number(null) and Number("") are 0, which would display as a real
    // measurement. An absent distance must stay absent.
    if (value === null || value === undefined || value === "") return null;

    const distance = Number(value);

    if (!Number.isFinite(distance)) return null;

    return Number(distance.toFixed(1));
}

export function describeRange(classroom) {
    const radius = Math.max(
        1,
        Math.round(Number(classroom.radius_meters || 0))
    );
    const accuracy = Math.round(
        Number(classroom.max_accuracy_meters || 0)
    );

    return `Students must be within ${radius} metres of the classroom ` +
        `centre, with a location accuracy of ${accuracy} metres or better.`;
}

export function isClassroomRangeReady(classroom) {
    return Boolean(
        classroom &&
        classroom.coordinates_verified === true &&
        classroom.latitude !== null &&
        classroom.latitude !== undefined &&
        classroom.longitude !== null &&
        classroom.longitude !== undefined
    );
}

// Returns the distance a student's reading sits from the classroom centre,
// or null when the classroom has no usable coordinates.
export function measureClassroomDistance(classroom, location) {
    if (!isClassroomRangeReady(classroom)) return null;

    return calculateDistanceMeters(
        location.latitude,
        location.longitude,
        Number(classroom.latitude),
        Number(classroom.longitude)
    );
}

// Decides whether a location reading is inside the classroom range.
// Order matters: accuracy is checked before distance so a vague reading is
// never treated as a confident one.
export function evaluateAttendanceRange({
    classroom,
    location,
    distanceMeters = null
}) {
    if (!isClassroomRangeReady(classroom)) {
        return {
            accepted: false,
            code: "classroom_not_configured",
            message:
                "This classroom does not have verified coordinates yet. " +
                "Ask your administrator to configure it."
        };
    }

    const maximumAccuracy = Number(classroom.max_accuracy_meters);
    const accuracy = Number(location.accuracy);

    if (!Number.isFinite(accuracy)) {
        return {
            accepted: false,
            code: "location_accuracy_too_low",
            message:
                "Your browser did not report a location accuracy. Refresh " +
                "your location and try again."
        };
    }

    if (accuracy > maximumAccuracy) {
        return {
            accepted: false,
            code: "location_accuracy_too_low",
            message:
                `Your location accuracy is about ${Math.round(accuracy)} ` +
                `metres; this classroom requires ${maximumAccuracy} metres ` +
                "or better."
        };
    }

    const distance = distanceMeters === null
        ? measureClassroomDistance(classroom, location)
        : Number(distanceMeters);

    const radiusMeters = Number(classroom.radius_meters);

    if (!Number.isFinite(distance)) {
        return {
            accepted: false,
            code: "location_unavailable",
            message:
                "The classroom location could not be compared with your " +
                "reading. Try again."
        };
    }

    if (distance > radiusMeters) {
        return {
            accepted: false,
            code: "outside_classroom",
            message:
                `You appear to be about ${Math.round(distance)} metres from ` +
                `the classroom, outside its ${radiusMeters}-metre attendance ` +
                "range.",
            distanceMeters: distance,
            radiusMeters
        };
    }

    return {
        accepted: true,
        distanceMeters: distance,
        radiusMeters
    };
}
