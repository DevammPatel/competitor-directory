import { boolean, date, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  emailNotificationsEnabled: boolean("emailNotificationsEnabled").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Companies table — dynamic list of competitor companies to track ──────────
export const companies = mysqlTable("companies", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  category: mysqlEnum("category", ["ai-context", "gtm-sales", "a16z"]).default("ai-context").notNull(),
  description: text("description"),
  website: varchar("website", { length: 500 }),
  linkedin: varchar("linkedin", { length: 500 }).notNull(),
  twitter: varchar("twitter", { length: 500 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Company = typeof companies.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;

// ─── People table — individual founders/executives to track ──────────────────
export const people = mysqlTable("people", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  /** Job title / role, e.g. "CEO & Co-founder" */
  title: varchar("title", { length: 255 }),
  /** Current company or affiliation */
  company: varchar("company", { length: 255 }),
  linkedin: varchar("linkedin", { length: 500 }).notNull(),
  twitter: varchar("twitter", { length: 500 }),
  notes: text("notes"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Person = typeof people.$inferSelect;
export type InsertPerson = typeof people.$inferInsert;

// ─── Competitor posts table ────────────────────────────────────────────────────
// Stores every post ever fetched — both company pages and individual profiles.
export const competitorPosts = mysqlTable("competitor_posts", {
  id: int("id").autoincrement().primaryKey(),
  /** Set when the post comes from a tracked company page. */
  companyId: varchar("companyId", { length: 64 }),
  /** Set when the post comes from a tracked individual (person). */
  personId: varchar("personId", { length: 64 }),
  /** Whether this post is from a company page or an individual profile. */
  sourceType: mysqlEnum("sourceType", ["company", "person"]).default("company").notNull(),
  platform: mysqlEnum("platform", ["linkedin", "twitter"]).notNull(),
  postId: varchar("postId", { length: 255 }).notNull().unique(),
  content: text("content").notNull(),
  authorName: varchar("authorName", { length: 255 }),
  authorUrl: text("authorUrl"),
  postUrl: text("postUrl").notNull(),
  postedAt: timestamp("postedAt").notNull(),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
  // Engagement metrics (best-effort — not all platforms expose all fields)
  likeCount: int("likeCount"),
  commentCount: int("commentCount"),
  shareCount: int("shareCount"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CompetitorPost = typeof competitorPosts.$inferSelect;
export type InsertCompetitorPost = typeof competitorPosts.$inferInsert;

// ─── Notifications table ───────────────────────────────────────────────────────
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  postId: int("postId").notNull(),
  emailSent: timestamp("emailSent"),
  emailStatus: mysqlEnum("emailStatus", ["pending", "sent", "failed"]).default("pending").notNull(),
  emailError: text("emailError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ─── Task logs ────────────────────────────────────────────────────────────────
export const taskLogs = mysqlTable("task_logs", {
  id: int("id").autoincrement().primaryKey(),
  taskName: varchar("taskName", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["running", "success", "failed"]).notNull(),
  postsFound: int("postsFound").default(0),
  emailsSent: int("emailsSent").default(0),
  error: text("error"),
  startedAt: timestamp("startedAt").notNull(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaskLog = typeof taskLogs.$inferSelect;
export type InsertTaskLog = typeof taskLogs.$inferInsert;

// ─── AI daily reports ─────────────────────────────────────────────────────────
export const aiDailyReports = mysqlTable("ai_daily_reports", {
  id: int("id").autoincrement().primaryKey(),
  reportDate: date("reportDate").notNull(),
  status: mysqlEnum("status", ["pending", "generating", "success", "failed", "skipped"]).notNull(),
  postCount: int("postCount").default(0).notNull(),
  summaryMarkdown: text("summaryMarkdown"),
  summaryJson: text("summaryJson"),
  model: varchar("model", { length: 64 }),
  promptTokens: int("promptTokens"),
  completionTokens: int("completionTokens"),
  error: text("error"),
  generatedAt: timestamp("generatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiDailyReport = typeof aiDailyReports.$inferSelect;
export type InsertAiDailyReport = typeof aiDailyReports.$inferInsert;

export const aiReportPosts = mysqlTable(
  "ai_report_posts",
  {
    id: int("id").autoincrement().primaryKey(),
    reportId: int("reportId").notNull(),
    postId: int("postId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    reportPostUnique: uniqueIndex("ai_report_posts_report_post_unique").on(table.reportId, table.postId),
  }),
);

export type AiReportPost = typeof aiReportPosts.$inferSelect;
export type InsertAiReportPost = typeof aiReportPosts.$inferInsert;

// ─── AI weekly reports ─────────────────────────────────────────────────────────
export const aiWeeklyReports = mysqlTable("ai_weekly_reports", {
  id: int("id").autoincrement().primaryKey(),
  reportDate: date("reportDate").notNull(),
  status: mysqlEnum("status", ["pending", "generating", "success", "failed", "skipped"]).notNull(),
  postCount: int("postCount").default(0).notNull(),
  summaryMarkdown: text("summaryMarkdown"),
  summaryJson: text("summaryJson"),
  model: varchar("model", { length: 64 }),
  promptTokens: int("promptTokens"),
  completionTokens: int("completionTokens"),
  error: text("error"),
  generatedAt: timestamp("generatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiWeeklyReport = typeof aiWeeklyReports.$inferSelect;
export type InsertAiWeeklyReport = typeof aiWeeklyReports.$inferInsert;
