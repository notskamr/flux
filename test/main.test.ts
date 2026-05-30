import { newFlux } from "../src/utils";
import { generateApiKey } from "../src/utils";
import { hashString, verifyString } from "../src/utils/hashing";
import { fluxpoints, apiKeys } from "../src/db/schema";
import { config } from "../src/config";
import { count, eq } from "drizzle-orm";
import { describe, it, expect } from "bun:test";
import { app } from "../src";
import { db } from "../src/db";

describe("", () => {
    if (db === null) {
        throw new Error("Database not initialized");
    }

    it("NEW fluxpoint", async () => {
        const res = await app.request("/new", {
            method: "POST"
        });

        expect(res.status).toBe(200);

        const fluxData = await res.json();
        expect(fluxData.id).toBeDefined();
        expect(fluxData.key).toBeDefined();

        const [{ value: count_ }] = await db.select({ value: count() }).from(fluxpoints);
        expect(count_).toBe(1);
    });

    it("POST fluxpoint", async () => {
        if (db === null) {
            throw new Error("Database not initialized");
        }
        const { id, key } = await newFlux(db);
        const [flux] = await db.select().from(fluxpoints).where(eq(fluxpoints.id, id));
        if (flux === undefined) {
            throw new Error("No flux found");
        }
        expect(flux.data).toBe(null);

        const res = await app.request(`/flux/${id}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`
            },
            body: "Hello, World!"
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({ success: true });

        const [updatedFlux] = await db.select().from(fluxpoints).where(eq(fluxpoints.id, id));
        if (updatedFlux === undefined) {
            throw new Error("No flux found");
        }
        expect(updatedFlux.data).toBe("Hello, World!");
    });

    it("POST fluxpoint [invalid key]", async () => {
        const { id } = await newFlux(db);
        const res = await app.request(`/flux/${id}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer invalid`
            },
            body: "Hello, World!"
        });

        expect(res.status).toBe(401);
        const data = await res.json();
        expect(data).toEqual({ error: "Invalid API key" });
    });

    it("POST fluxpoint [invalid id]", async () => {
        const res = await app.request(`/flux/invalid`, {
            method: "POST",
            headers: {
                Authorization: `Bearer invalid`
            },
            body: "Hello, World!"
        });

        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data).toEqual({ error: "Flux not found" });
    });

    it("POST fluxpoint [no data]", async () => {
        const { id, key } = await newFlux(db);
        const res = await app.request(`/flux/${id}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`
            }
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        const [flux] = await db.select().from(fluxpoints).where(eq(fluxpoints.id, id));
        if (flux === undefined) {
            throw new Error("No flux found");
        }
        expect(data).toEqual({ success: true });
        expect(flux.data).toBe("");
    });

    it("POST fluxpoint [large data]", async () => {
        const { id, key } = await newFlux(db);
        const res = await app.request(`/flux/${id}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`
            },
            body: "A".repeat(config.maxPayloadSize + 1)
        });

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data).toEqual({ error: "Data too large" });
    });

    it("GET fluxpoint [valid id]", async () => {
        const { id } = await newFlux(db);
        const res = await app.request(`/flux/${id}`, {
            method: "GET"
        });
        expect(res.status).toBe(200);
    });

    it("GET fluxpoint [invalid id]", async () => {
        const res = await app.request(`/flux/invalid`, {
            method: "GET"
        });

        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data).toEqual({ error: "Flux not found" });
    });

    it("GET fluxpoints [count]", async () => {
        await newFlux(db);
        const res = await app.request(`/fluxpoints`, {
            method: "GET"
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ count: 1 });
    });

    it("GET fluxpoints [count, empty]", async () => {
        const res = await app.request(`/fluxpoints`, {
            method: "GET"
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ count: 0 });
    });

    it("GET fluxpoints [count, multiple]", async () => {
        await newFlux(db);
        await newFlux(db);
        await newFlux(db);
        const res = await app.request(`/fluxpoints`, {
            method: "GET"
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ count: 3 });
    });

    it("POST fluxpoint [no authorization header]", async () => {
        const { id } = await newFlux(db);
        const res = await app.request(`/flux/${id}`, {
            method: "POST",
            body: "Hello, World!"
        });

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "Authorization header required" });
    });

    it("POST fluxpoint [malformed authorization header]", async () => {
        const { id } = await newFlux(db);
        const res = await app.request(`/flux/${id}`, {
            method: "POST",
            headers: {
                Authorization: "Bearer"
            },
            body: "Hello, World!"
        });

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "Invalid Authorization header" });
    });

    it("POST fluxpoint [payload at limit]", async () => {
        const { id, key } = await newFlux(db);
        const res = await app.request(`/flux/${id}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`
            },
            body: "A".repeat(config.maxPayloadSize)
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });

        const [flux] = await db.select().from(fluxpoints).where(eq(fluxpoints.id, id));
        expect(flux?.data).toBe("A".repeat(config.maxPayloadSize));
    });

    it("POST fluxpoint [overwrites existing data]", async () => {
        const { id, key } = await newFlux(db);

        const first = await app.request(`/flux/${id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: "first"
        });
        expect(first.status).toBe(200);

        const second = await app.request(`/flux/${id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: "second"
        });
        expect(second.status).toBe(200);

        const [flux] = await db.select().from(fluxpoints).where(eq(fluxpoints.id, id));
        expect(flux?.data).toBe("second");
    });

    it("POST fluxpoint [rate limit]", async () => {
        const { id, key } = await newFlux(db);

        // Exhaust the rate limit window for this flux.
        let lastStatus = 200;
        for (let i = 0; i < config.maxRequestsPerWindow + 1; i++) {
            const res = await app.request(`/flux/${id}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${key}` },
                body: "x"
            });
            lastStatus = res.status;
        }

        expect(lastStatus).toBe(429);
    });

    it("methods are restricted by CORS allowMethods", async () => {
        const res = await app.request(`/flux/some-id`, {
            method: "OPTIONS",
            headers: {
                Origin: "https://example.com",
                "Access-Control-Request-Method": "POST"
            }
        });
        expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });
});

describe("newFlux", () => {
    it("creates a flux with a matching api key row", async () => {
        const { id, key } = await newFlux(db);

        expect(id).toBeDefined();
        expect(key).toBeDefined();

        const [apiKey] = await db.select().from(apiKeys).where(eq(apiKeys.fluxId, id));
        expect(apiKey).toBeDefined();
        // Stored key is hashed, not the raw key.
        expect(apiKey?.key).not.toBe(key);
        expect(await verifyString(apiKey!.key, key)).toBe(true);
    });

    it("generates unique ids and keys", async () => {
        const a = await newFlux(db);
        const b = await newFlux(db);

        expect(a.id).not.toBe(b.id);
        expect(a.key).not.toBe(b.key);
    });
});

describe("hashing", () => {
    it("hashString produces a salt:hash pair", async () => {
        const hash = await hashString("secret");
        const [salt, digest] = hash.split(":");
        expect(salt).toBeDefined();
        expect(digest).toBeDefined();
        expect(salt.length).toBe(32); // 16-byte salt as hex
    });

    it("hashString is salted (same input, different output)", async () => {
        const a = await hashString("secret");
        const b = await hashString("secret");
        expect(a).not.toBe(b);
    });

    it("verifyString accepts the correct value", async () => {
        const hash = await hashString("correct horse");
        expect(await verifyString(hash, "correct horse")).toBe(true);
    });

    it("verifyString rejects the wrong value", async () => {
        const hash = await hashString("correct horse");
        expect(await verifyString(hash, "wrong horse")).toBe(false);
    });

    it("verifyString throws on a hash with no digest", async () => {
        // No ":" means there's no digest portion.
        expect(verifyString("abcd", "anything")).rejects.toThrow("Invalid hash format");
    });

    it("verifyString throws when the salt portion is empty", async () => {
        expect(verifyString(":deadbeef", "anything")).rejects.toThrow("Invalid hash format");
    });

    it("verifyString throws on a non-hex salt", async () => {
        expect(verifyString("zz:deadbeef", "anything")).rejects.toThrow("Invalid salt format");
    });
});

describe("generateApiKey", () => {
    it("returns a 32-char hex string without dashes", () => {
        const key = generateApiKey();
        expect(key).not.toContain("-");
        expect(key.length).toBe(32);
    });
});

