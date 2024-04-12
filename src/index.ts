/** @jsx jsx */
/** @jsxImportSource hono/jsx */

import { Hono } from 'hono';
import { EventEmitter } from 'events';
import { newFlux } from './utils';
import { db } from './db';
import { fluxes } from './db/schema';
import { count, eq, sql } from 'drizzle-orm';

import { cors } from "hono/cors";
import { streamSSE } from 'hono/streaming';
import { verifyString } from './utils/hashing';

import { serveStatic } from 'hono/bun';




const app = new Hono();

app.use("*", cors());

const eventEmitter = new EventEmitter();
interface EmitMessage {
  fluxId: string;
  data: string;
}

async function sendData(message: EmitMessage) {
  await db.update(fluxes).set({
    data: message.data
  }).where(eq(fluxes.id, message.fluxId));
  eventEmitter.emit("message", message);
}


app.get("/", serveStatic({
  path: "src/pages/index.html",
}));

app.get("/new", serveStatic({
  path: "src/pages/new.html",
}));



app.post("/new", async (c) => {
  const fluxDetails = await newFlux();
  return c.json(fluxDetails);
});

app.post("/flux/:id", async (c) => {
  const id = c.req.param("id");
  const authorization = c.req.header("Authorization");
  if (!authorization) {
    return c.json({ error: "Authorization header required" }, 400);
  }

  const bearer = authorization.split(" ")[1];
  if (!bearer) {
    return c.json({ error: "Invalid Authorization header" }, 400);
  }

  try {
    var body = await c.req.text();
  }
  catch {
    return c.json({ error: "Invalid data" }, 400);
  }

  if (body.length > 1000) {
    return c.json({ error: "Data too large" }, 400);
  }

  const flux = await db.query.fluxes.findFirst({
    where: (f, { eq }) => eq(f.id, id),
    with: {
      apiKey: true
    }
  });

  if (!flux) {
    return c.json({ error: "Flux not found" }, 404);
  }

  if (!flux.apiKey) {
    await db.delete(fluxes).where(eq(fluxes.id, id));
    return c.json({ error: "Flux not found" }, 404);
  }

  if (!await verifyString(flux.apiKey.key, bearer)) {
    return c.json({ error: "Invalid API key" }, 401);
  }


  await sendData({ fluxId: id, data: body });

  return c.json({ success: true });
});

app.get("/flux/:id", async (c) => {
  const id = c.req.param("id");
  const onFirst = c.req.query("onFirst") === "true";
  const flux = await db.query.fluxes.findFirst({
    where: (f, { eq }) => eq(f.id, id),
  });

  if (!flux) {
    return c.json({ error: "Flux not found" }, 404);
  }

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache no-transform');
  c.header('Connection', 'keep-alive');

  return streamSSE(c, async (stream) => {
    if (onFirst && flux.data !== null) {
      await stream.writeSSE({
        data: flux.data
      });
    }

    eventEmitter.on("message", async (message: EmitMessage) => {
      if (message.fluxId === flux.id) {
        await stream.writeSSE({
          data: message.data
        });
      }
    });
  });
});

app.get("/fluxpoints", async (c) => {
  const { 0: { value: count_ } } = await db.select({ value: count(fluxes.id) }).from(fluxes);
  return c.json({ count: count_ });
});

export default app;