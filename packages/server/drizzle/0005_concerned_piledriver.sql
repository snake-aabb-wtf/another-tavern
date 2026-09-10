CREATE TABLE `session_members` (
	`session_id` text NOT NULL,
	`character_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`muted` integer DEFAULT 0 NOT NULL,
	`talkativeness` integer DEFAULT 50 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`session_id`, `character_id`),
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `kind` text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `group_settings` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `speaker_character_id` text REFERENCES characters(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `speaker_name` text;--> statement-breakpoint
INSERT INTO `session_members` (`session_id`, `character_id`, `position`, `muted`, `talkativeness`, `created_at`)
SELECT `id`, `character_id`, 0, 0, 50, `created_at`
FROM `chat_sessions`;--> statement-breakpoint
UPDATE `messages`
SET `speaker_character_id` = (
	SELECT `character_id` FROM `chat_sessions` WHERE `chat_sessions`.`id` = `messages`.`session_id`
),
`speaker_name` = (
	SELECT `characters`.`name`
	FROM `chat_sessions`
	JOIN `characters` ON `characters`.`id` = `chat_sessions`.`character_id`
	WHERE `chat_sessions`.`id` = `messages`.`session_id`
)
WHERE `role` = 'assistant';
