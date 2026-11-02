import crypto from "node:crypto";

const EARTH_RADIUS_METERS = 6371008.8;

function toRadians(value) {
    return value * Math.PI / 180;
}

export function calculateDistanceMeters(
    latitudeA,
    longitudeA,
    latitudeB,
    longitudeB
) {
    const values = [
        latitudeA,
        longitudeA,
        latitudeB,
        longitudeB
    ].map(Number);

    if (values.some((value) => !Number.isFinite(value))) {
        throw new TypeError("Coordinates must be finite numbers.");
    }

    const [latA, lonA, latB, lonB] = values;

    const latitudeDelta = toRadians(latB - latA);
    const longitudeDelta = toRadians(lonB - lonA);

    const latitudeAInRadians = toRadians(latA);
    const latitudeBInRadians = toRadians(latB);

    const haversine =
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(latitudeAInRadians) *
        Math.cos(latitudeBInRadians) *
        Math.sin(longitudeDelta / 2) ** 2;

    const centralAngle = 2 * Math.atan2(
        Math.sqrt(haversine),
        Math.sqrt(Math.max(0, 1 - haversine))
    );

    return EARTH_RADIUS_METERS * centralAngle;
}

export function validateDevicePublicKey(publicKeyBase64) {
    if (
        typeof publicKeyBase64 !== "string" ||
        publicKeyBase64.length > 4096
    ) {
        throw new Error("The device public key is invalid.");
    }

    let key;

    try {
        const der = Buffer.from(publicKeyBase64, "base64");

        key = crypto.createPublicKey({
            key: der,
            format: "der",
            type: "spki"
        });
    } catch {
        throw new Error("The device public key is invalid.");
    }

    const curve = key.asymmetricKeyDetails?.namedCurve;

    if (
        key.asymmetricKeyType !== "ec" ||
        !["prime256v1", "secp256r1"].includes(curve)
    ) {
        throw new Error(
            "Devices must use an ECDSA P-256 public key."
        );
    }

    return key;
}

export function verifyDeviceSignature({
    publicKeyBase64,
    challenge,
    signatureBase64
}) {
    try {
        const key = validateDevicePublicKey(publicKeyBase64);
        const signature = Buffer.from(signatureBase64, "base64");

        if (signature.length === 0 || signature.length > 256) {
            return false;
        }

        return crypto.verify(
            "sha256",
            Buffer.from(challenge, "utf8"),
            {
                key,
                dsaEncoding: "ieee-p1363"
            },
            signature
        );
    } catch {
        return false;
    }
}

export function createDeviceChallenge() {
    return crypto.randomBytes(32).toString("base64url");
}
