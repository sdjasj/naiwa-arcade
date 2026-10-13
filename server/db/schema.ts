import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const players = sqliteTable("players", {
  id: text("id").primaryKey(), tokenHash: text("token_hash").notNull(),
  nickname: text("nickname").notNull().default(""),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("players_token_hash").on(t.tokenHash)]);

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  board: text("board").notNull(), startedAt: integer("started_at").notNull(), expiresAt: integer("expires_at").notNull(),
  lastScore: integer("last_score").notNull().default(-1),
  lastSubmittedAt: integer("last_submitted_at").notNull().default(0), submissions: integer("submissions").notNull().default(0),
}, (t) => [index("runs_player").on(t.playerId), index("runs_expiry").on(t.expiresAt)]);

export const bestScores = sqliteTable("best_scores", {
  board: text("board").notNull(),
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  score: integer("score").notNull(), achievedAt: integer("achieved_at").notNull(), runId: text("run_id").notNull(),
}, (t) => [primaryKey({ columns: [t.board, t.playerId] }),
  index("best_scores_ranking").on(t.board, t.score, t.achievedAt, t.playerId), index("best_scores_player").on(t.playerId)]);

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(), windowStart: integer("window_start").notNull(), count: integer("count").notNull(), expiresAt: integer("expires_at").notNull(),
}, (t) => [index("rate_limits_expiry").on(t.expiresAt)]);
