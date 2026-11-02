const defaultOrigins = [
    "http://localhost:5500",
    "http://localhost:5000"
];

export const webAuthnConfig = {
    rpName: process.env.WEBAUTHN_RP_NAME || "Smart Attendance Portal",
    rpID: process.env.WEBAUTHN_RP_ID || "localhost",
    origins: (
        process.env.WEBAUTHN_ORIGINS ||
        process.env.FRONTEND_URLS ||
        defaultOrigins.join(",")
    )
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
};
