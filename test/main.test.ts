import { newFlux } from "../src/utils";
import { fluxpoints } from "../src/db/schema";
import { count, eq } from "drizzle-orm";
import { describe, it, expect } from "bun:test";
import app from "../src";
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

        // post data
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
            body: "A".repeat(2001) // 1000 character limit
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
});