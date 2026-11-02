// =====================================================
// NATIVE WEBAUTHN / PASSKEY SUPPORT
// Requires HTTPS or localhost and js/script.js.
// =====================================================

let sapPasskeyLoginInProgress = false;
let sapPasskeyRegistrationInProgress = false;

function sapBase64UrlToBuffer(value) {
    const base64 = value
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes.buffer;
}

function sapBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8192;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + chunkSize)
        );
    }

    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function assertSAPPasskeySupport() {
    if (
        !window.isSecureContext ||
        !window.PublicKeyCredential ||
        !navigator.credentials
    ) {
        throw new Error(
            "Passkeys require a compatible browser and HTTPS or localhost."
        );
    }
}

function sapPasskeyError(error) {
    if (error?.name === "NotAllowedError") {
        return "The passkey ceremony was cancelled or timed out.";
    }

    if (error?.name === "InvalidStateError") {
        return "This authenticator may already be registered. Try signing in instead.";
    }

    return sapNetworkMessage(error);
}

async function registerSAPPasskey() {
    if (sapPasskeyRegistrationInProgress) return;
    sapPasskeyRegistrationInProgress = true;

    try {
        assertSAPPasskeySupport();

        const { options } = await sapApi(
            "/auth/passkey/register/options",
            { method: "POST" }
        );

        const publicKey = {
            ...options,
            challenge: sapBase64UrlToBuffer(options.challenge),
            user: {
                ...options.user,
                id: sapBase64UrlToBuffer(options.user.id)
            },
            excludeCredentials: (options.excludeCredentials || []).map(
                (credential) => ({
                    ...credential,
                    id: sapBase64UrlToBuffer(credential.id)
                })
            )
        };

        const credential = await navigator.credentials.create({
            publicKey
        });

        if (!credential) {
            throw new Error("No passkey was created.");
        }

        const attestation = {
            id: credential.id,
            rawId: sapBufferToBase64Url(credential.rawId),
            type: credential.type,
            authenticatorAttachment:
                credential.authenticatorAttachment || undefined,
            clientExtensionResults:
                credential.getClientExtensionResults(),
            response: {
                clientDataJSON: sapBufferToBase64Url(
                    credential.response.clientDataJSON
                ),
                attestationObject: sapBufferToBase64Url(
                    credential.response.attestationObject
                ),
                transports:
                    typeof credential.response.getTransports === "function"
                        ? credential.response.getTransports()
                        : []
            }
        };

        await sapApi("/auth/passkey/register/verify", {
            method: "POST",
            body: { response: attestation }
        });

        showSAPToast(
            "success",
            "Passkey Registered",
            "You can now use this authenticator on the login page."
        );

        window.dispatchEvent(new Event("sap-passkey-registered"));
        return true;
    } catch (error) {
        showSAPToast(
            "error",
            "Passkey Registration Failed",
            sapPasskeyError(error)
        );
        return false;
    } finally {
        sapPasskeyRegistrationInProgress = false;
    }
}

async function startSAPPasskeyLogin(expectedRole) {
    if (sapPasskeyLoginInProgress) return;
    sapPasskeyLoginInProgress = true;

    try {
        assertSAPPasskeySupport();

        const { options } = await sapApi(
            "/auth/passkey/login/options",
            { method: "POST" }
        );

        const publicKey = {
            ...options,
            challenge: sapBase64UrlToBuffer(options.challenge),
            allowCredentials: (options.allowCredentials || []).map(
                (credential) => ({
                    ...credential,
                    id: sapBase64UrlToBuffer(credential.id)
                })
            )
        };

        const assertion = await navigator.credentials.get({
            publicKey
        });

        if (!assertion) {
            throw new Error("No passkey response was received.");
        }

        const loginResponse = {
            id: assertion.id,
            rawId: sapBufferToBase64Url(assertion.rawId),
            type: assertion.type,
            authenticatorAttachment:
                assertion.authenticatorAttachment || undefined,
            clientExtensionResults:
                assertion.getClientExtensionResults(),
            response: {
                clientDataJSON: sapBufferToBase64Url(
                    assertion.response.clientDataJSON
                ),
                authenticatorData: sapBufferToBase64Url(
                    assertion.response.authenticatorData
                ),
                signature: sapBufferToBase64Url(
                    assertion.response.signature
                ),
                userHandle: assertion.response.userHandle
                    ? sapBufferToBase64Url(assertion.response.userHandle)
                    : null
            }
        };

        const data = await sapApi("/auth/passkey/login/verify", {
            method: "POST",
            body: { response: loginResponse }
        });

        if (data.user?.role !== expectedRole) {
            await sapApi("/auth/logout", { method: "POST" });
            throw new Error(
                `This passkey belongs to the ${data.user?.role || "other"} portal.`
            );
        }

        showSAPToast(
            "success",
            "Passkey Verified",
            "Login successful."
        );

        setTimeout(() => {
            window.location.href = expectedRole === "teacher"
                ? "teacher-dashboard.html"
                : "student-dashboard.html";
        }, 400);
    } catch (error) {
        showSAPToast(
            "error",
            "Passkey Login Failed",
            sapPasskeyError(error)
        );
    } finally {
        sapPasskeyLoginInProgress = false;
    }
}
