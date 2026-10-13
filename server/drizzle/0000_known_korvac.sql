CREATE TABLE `best_scores` (
	`board` text NOT NULL,
	`player_id` text NOT NULL,
	`score` integer NOT NULL,
	`achieved_at` integer NOT NULL,
	`run_id` text NOT NULL,
	PRIMARY KEY(`board`, `player_id`),
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `best_scores_ranking` ON `best_scores` (`board`,`score`,`achieved_at`,`player_id`);--> statement-breakpoint
CREATE INDEX `best_scores_player` ON `best_scores` (`player_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`nickname` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_token_hash` ON `players` (`token_hash`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limits_expiry` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`board` text NOT NULL,
	`started_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_score` integer DEFAULT -1 NOT NULL,
	`last_submitted_at` integer DEFAULT 0 NOT NULL,
	`submissions` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_player` ON `runs` (`player_id`);--> statement-breakpoint
CREATE INDEX `runs_expiry` ON `runs` (`expires_at`);