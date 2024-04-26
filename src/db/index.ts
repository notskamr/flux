import { drizzle } from 'drizzle-orm/libsql';
import { Client, createClient } from '@libsql/client';
import * as schema from './schema';

import 'dotenv/config';
import { migrate } from 'drizzle-orm/libsql/migrator';

const client = (url: string, authToken?: string) => createClient({
    url: url,
    authToken: authToken
});

export const createDb = async (client: Client) => {
    const db = drizzle(client, {
        schema
    });
    if (client.protocol === "file" && process.env.WAL_MODE === "true") {
        await client.execute("PRAGMA journal_mode = WAL;");
    }
    return db;

};

export let db = await createDb(client(process.env.TURSO_URL!, process.env.TURSO_AUTH_TOKEN));

export function setDb(newDb: Awaited<ReturnType<typeof createDb>>) {
    db = newDb;
}