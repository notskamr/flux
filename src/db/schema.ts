import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

export const apiKeys = sqliteTable("api_keys", {
    fluxId: text("flux_id").primaryKey().notNull().references(() => fluxpoints.id, { onDelete: "cascade" }),
    key: text("key").notNull().unique(),
    validUntil: integer("valid_until"),
});

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
    flux: one(fluxpoints, {
        fields: [apiKeys.fluxId],
        references: [fluxpoints.id]
    }),
}));

export const fluxpoints = sqliteTable("fluxes", {
    id: text("id").primaryKey().notNull().$defaultFn(() => Math.random().toString(36).slice(2)),
    data: text("data"),
    createdAt: text("created_at").$defaultFn(() => sql`(CURRENT_TIMESTAMP)`),
});

export const fluxpointsRelations = relations(fluxpoints, ({ one }) => ({
    apiKey: one(apiKeys, {
        fields: [fluxpoints.id],
        references: [apiKeys.fluxId]
    }),
}));