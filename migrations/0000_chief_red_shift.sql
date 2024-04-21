CREATE TABLE `api_keys` (
	`flux_id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`valid_until` integer,
	FOREIGN KEY (`flux_id`) REFERENCES `fluxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fluxes` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text,
	`created_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_unique` ON `api_keys` (`key`);