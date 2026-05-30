const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateFluxId(length = 8) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let id = "";
    for (let i = 0; i < length; i++) {
        id += BASE62[bytes[i] % 62];
    }
    return id;
}

export function generateApiKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Buffer.from(bytes).toString("base64url");
}
