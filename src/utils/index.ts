import { db } from "../db";
import { apiKeys, fluxes } from "../db/schema";
import { hashString } from "./hashing";


export async function newFlux() {
    const apiKeyString = generateApiKey();

    const [flux] = await db.insert(fluxes).values({
        data: null,
    }).onConflictDoUpdate({
        set: {
            data: null,
        },
        target: [fluxes.id]
    }).returning();

    const [apiKey] = await db.insert(apiKeys).values({
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