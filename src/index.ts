import { Hono } from 'hono';
import { cors } from "hono/cors";
import { serveStatic } from 'hono/bun';
import { streamSSE } from 'hono/streaming';
import { EventEmitter } from 'events';
import { db } from './db';
import { fluxpoints } from './db/schema';
import { count, eq } from 'drizzle-orm';
import { newFlux } from './utils';
import { verifyString } from './utils/hashing';
import 'dotenv/config';
import { StatusCode } from 'hono/utils/http-status';
import { config } from './config';
import { _logger, log } from './logger';

// Custom emitter class to track last activity and allow cleanup
class FluxEmitter extends EventEmitter {
  lastActivity: number = Date.now();
  close?: () => void;
}

// Custom error class
class FluxError extends Error {
  constructor(public status: StatusCode, message: string) {
    super(message);
  }
}

// Connection management
class ConnectionManager {
  private connections: Map<string, Set<FluxEmitter>> = new Map();
  private connectionCounts: Map<string, number> = new Map();
  private rateLimits: Map<string, { count: number, timestamp: number; }> = new Map();

  constructor() {
    // Periodic cleanup of stale connections
    setInterval(() => this.cleanup(), config.connectionTimeout);
  }

  private cleanup() {
    const now = Date.now();
    this.connections.forEach((emitters, fluxId) => {
      emitters.forEach(emitter => {
        if (emitter.lastActivity < now - config.connectionTimeout) {
          emitter.close?.();
        }
      });
    });

    this.rateLimits.forEach((limit, fluxId) => {
      if (now - limit.timestamp > config.rateLimitWindow * 10) {
        this.rateLimits.delete(fluxId);
      }
    });
  }

  async addConnection(fluxId: string): Promise<FluxEmitter> {
    // Check global connection limit
    const totalConnections = Array.from(this.connectionCounts.values())
      .reduce((sum, count) => sum + count, 0);

    if (totalConnections >= config.maxConnections) {
      log('warn', 'sse.rejected', { fluxId, reason: 'global_capacity', total: totalConnections });
      throw new FluxError(503, "Server at capacity");
    }

    // Check per-flux connection limit
    const currentCount = this.connectionCounts.get(fluxId) || 0;

    if (currentCount >= config.maxConnectionsPerFlux) {
      log('warn', 'sse.rejected', { fluxId, reason: 'per_flux_limit', current: currentCount });
      throw new FluxError(503, "Too many connections for this fluxpoint");
    }

    // Create new emitter
    const emitter = new FluxEmitter();

    // Store connection
    if (!this.connections.has(fluxId)) {
      this.connections.set(fluxId, new Set());
    }
    this.connections.get(fluxId)!.add(emitter);
    this.connectionCounts.set(fluxId, currentCount + 1);

    log('info', 'sse.connect', { fluxId, connections: currentCount + 1 });

    return emitter;
  }

  removeConnection(fluxId: string, emitter: FluxEmitter) {
    const emitters = this.connections.get(fluxId);
    if (emitters && emitters.has(emitter)) {
      emitters.delete(emitter);
      const currentCount = this.connectionCounts.get(fluxId) || 0;
      this.connectionCounts.set(fluxId, currentCount - 1);

      // Cleanup if no connections remain
      if (emitters.size === 0) {
        this.connections.delete(fluxId);
        this.connectionCounts.delete(fluxId);
      }
      log('debug', 'sse.disconnect', { fluxId, remaining: emitters?.size ?? 0 });
    }
  }

  async broadcast(fluxId: string, data: string) {
    const emitters = this.connections.get(fluxId);
    if (emitters) {
      log('debug', 'sse.broadcast', { fluxId, subscribers: emitters.size, bytes: Buffer.byteLength(data) });
      const promises = Array.from(emitters).map(async (emitter) => {
        try {
          emitter.lastActivity = Date.now();
          emitter.emit("message", data);
        } catch (error) {
          log('error', 'sse.emit_error', { fluxId, error: error instanceof Error ? error.message : String(error) });
          this.removeConnection(fluxId, emitter);
        }
      });
      await Promise.all(promises);
    }
  }

  checkRateLimit(fluxId: string): boolean {
    const now = Date.now();
    const limit = this.rateLimits.get(fluxId) || { count: 0, timestamp: now };

    if (now - limit.timestamp > config.rateLimitWindow) {
      // Reset window
      limit.count = 1;
      limit.timestamp = now;
    } else {
      limit.count++;
    }

    this.rateLimits.set(fluxId, limit);
    return limit.count <= config.maxRequestsPerWindow;
  }
}

const app = new Hono();

const connectionManager = new ConnectionManager();

// Middleware
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Authorization"],
  credentials: true
}));

app.use("*", _logger());

app.onError((error, c) => {
  if (error instanceof FluxError) {
    log('warn', 'request.error', { status: error.status, message: error.message });
    return c.json({ error: error.message }, error.status as any);
  }
  log('error', 'request.unhandled_error', { error: error instanceof Error ? error.message : String(error) });
  return c.json({ error: "Internal server error" }, 500);
});

// Routes
app.get("/", serveStatic({ path: "src/pages/index.html" }));
app.get("/new", serveStatic({ path: "src/pages/new.html" }));

app.post("/new", async (c) => {
  const authorization = c.req.header("Authorization");
  const bearer = authorization?.split(" ")[1];

  if (!!process.env.API_KEY && bearer !== process.env.API_KEY) {
    throw new FluxError(401, "Invalid API key");
  }

  const fluxDetails = await newFlux();
  return c.json(fluxDetails);
});

app.post("/flux/:id", async (c) => {
  const id = c.req.param("id");
  const authorization = c.req.header("Authorization");

  if (!authorization) {
    throw new FluxError(400, "Authorization header required");
  }

  const bearer = authorization.split(" ")[1];
  if (!bearer) {
    throw new FluxError(400, "Invalid Authorization header");
  }

  const body = await c.req.text();
  if (body.length > config.maxPayloadSize) {
    log('warn', 'payload_too_large', { fluxId: id, size: Buffer.byteLength(body) });
    throw new FluxError(400, "Data too large");
  }

  const flux = await db.query.fluxpoints.findFirst({
    where: (f, { eq }) => eq(f.id, id),
    with: { apiKey: true }
  });

  if (!flux || !flux.apiKey) {
    if (flux) {
      await db.delete(fluxpoints).where(eq(fluxpoints.id, id));
    }
    throw new FluxError(404, "Flux not found");
  }

  if (!connectionManager.checkRateLimit(id)) {
    log('warn', 'rate_limit.exceeded', { fluxId: id });
    throw new FluxError(429, "Rate limit exceeded");
  }

  if (!await verifyString(flux.apiKey.key, bearer)) {
    throw new FluxError(401, "Invalid API key");
  }

  await db.update(fluxpoints)
    .set({ data: body })
    .where(eq(fluxpoints.id, id));

  await connectionManager.broadcast(id, body);
  return c.json({ success: true });
});

app.get("/flux/:id", async (c) => {
  const id = c.req.param("id");
  const onFirst = c.req.query("onFirst") === "true";

  const flux = await db.query.fluxpoints.findFirst({
    where: (f, { eq }) => eq(f.id, id),
  });

  if (!flux) {
    throw new FluxError(404, "Flux not found");
  }

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache, no-transform');

  return streamSSE(c, async (stream) => {

    const emitter = await connectionManager.addConnection(id);

    try {
      // Send initial data if requested
      if (onFirst && flux.data !== null) {
        await stream.writeSSE({ data: flux.data });
      }

      // Send initial heartbeat
      await stream.writeSSE({ event: 'heartbeat', data: '' });

      await new Promise<void>((resolve) => {
        let resolved = false;
        let heartbeat: ReturnType<typeof setInterval>;
        let lifetime: ReturnType<typeof setTimeout>;

        const done = () => {
          if (resolved) return;
          resolved = true;
          clearInterval(heartbeat);
          clearTimeout(lifetime);
          emitter.removeAllListeners();
          connectionManager.removeConnection(id, emitter);
          resolve();
        };

        emitter.close = done;

        // Heartbeat interval
        heartbeat = setInterval(async () => {
          if (stream.aborted) return done();
          try {
            // Send as a heartbeat event with empty data
            await stream.writeSSE({ event: 'heartbeat', data: '' });
            emitter.lastActivity = Date.now();
          } catch (error) {
            log('error', 'sse.heartbeat_error', { fluxId: id, error: error instanceof Error ? error.message : String(error) });
            done();
          }
        }, config.heartbeatInterval);

        // Handle messages
        emitter.on("message", async (data: string) => {
          try {
            await stream.writeSSE({ data });
          } catch (error) {
            log('error', 'sse.write_broadcast_error', { fluxId: id, error: error instanceof Error ? error.message : String(error) });
            done();
          }
        });

        // Connection lifetime limit
        lifetime = setTimeout(done, config.maxConnectionLifetime);

        /// ensure cleanup
        c.req.raw.signal.addEventListener('abort', done);
        if (typeof stream.onAbort === 'function') stream.onAbort(done);
      });
    } catch (error) {
      log('error', 'sse.connection_error', { fluxId: id, error: error instanceof Error ? error.message : String(error) });
      connectionManager.removeConnection(id, emitter);
      throw error;
    }
  }, async (err) => {
    log('error', 'sse.error', { fluxId: id, error: err instanceof Error ? err.message : String(err) });
    throw new FluxError(500, "SSE stream error");
  });
});

app.get("/fluxpoints", async (c) => {
  const [{ value: count_ }] = await db.select({ value: count(fluxpoints.id) })
    .from(fluxpoints);
  return c.json({ count: count_ });
});

Bun.serve({
  fetch: app.fetch,
  port: Number(process.env.PORT) || 3000,
  development: Bun.env.NODE_ENV !== "production",
  idleTimeout: config.heartbeatInterval / 1000 * 2,
});

log('info', 'server.start', {
  uri: `http://${Bun.env.HOST ?? 'localhost'}:${process.env.PORT || 3000}`,
  env: Bun.env.NODE_ENV
});