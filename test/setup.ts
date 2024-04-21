import { beforeEach, afterEach } from "bun:test";
import { LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import { migrate } from "drizzle-orm/libsql/migrator";
import { Client, createClient } from '@libsql/client';
import * as schema from '../src/db/schema';
import { db, setDb } from "../src/db";


let client: Client | null = null;

beforeEach(async () => {
    client = createClient({
        url: ":memory:"
    });

    setDb(drizzle(client, { schema }));
    await migrate(db, { migrationsFolder: "./migrations" });
});

afterEach(async () => {
    client?.close();
});