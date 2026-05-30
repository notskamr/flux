import { newFlux } from "../src/utils";
import { config } from "../src/config";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { app } from "../src";
import { db } from "../src/db";

type SSEEvent = { event: string; data: string; };

async function openStream(id: string, query = "") {
    const controller = new AbortController();
    const res = await app.request(`/flux/${id}${query}`, {
        method: "GET",
        signal: controller.signal
    });

    const events: SSEEvent[] = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const loop = (async () => {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                let sep: number;
                while ((sep = buffer.indexOf("\n\n")) !== -1) {
                    const frame = buffer.slice(0, sep);
                    buffer = buffer.slice(sep + 2);

                    let event = "message";
                    let data = "";
                    for (const line of frame.split("\n")) {
                        if (line.startsWith("event:")) event = line.slice(6).trim();
                        else if (line.startsWith("data:")) data = line.slice(5).trim();
                    }
                    events.push({ event, data });
                }
            }
        } catch {
        }
    })();

    return {
        res,
        events,
        async waitFor(predicate: () => boolean, timeoutMs = 2000) {
            const start = Date.now();
            while (!predicate()) {
                if (Date.now() - start > timeoutMs) {
                    throw new Error(
                        `timed out waiting for events; got ${JSON.stringify(events)}`
                    );
                }
                await new Promise((r) => setTimeout(r, 10));
            }
        },
        async close() {
            controller.abort();
            try { await reader.cancel(); } catch { }
            await loop;
        }
    };
}

async function postData(id: string, key: string, body: string) {
    const res = await app.request(`/flux/${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body
    });
    expect(res.status).toBe(200);
}

describe("streaming (SSE)", () => {
    const original = { ...config };

    beforeEach(() => {
        config.heartbeatInterval = 50;
        config.maxConnectionLifetime = 60_000;
    });

    afterEach(() => {
        Object.assign(config, original);
    });

    it("sends an initial heartbeat on connect", async () => {
        const { id } = await newFlux(db);
        const stream = await openStream(id);
        try {
            expect(stream.res.status).toBe(200);
            expect(stream.res.headers.get("Content-Type")).toContain("text/event-stream");
            await stream.waitFor(() => stream.events.some((e) => e.event === "heartbeat"));
        } finally {
            await stream.close();
        }
    });

    it("emits repeated heartbeats over time", async () => {
        const { id } = await newFlux(db);
        const stream = await openStream(id);
        try {
            await stream.waitFor(
                () => stream.events.filter((e) => e.event === "heartbeat").length >= 4
            );
            const heartbeats = stream.events.filter((e) => e.event === "heartbeat");
            expect(heartbeats.length).toBeGreaterThanOrEqual(4);
        } finally {
            await stream.close();
        }
    });

    it("delivers posted data to a connected client", async () => {
        const { id, key } = await newFlux(db);
        const stream = await openStream(id);
        try {
            await stream.waitFor(() => stream.events.some((e) => e.event === "heartbeat"));
            await postData(id, key, "live update");
            await stream.waitFor(() =>
                stream.events.some((e) => e.event === "message" && e.data === "live update")
            );
        } finally {
            await stream.close();
        }
    });

    it("broadcasts to multiple clients simultaneously", async () => {
        const { id, key } = await newFlux(db);
        const clients = await Promise.all([
            openStream(id),
            openStream(id),
            openStream(id)
        ]);
        try {
            await Promise.all(
                clients.map((c) =>
                    c.waitFor(() => c.events.some((e) => e.event === "heartbeat"))
                )
            );

            await postData(id, key, "fan-out");

            await Promise.all(
                clients.map((c) =>
                    c.waitFor(() =>
                        c.events.some((e) => e.event === "message" && e.data === "fan-out")
                    )
                )
            );

            for (const c of clients) {
                expect(c.events.some((e) => e.data === "fan-out")).toBe(true);
            }
        } finally {
            await Promise.all(clients.map((c) => c.close()));
        }
    });

    it("sustains a connection across many broadcasts", async () => {
        const { id, key } = await newFlux(db);
        const stream = await openStream(id);
        try {
            await stream.waitFor(() => stream.events.some((e) => e.event === "heartbeat"));

            const messages = Array.from({ length: 20 }, (_, i) => `msg-${i}`);
            for (const m of messages) {
                await postData(id, key, m);
            }

            await stream.waitFor(() =>
                messages.every((m) =>
                    stream.events.some((e) => e.event === "message" && e.data === m)
                )
            );

            const received = stream.events
                .filter((e) => e.event === "message")
                .map((e) => e.data);
            expect(received).toEqual(messages);
        } finally {
            await stream.close();
        }
    });

    it("sends existing data first when onFirst=true", async () => {
        const { id, key } = await newFlux(db);
        await postData(id, key, "stored value");

        const stream = await openStream(id, "?onFirst=true");
        try {
            await stream.waitFor(() =>
                stream.events.some((e) => e.event === "message" && e.data === "stored value")
            );
            const messageIdx = stream.events.findIndex((e) => e.event === "message");
            const heartbeatIdx = stream.events.findIndex((e) => e.event === "heartbeat");
            expect(messageIdx).toBe(0);
            expect(stream.events[0].data).toBe("stored value");
            if (heartbeatIdx !== -1) {
                expect(messageIdx).toBeLessThan(heartbeatIdx);
            }
        } finally {
            await stream.close();
        }
    });
});
