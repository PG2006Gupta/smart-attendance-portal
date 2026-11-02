// =====================================================
// STUDENT DEVICE KEYS (INDEXEDDB + WEB CRYPTO)
// =====================================================

const SAP_DEVICE_DATABASE = "sap-device-security";
const SAP_DEVICE_STORE = "devices";

function openSAPDeviceDatabase() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error("This browser does not support secure device storage."));
            return;
        }

        const request = indexedDB.open(SAP_DEVICE_DATABASE, 1);

        request.onupgradeneeded = () => {
            const database = request.result;

            if (!database.objectStoreNames.contains(SAP_DEVICE_STORE)) {
                database.createObjectStore(
                    SAP_DEVICE_STORE,
                    { keyPath: "credentialId" }
                );
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function withSAPDeviceStore(mode, operation) {
    const database = await openSAPDeviceDatabase();

    try {
        return await new Promise((resolve, reject) => {
            const transaction = database.transaction(
                SAP_DEVICE_STORE,
                mode
            );
            const store = transaction.objectStore(SAP_DEVICE_STORE);
            const request = operation(store);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            transaction.onabort = () => reject(transaction.error);
        });
    } finally {
        database.close();
    }
}

function sapBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8192;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + chunkSize)
        );
    }

    return btoa(binary);
}

async function getSAPLocalDevices(studentId) {
    const devices = await withSAPDeviceStore(
        "readonly",
        (store) => store.getAll()
    );

    return devices
        .filter((device) => String(device.studentId) === String(studentId))
        .sort((a, b) => b.createdAt - a.createdAt);
}

async function getSAPLocalDevice(studentId) {
    const devices = await getSAPLocalDevices(studentId);
    return devices[0] || null;
}

function sapDeviceName() {
    const agent = navigator.userAgent;
    const browser = /Edg\//.test(agent)
        ? "Edge"
        : /Chrome\//.test(agent)
            ? "Chrome"
            : /Firefox\//.test(agent)
                ? "Firefox"
                : /Safari\//.test(agent)
                    ? "Safari"
                    : "Browser";

    const platform = /Windows/.test(agent)
        ? "Windows"
        : /Android/.test(agent)
            ? "Android"
            : /iPhone|iPad/.test(agent)
                ? "iOS"
                : /Mac OS X/.test(agent)
                    ? "macOS"
                    : /Linux/.test(agent)
                        ? "Linux"
                        : "Device";

    return `${platform} ${browser}`.slice(0, 100);
}

async function registerSAPStudentDevice() {
    if (!window.isSecureContext || !crypto.subtle) {
        throw new Error(
            "Device registration requires HTTPS or localhost."
        );
    }

    const user = await requireStudentSession();
    if (!user) throw new Error("Please log in again.");

    const [serverData, localDevices] = await Promise.all([
        sapApi("/student/devices"),
        getSAPLocalDevices(user.id)
    ]);

    const activeCredentials = new Set(
        (serverData.devices || []).map(
            (device) => device.credential_id
        )
    );

    for (const localDevice of localDevices) {
        if (activeCredentials.has(localDevice.credentialId)) {
            return localDevice;
        }
    }

    if (!serverData.registration?.canRegister) {
        throw new Error(
            "Device registration is locked by administration. Contact the SAP administrator for any device change."
        );
    }

    // Remove stale local records whose server registration was revoked.
    await Promise.all(
        localDevices.map((device) =>
            withSAPDeviceStore("readwrite", (store) =>
                store.delete(device.credentialId)
            )
        )
    );

    if ((serverData.devices || []).length >= 2) {
        throw new Error(
            "Maximum two devices are registered. Contact the administrator for any device change."
        );
    }

    const keyPair = await crypto.subtle.generateKey(
        {
            name: "ECDSA",
            namedCurve: "P-256"
        },
        false,
        ["sign", "verify"]
    );

    const publicKey = await crypto.subtle.exportKey(
        "spki",
        keyPair.publicKey
    );
    const credentialId = crypto.randomUUID();
    const deviceName = sapDeviceName();

    // Store the private key before asking the server to consume a slot.
    // If a response is lost, a retry can reconcile this credential safely.
    const localRecord = {
        credentialId,
        deviceId: null,
        studentId: user.id,
        deviceName,
        keyPair,
        createdAt: Date.now()
    };

    await withSAPDeviceStore("readwrite", (store) =>
        store.put(localRecord)
    );

    const registration = await sapApi("/student/devices", {
        method: "POST",
        body: {
            credentialId,
            deviceName,
            publicKey: sapBufferToBase64(publicKey)
        }
    });

    return {
        ...localRecord,
        deviceId: registration.device.device_id
    };
}

async function signSAPDeviceChallenge(challenge, localDevice) {
    if (!localDevice?.keyPair?.privateKey) {
        throw new Error(
            "This browser does not contain the registered device key. Use an administrator-approved registration window or contact the SAP administrator."
        );
    }

    const signature = await crypto.subtle.sign(
        {
            name: "ECDSA",
            hash: "SHA-256"
        },
        localDevice.keyPair.privateKey,
        new TextEncoder().encode(challenge)
    );

    return sapBufferToBase64(signature);
}

async function removeSAPLocalDevice(credentialId) {
    if (!credentialId) return;

    await withSAPDeviceStore("readwrite", (store) =>
        store.delete(credentialId)
    );
}
