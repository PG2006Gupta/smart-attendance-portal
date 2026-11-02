import argon2 from "argon2";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import pool from "../config/db.js";

const router = Router();

const loginSchema = z.object({
    loginId: z.string().trim().min(1).max(50),
    password: z.string().min(1).max(128)
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,

    message: {
        error: "Too many login attempts. Please try again later."
    }
});

// Used so unknown accounts also go through password verification
const dummyPasswordHash = await argon2.hash(
    "dummy-password-for-timing-only",
    {
        type: argon2.argon2id
    }
);

function regenerateSession(request) {
    return new Promise((resolve, reject) => {
        request.session.regenerate((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

function saveSession(request) {
    return new Promise((resolve, reject) => {
        request.session.save((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

router.post("/login", loginLimiter, async (request, response, next) => {
    try {
        const validation = loginSchema.safeParse(request.body);

        if (!validation.success) {
            return response.status(400).json({
                error: "Enter a valid login ID and password."
            });
        }

        const loginId = validation.data.loginId.toUpperCase();
        const password = validation.data.password;

        const result = await pool.query(
            `
            SELECT
                id,
                login_id,
                password_hash,
                role,
                is_active
            FROM users
            WHERE login_id = $1
            `,
            [loginId]
        );

        const user = result.rows[0];

        const passwordMatches = await argon2.verify(
            user ? user.password_hash : dummyPasswordHash,
            password
        );

        // Use the same response for invalid and disabled accounts
        if (!user || !passwordMatches || !user.is_active) {
            return response.status(401).json({
                error: "Invalid login ID or password."
            });
        }

        // Prevent session-fixation attacks
        await regenerateSession(request);

        request.session.user = {
            id: user.id,
            loginId: user.login_id,
            role: user.role
        };

        await saveSession(request);

        return response.status(200).json({
            message: "Login successful",
            user: request.session.user
        });

    } catch (error) {
        next(error);
    }
});

router.get("/me", (request, response) => {
    if (!request.session.user) {
        return response.status(401).json({
            authenticated: false,
            error: "Not authenticated"
        });
    }

    return response.status(200).json({
        authenticated: true,
        user: request.session.user
    });
});

router.post("/logout", (request, response, next) => {
    if (!request.session.user) {
        return response.status(200).json({
            message: "Already logged out"
        });
    }

    request.session.destroy((error) => {
        if (error) {
            next(error);
            return;
        }

        response.clearCookie("sap.sid", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax"
        });

        response.status(200).json({
            message: "Logout successful"
        });
    });
});

export default router;