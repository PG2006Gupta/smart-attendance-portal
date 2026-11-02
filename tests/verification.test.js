import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
    calculateDistanceMeters,
    createDeviceChallenge,
    validateDevicePublicKey,
    verifyDeviceSignature
} from "../server/services/verification.js";

const { subtle } = webcrypto;

test("Haversine distance is zero for identical coordinates", () => {
    assert.equal(
        calculateDistanceMeters(30.9, 75.8, 30.9, 75.8),
        0
    );
});

test("Haversine distance is approximately 111 km for one latitude degree", () => {
    const distance = calculateDistanceMeters(30, 75, 31, 75);
    assert.ok(distance > 110000 && distance < 112000);
});

test("Haversine calculation is symmetric", () => {
    const first = calculateDistanceMeters(30.9, 75.8, 31.1, 76.2);
    const second = calculateDistanceMeters(31.1, 76.2, 30.9, 75.8);
    assert.ok(Math.abs(first - second) < 0.000001);
});

test("P-256 device keys and Web Crypto signatures verify", async () => {
    const keyPair = await subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"]
    );

    const publicKey = Buffer.from(
        await subtle.exportKey("spki", keyPair.publicKey)
    ).toString("base64");

    assert.doesNotThrow(() => validateDevicePublicKey(publicKey));

    const challenge = createDeviceChallenge();
    const signature = Buffer.from(
        await subtle.sign(
            { name: "ECDSA", hash: "SHA-256" },
            keyPair.privateKey,
            new TextEncoder().encode(challenge)
        )
    ).toString("base64");

    assert.equal(
        verifyDeviceSignature({ publicKeyBase64: publicKey, challenge, signatureBase64: signature }),
        true
    );

    assert.equal(
        verifyDeviceSignature({
            publicKeyBase64: publicKey,
            challenge: `${challenge}-changed`,
            signatureBase64: signature
        }),
        false
    );
});

test("Non-P-256 keys are rejected", async () => {
    const keyPair = await subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        false,
        ["sign", "verify"]
    );
    const publicKey = Buffer.from(
        await subtle.exportKey("spki", keyPair.publicKey)
    ).toString("base64");

    assert.throws(
        () => validateDevicePublicKey(publicKey),
        /P-256/
    );
});

test("Device challenges are random and URL-safe", () => {
    const first = createDeviceChallenge();
    const second = createDeviceChallenge();

    assert.notEqual(first, second);
    assert.match(first, /^[A-Za-z0-9_-]+$/);
    assert.ok(first.length >= 40);
});
