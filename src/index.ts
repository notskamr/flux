import { Hono } from 'hono';
import { cors } from "hono/cors";
import { logger } from 'hono/logger';
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

// Custom error class
class FluxError extends Error {
  constructor(public status: StatusCode, message: string) {
    super(message);
  }
}

// Connection management
class ConnectionManager {
  private connections: Map<string, Set<EventEmitter>> = new Map();
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
        if ((emitter as any).lastActivity < now - config.connectionTimeout) {
          this.removeConnection(fluxId, emitter);
        }
      });
    });
  }

  async addConnection(fluxId: string): Promise<EventEmitter> {
    // Check global connection limit
    const totalConnections = Array.from(this.connectionCounts.values())
      .reduce((sum, count) => sum + count, 0);
    if (totalConnections >= config.maxConnections) {
      throw new FluxError(503, "Server at capacity");
    }

    // Check per-flux connection limit
    const currentCount = this.connectionCounts.get(fluxId) || 0;
    if (currentCount >= config.maxConnectionsPerFlux) {
      throw new FluxError(503, "Too many connections for this flux");
    }

    // Create new emitter
    const emitter = new EventEmitter();
    (emitter as any).lastActivity = Date.now();

    // Store connection
    if (!this.connections.has(fluxId)) {
      this.connections.set(fluxId, new Set());
    }
    this.connections.get(fluxId)!.add(emitter);
    this.connectionCounts.set(fluxId, currentCount + 1);

    return emitter;
  }

  removeConnection(fluxId: string, emitter: EventEmitter) {
    const emitters = this.connections.get(fluxId);
    if (emitters) {
      emitters.delete(emitter);
      const currentCount = this.connectionCounts.get(fluxId) || 0;
      this.connectionCounts.set(fluxId, currentCount - 1);

      // Cleanup if no connections remain
      if (emitters.size === 0) {
        this.connections.delete(fluxId);
        this.connectionCounts.delete(fluxId);
      }
    }
  }

  async broadcast(fluxId: string, data: string) {
    const emitters = this.connections.get(fluxId);
    if (emitters) {
      const promises = Array.from(emitters).map(async (emitter) => {
        try {
          (emitter as any).lastActivity = Date.now();
          emitter.emit("message", data);
        } catch (error) {
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

app.use(logger());

app.onError((error, c) => {
  if (error instanceof FluxError) {
    console.error('FluxError:', error);
    return c.json({ error: error.message }, error.status);
  }
  console.error('Unexpected error:', error);
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

  if (!connectionManager.checkRateLimit(id)) {
    throw new FluxError(429, "Rate limit exceeded");
  }

  const body = await c.req.text();
  if (body.length > config.maxPayloadSize) {
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
  c.header('Cache-Control', 'no-cache no-transform');
  c.header('Connection', 'keep-alive');

  return streamSSE(c, async (stream) => {
    const emitter = await connectionManager.addConnection(id);

    try {
      // Send initial data if requested
      if (onFirst && flux.data !== null) {
        await stream.writeSSE({ data: flux.data });
      }

      // Set up heartbeat
      // In the heartbeat code, instead of sending it as data, we can use an SSE comment
      const heartbeat = setInterval(async () => {
        try {
          // Send as a heartbeat event with empty data
          await stream.writeSSE({ event: 'heartbeat', data: '' });
        } catch (error) {
          clearInterval(heartbeat);
          connectionManager.removeConnection(id, emitter);
        }
      }, config.heartbeatInterval);

      // Handle messages
      emitter.on("message", async (data: string) => {
        try {
          await stream.writeSSE({ data });
        } catch (error) {
          clearInterval(heartbeat);
          connectionManager.removeConnection(id, emitter);
        }
      });

      // Cleanup on connection close
      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        connectionManager.removeConnection(id, emitter);
      });
    } catch (error) {
      connectionManager.removeConnection(id, emitter);
      throw error;
    }
  });
});

app.get("/fluxpoints", async (c) => {
  const [{ value: count_ }] = await db.select({ value: count(fluxpoints.id) })
    .from(fluxpoints);
  return c.json({ count: count_ });
});

export default app;