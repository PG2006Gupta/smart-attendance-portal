import test from "node:test";
import assert from "node:assert/strict";
import {
    describeRange,
    evaluateAttendanceRange,
    formatDistanceMeters,
    isClassroomRangeReady,
    measureClassroomDistance
} from "../server/services/attendance-range.js";
import { calculateDistanceMeters } from "../server/services/verification.js";

// A classroom near the SAP campus. The exact coordinates do not matter,
// only that the distance helpers agree with each other.
const classroom = {
    latitude: 30.7046,
    longitude: 76.7179,
    radius_meters: 25,
    max_accuracy_meters: 40,
    coordinates_verified: true
};

const insideReading = {
    latitude: 30.70465,
    longitude: 76.71795,
    accuracy: 12
};

test("A verified classroom with coordinates is ready", () => {
    assert.equal(isClassroomRangeReady(classroom), true);
});

test("An unverified classroom is not ready", () => {
    assert.equal(
        isClassroomRangeReady({ ...classroom, coordinates_verified: false }),
        false
    );
});

test("Missing coordinates never count as ready", () => {
    assert.equal(
        isClassroomRangeReady({ ...classroom, latitude: null }),
        false
    );
    assert.equal(
        isClassroomRangeReady({ ...classroom, longitude: null }),
        false
    );
    assert.equal(isClassroomRangeReady(null), false);
});

test("The measured distance matches the Haversine helper", () => {
    const measured = measureClassroomDistance(classroom, insideReading);
    const expected = calculateDistanceMeters(
        insideReading.latitude,
        insideReading.longitude,
        classroom.latitude,
        classroom.longitude
    );

    assert.equal(measured, expected);
    assert.ok(measured < 25);
});

test("Distance is null when the classroom has no coordinates", () => {
    assert.equal(
        measureClassroomDistance(
            { ...classroom, latitude: null, longitude: null },
            insideReading
        ),
        null
    );
});

test("A reading inside the radius with good accuracy is accepted", () => {
    const decision = evaluateAttendanceRange({
        classroom,
        location: insideReading
    });

    assert.equal(decision.accepted, true);
    assert.equal(decision.radiusMeters, 25);
    assert.ok(decision.distanceMeters < 25);
});

test("A reading just outside the radius is rejected", () => {
    // Roughly 110 metres north of the classroom centre.
    const decision = evaluateAttendanceRange({
        classroom,
        location: {
            latitude: 30.7056,
            longitude: 76.7179,
            accuracy: 12
        }
    });

    assert.equal(decision.accepted, false);
    assert.equal(decision.code, "outside_classroom");
    assert.ok(decision.distanceMeters > 25);
});

test("An inaccurate reading is rejected before the distance is judged", () => {
    const decision = evaluateAttendanceRange({
        classroom,
        location: { ...insideReading, accuracy: 120 }
    });

    assert.equal(decision.accepted, false);
    assert.equal(decision.code, "location_accuracy_too_low");
    assert.match(decision.message, /120/);
});

test("A missing accuracy value is rejected", () => {
    const decision = evaluateAttendanceRange({
        classroom,
        location: { ...insideReading, accuracy: undefined }
    });

    assert.equal(decision.accepted, false);
    assert.equal(decision.code, "location_accuracy_too_low");
});

test("An unverified classroom is rejected even when nearby", () => {
    const decision = evaluateAttendanceRange({
        classroom: { ...classroom, coordinates_verified: false },
        location: insideReading
    });

    assert.equal(decision.accepted, false);
    assert.equal(decision.code, "classroom_not_configured");
});

test("The radius boundary is inclusive", () => {
    const distance = calculateDistanceMeters(
        classroom.latitude + 0.000224,
        classroom.longitude,
        classroom.latitude,
        classroom.longitude
    );

    const decision = evaluateAttendanceRange({
        classroom: { ...classroom, radius_meters: distance },
        location: {
            latitude: classroom.latitude + 0.000224,
            longitude: classroom.longitude,
            accuracy: 10
        }
    });

    assert.equal(decision.accepted, true);
});

test("The readable range summary names the radius and accuracy limit", () => {
    const summary = describeRange(classroom);

    assert.match(summary, /25 metres/);
    assert.match(summary, /40 metres/);
});

test("Distances are rounded to one decimal place for display", () => {
    assert.equal(formatDistanceMeters(12.3456), 12.3);
    assert.equal(formatDistanceMeters(null), null);
    assert.equal(formatDistanceMeters("not a number"), null);
});
