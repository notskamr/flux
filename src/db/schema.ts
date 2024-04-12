import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

export const apiKeys = sqliteTable("api_keys", {
    fluxId: text("flux_id").primaryKey().notNull().references(() => fluxes.id, { onDelete: "cascade" }),
    key: text("key").notNull().unique(),
    validUntil: integer("valid_until"),
});

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
    flux: one(fluxes, {
        fields: [apiKeys.fluxId],
        references: [fluxes.id]
    }),
}));

export const fluxes = sqliteTable("fluxes", {
    id: text("id").primaryKey().notNull().$defaultFn(() => Math.random().toString(36).slice(2)),
    data: text("data"),
});

export const fluxesRelations = relations(fluxes, ({ one }) => ({
    apiKey: one(apiKeys, {
        fields: [fluxes.id],
        references: [apiKeys.fluxId]
    }),
}));