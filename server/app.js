import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import pool from "./config/db.js";
import authRouter from "./routes/auth.js";
import passkeyRouter from "./routes/passkeys.js";
import teacherRouter from "./routes/teacher.js";
import studentRouter from "./routes/student.js";
import adminRouter from "./routes/admin.js";

const app = express();
const PostgreSqlSessionStore = connectPgSimple(session);
const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
);

if (
    !process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 64
) {
    throw new Error(
        "SESSION_SECRET must contain a long random value in .env"
    );
}

const allowedOrigins = (
    process.env.FRONTEND_URLS ||
    "http://localhost:5500,http://127.0.0.1:5500,http://localhost:5000"
)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.disable("x-powered-by");

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                scriptSrcAttr: ["'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:"],
                fontSrc: ["'self'", "data:"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                frameAncestors: ["'none'"]
            }
        }
    })
);

app.use(
    cors({
        origin(origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
            }

            callback(new Error("Origin not allowed by CORS"));
        },
        credentials: true
    })
);

app.use(express.json({ limit: "64kb" }));

app.use(
    session({
        name: "sap.sid",
        store: new PostgreSqlSessionStore({
            pool,
            tableName: "user_sessions",
            createTableIfMissing: true
        }),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 8 * 60 * 60 * 1000
        }
    })
);

app.use("/api/auth/passkey", passkeyRouter);
app.use("/api/auth", authRouter);
app.use("/api/teacher", teacherRouter);
app.use("/api/student", studentRouter);
app.use("/api/admin", adminRouter);

app.get("/api/health", async (request, response, next) => {
    try {
        const result = await pool.query(
            "SELECT NOW() AS database_time"
        );

        response.json({
            status: "ok",
            service: "SAP backend",
            databaseTime: result.rows[0].database_time
        });
    } catch (error) {
        next(error);
    }
});

app.use("/api", (request, response) => {
    response.status(404).json({ error: "Route not found" });
});

// Serve only frontend assets. Source code, migrations, .env, and package files
// are intentionally not exposed by the static server.
app.use("/css", express.static(path.join(projectRoot, "css")));
app.use("/js", express.static(path.join(projectRoot, "js")));
app.use("/images", express.static(path.join(projectRoot, "images")));

app.get("/", (request, response) => {
    response.sendFile(path.join(projectRoot, "index.html"));
});

app.use((request, response, next) => {
    if (
        request.method === "GET" &&
        /^\/[a-z0-9-]+\.html$/i.test(request.path)
    ) {
        return response.sendFile(
            path.join(projectRoot, request.path.slice(1)),
            (error) => {
                if (error) next(error);
            }
        );
    }

    next();
});

app.use((request, response) => {
    response.status(404).json({ error: "Resource not found" });
});

app.use((error, request, response, next) => {
    if (error instanceof SyntaxError && error.status === 400) {
        return response.status(400).json({
            error: "Malformed JSON request."
        });
    }

    console.error("Application error:", error);

    if (response.headersSent) {
        return next(error);
    }

    const status = Number(error.status || error.statusCode) || 500;

    response.status(status >= 400 && status < 600 ? status : 500).json({
        error: status === 404
            ? "Resource not found"
            : status >= 500
                ? "Internal server error"
                : error.message
    });
});

export default app;
