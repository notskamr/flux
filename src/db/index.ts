import { drizzle } from 'drizzle-orm/libsql';
import { Client, createClient } from '@libsql/client/web';
import * as schema from './schema';

import 'dotenv/config';

const client = (url: string, authToken?: string) => createClient({
    url: url,
    authToken: authToken
});

export const createDb = (client: Client) => drizzle(client, {
    schema
});

export let db = createDb(client(process.env.TURSO_URL!, process.env.TURSO_AUTH_TOKEN!));

export function setDb(newDb: ReturnType<typeof createDb>) {
    db = newDb;
}