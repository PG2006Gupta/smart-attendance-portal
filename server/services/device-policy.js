export const MAX_STUDENT_DEVICES = 2;

function timestamp(value) {
    if (value === null || value === undefined) return Number.NaN;
    return new Date(value).getTime();
}

export function isDeviceRegistrationWindowOpen(
    registration,
    now = new Date()
) {
    if (
        !registration ||
        registration.device_registration_locked_at !== null
    ) {
        return false;
    }

    const opensAt = timestamp(
        registration.device_registration_opens_at
    );
    const expiresAt = timestamp(
        registration.device_registration_expires_at
    );
    const currentTime = timestamp(now);

    return (
        Number.isFinite(opensAt) &&
        Number.isFinite(expiresAt) &&
        Number.isFinite(currentTime) &&
        opensAt <= currentTime &&
        expiresAt > currentTime
    );
}

export function canRegisterStudentDevice(
    registration,
    currentDeviceCount,
    now = new Date()
) {
    return (
        Number.isInteger(currentDeviceCount) &&
        currentDeviceCount >= 0 &&
        currentDeviceCount < MAX_STUDENT_DEVICES &&
        isDeviceRegistrationWindowOpen(registration, now)
    );
}

export function shouldLockRegistrationAfterDevice(
    resultingDeviceCount
) {
    return resultingDeviceCount >= MAX_STUDENT_DEVICES;
}
