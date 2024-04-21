import { db } from "../db";
import { apiKeys, fluxpoints } from "../db/schema";
import { hashString } from "./hashing";

export async function newFlux(
    database = db
) {
    const apiKeyString = generateApiKey();

    const [flux] = await database.insert(fluxpoints).values({
        data: null,
    }).onConflictDoUpdate({
        set: {
            data: null,
        },
        target: [fluxpoints.id]
    }).returning();

    const [apiKey] = await database.insert(apiKeys).values({
        key: await hashString(apiKeyString),
        fluxId: flux.id,
    }).returning();

    return {
        id: flux.id,
        key: apiKeyString,
    };
}

export function generateApiKey() {
    return crypto.randomUUID().replace(/-/g, '');
}