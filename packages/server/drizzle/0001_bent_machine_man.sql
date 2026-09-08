CREATE TABLE `assembly_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `character_lorebooks` (
	`character_id` text NOT NULL,
	`book_id` text NOT NULL,
	PRIMARY KEY(`character_id`, `book_id`),
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `lorebooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lorebook_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`uid` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `lorebooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lorebooks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_global` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `plan_id` text REFERENCES assembly_plans(id);--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `last_messages` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `sampling` text DEFAULT '{}' NOT NULL;