import test from "node:test";
import assert from "node:assert/strict";
import {
    MAX_STUDENT_DEVICES,
    canRegisterStudentDevice,
    isDeviceRegistrationWindowOpen,
    shouldLockRegistrationAfterDevice
} from "../server/services/device-policy.js";

const now = new Date("2026-11-02T10:00:00.000Z");

function openWindow() {
    return {
        device_registration_locked_at: null,
        device_registration_opens_at: new Date(
            "2026-11-02T09:59:00.000Z"
        ),
        device_registration_expires_at: new Date(
            "2026-11-02T10:15:00.000Z"
        )
    };
}

test("Device registration is denied when administration has locked it", () => {
    const registration = {
        ...openWindow(),
        device_registration_locked_at: new Date(
            "2026-11-02T09:58:00.000Z"
        )
    };

    assert.equal(
        isDeviceRegistrationWindowOpen(registration, now),
        false
    );
    assert.equal(canRegisterStudentDevice(registration, 0, now), false);
});

test("Registration window honors opening and expiry boundaries", () => {
    const registration = openWindow();

    assert.equal(
        isDeviceRegistrationWindowOpen(
            registration,
            new Date("2026-11-02T09:58:59.999Z")
        ),
        false
    );
    assert.equal(
        isDeviceRegistrationWindowOpen(
            registration,
            new Date("2026-11-02T09:59:00.000Z")
        ),
        true
    );
    assert.equal(isDeviceRegistrationWindowOpen(registration, now), true);
    assert.equal(
        isDeviceRegistrationWindowOpen(
            registration,
            new Date("2026-11-02T10:15:00.000Z")
        ),
        false
    );
});

test("Missing or invalid window data fails closed", () => {
    assert.equal(isDeviceRegistrationWindowOpen(null, now), false);
    assert.equal(
        isDeviceRegistrationWindowOpen(
            {
                device_registration_locked_at: null,
                device_registration_opens_at: null,
                device_registration_expires_at: null
            },
            now
        ),
        false
    );
    assert.equal(
        isDeviceRegistrationWindowOpen(openWindow(), new Date("invalid")),
        false
    );
});

test("Only the first two devices can register during an open window", () => {
    assert.equal(MAX_STUDENT_DEVICES, 2);
    assert.equal(canRegisterStudentDevice(openWindow(), 0, now), true);
    assert.equal(canRegisterStudentDevice(openWindow(), 1, now), true);
    assert.equal(canRegisterStudentDevice(openWindow(), 2, now), false);
    assert.equal(canRegisterStudentDevice(openWindow(), -1, now), false);
});

test("The second successful device triggers automatic locking", () => {
    assert.equal(shouldLockRegistrationAfterDevice(1), false);
    assert.equal(shouldLockRegistrationAfterDevice(2), true);
    assert.equal(shouldLockRegistrationAfterDevice(3), true);
});
