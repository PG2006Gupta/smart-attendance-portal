import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse
} from "@simplewebauthn/server";
import pool from "../config/db.js";
import { webAuthnConfig } from "../config/webauthn.js";

const router = Router();

const passkeyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Too many passkey attempts. Please try again later."
    }
});

function saveSession(request) {
    return new Promise((resolve, reject) => {
        request.session.save((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function regenerateSession(request) {
    return new Promise((resolve, reject) => {
        request.session.regenerate((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function requireAccount(request, response, next) {
    if (!request.session.user) {
        return response.status(401).json({
            error: "Authentication required"
        });
    }

    response.setHeader("Cache-Control", "no-store");
    next();
}

async function getAccount(userId) {
    const result = await pool.query(
        `
        SELECT
            users.id,
            users.login_id,
            users.role,
            users.is_active,
            COALESCE(students.full_name, teachers.full_name) AS full_name
        FROM users
        LEFT JOIN students ON students.user_id = users.id
        LEFT JOIN teachers ON teachers.user_id = users.id
        WHERE users.id = $1
        `,
        [userId]
    );

    return result.rows[0] || null;
}

router.post(
    "/register/options",
    passkeyLimiter,
    requireAccount,
    async (request, response, next) => {
        try {
            const user = await getAccount(request.session.user.id);

            if (!user || !user.is_active) {
                return response.status(403).json({
                    error: "This account is unavailable."
                });
            }

            const existing = await pool.query(
                `
                SELECT credential_id, transports
                FROM passkey_credentials
                WHERE user_id = $1
                `,
                [user.id]
            );

            const options = await generateRegistrationOptions({
                rpName: webAuthnConfig.rpName,
                rpID: webAuthnConfig.rpID,
                userName: user.login_id,
                userDisplayName: user.full_name || user.login_id,
                userID: new TextEncoder().encode(String(user.id)),
                attestationType: "none",
                excludeCredentials: existing.rows.map((credential) => ({
                    id: credential.credential_id,
                    transports: credential.transports || undefined
                })),
                authenticatorSelection: {
                    residentKey: "required",
                    userVerification: "required"
                },
                timeout: 60000
            });

            request.session.passkeyChallenge = {
                type: "registration",
                userId: user.id,
                challenge: options.challenge
            };

            await saveSession(request);
            response.json({ options });
        } catch (error) {
            next(error);
        }
    }
);

router.post(
    "/register/verify",
    passkeyLimiter,
    requireAccount,
    async (request, response, next) => {
        try {
            const stored = request.session.passkeyChallenge;

            if (
                !stored ||
                stored.type !== "registration" ||
                stored.userId !== request.session.user.id
            ) {
                return response.status(400).json({
                    error: "Passkey registration expired. Request new options."
                });
            }

            delete request.session.passkeyChallenge;
            await saveSession(request);

            let verification;

            try {
                verification = await verifyRegistrationResponse({
                    response: request.body.response,
                    expectedChallenge: stored.challenge,
                    expectedOrigin: webAuthnConfig.origins,
                    expectedRPID: webAuthnConfig.rpID,
                    requireUserVerification: true
                });
            } catch {
                return response.status(400).json({
                    error: "The passkey response could not be verified."
                });
            }

            if (!verification.verified || !verification.registrationInfo) {
                return response.status(400).json({
                    error: "The passkey response could not be verified."
                });
            }

            const { credential } = verification.registrationInfo;

            await pool.query(
                `
                INSERT INTO passkey_credentials (
                    user_id,
                    credential_id,
                    public_key,
                    counter,
                    transports,
                    device_type,
                    backed_up
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                `,
                [
                    request.session.user.id,
                    credential.id,
                    Buffer.from(credential.publicKey),
                    credential.counter,
                    credential.transports || null,
                    verification.registrationInfo.credentialDeviceType,
                    verification.registrationInfo.credentialBackedUp
                ]
            );

            response.status(201).json({
                verified: true,
                message: "Passkey registered successfully."
            });
        } catch (error) {
            if (error.code === "23505") {
                return response.status(409).json({
                    error: "This passkey is already registered."
                });
            }

            next(error);
        }
    }
);

router.post(
    "/login/options",
    passkeyLimiter,
    async (request, response, next) => {
        try {
            const options = await generateAuthenticationOptions({
                rpID: webAuthnConfig.rpID,
                userVerification: "required",
                timeout: 60000
            });

            request.session.passkeyChallenge = {
                type: "authentication",
                challenge: options.challenge
            };

            await saveSession(request);
            response.json({ options });
        } catch (error) {
            next(error);
        }
    }
);

router.post(
    "/login/verify",
    passkeyLimiter,
    async (request, response, next) => {
        try {
            const stored = request.session.passkeyChallenge;
            const assertion = request.body.response;

            if (
                !stored ||
                stored.type !== "authentication" ||
                !assertion?.id
            ) {
                return response.status(400).json({
                    error: "Passkey login expired. Please try again."
                });
            }

            delete request.session.passkeyChallenge;
            await saveSession(request);

            const credentialResult = await pool.query(
                `
                SELECT
                    passkey_credentials.*,
                    users.login_id,
                    users.role,
                    users.is_active
                FROM passkey_credentials
                JOIN users ON users.id = passkey_credentials.user_id
                WHERE passkey_credentials.credential_id = $1
                `,
                [assertion.id]
            );

            if (credentialResult.rowCount === 0) {
                return response.status(401).json({
                    error: "This passkey is not registered with SAP."
                });
            }

            const credential = credentialResult.rows[0];

            if (!credential.is_active) {
                return response.status(401).json({
                    error: "This account is unavailable."
                });
            }

            let verification;

            try {
                verification = await verifyAuthenticationResponse({
                    response: assertion,
                    expectedChallenge: stored.challenge,
                    expectedOrigin: webAuthnConfig.origins,
                    expectedRPID: webAuthnConfig.rpID,
                    credential: {
                        id: credential.credential_id,
                        publicKey: new Uint8Array(credential.public_key),
                        counter: Number(credential.counter),
                        transports: credential.transports || undefined
                    },
                    requireUserVerification: true
                });
            } catch {
                return response.status(401).json({
                    error: "Passkey authentication failed."
                });
            }

            if (!verification.verified) {
                return response.status(401).json({
                    error: "Passkey authentication failed."
                });
            }

            await pool.query(
                `
                UPDATE passkey_credentials
                SET counter = $2, last_used_at = NOW()
                WHERE id = $1
                `,
                [credential.id, verification.authenticationInfo.newCounter]
            );

            await regenerateSession(request);

            request.session.user = {
                id: credential.user_id,
                loginId: credential.login_id,
                role: credential.role
            };

            await saveSession(request);

            response.json({
                verified: true,
                message: "Passkey login successful.",
                user: request.session.user
            });
        } catch (error) {
            next(error);
        }
    }
);

export default router;
