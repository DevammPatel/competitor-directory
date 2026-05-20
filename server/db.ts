import { desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  competitorPosts, CompetitorPost, InsertCompetitorPost,
  notifications, Notification, InsertNotification,
  taskLogs, TaskLog, InsertTaskLog,
  companies, Company, InsertCompany,
  people, Person, InsertPerson,
  aiDailyReports, AiDailyReport, InsertAiDailyReport,
  aiReportPosts, InsertAiReportPost,
  aiWeeklyReports, AiWeeklyReport, InsertAiWeeklyReport,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Auto-migration on startup ────────────────────────────────────────────────
// Inline migrations — no file I/O so this works reliably inside Railway's container.
// Each step is idempotent: errors for "already exists / duplicate column" are swallowed.

// Drizzle wraps MySQL errors: the MySQL error code is on err.code or err.cause.code,
// NOT in err.message (which just says "Failed query: ...").
const IDEMPOTENT_CODES = new Set([
  "ER_DUP_FIELDNAME",      // column already exists
  "ER_TABLE_EXISTS_ERROR", // table already exists
  "ER_DUP_KEYNAME",        // index already exists
]);

async function runSql(db: ReturnType<typeof drizzle>, statement: string): Promise<void> {
  try {
    await db.execute(sql.raw(statement));
  } catch (err: any) {
    const code: string = err?.code ?? err?.cause?.code ?? "";
    const msg: string = (err?.message ?? "") + (err?.cause?.sqlMessage ?? "");
    if (IDEMPOTENT_CODES.has(code) || msg.includes("Duplicate column") || msg.includes("already exists")) {
      return; // already applied — safe to skip
    }
    throw err;
  }
}

export async function runMigrations(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Migrations] No database — skipping");
    return;
  }

  try {
    console.log("[Migrations] Running startup migrations…");

    // ── 0001: companies table + emailNotificationsEnabled (already applied on existing DBs,
    //          but safe to re-run thanks to IF NOT EXISTS / idempotent runSql)
    await runSql(db, `
      CREATE TABLE IF NOT EXISTS companies (
        id varchar(64) NOT NULL,
        name varchar(255) NOT NULL,
        category enum('ai-context','gtm-sales','a16z') NOT NULL DEFAULT 'ai-context',
        description text,
        website varchar(500),
        linkedin varchar(500) NOT NULL,
        twitter varchar(500),
        isActive boolean NOT NULL DEFAULT true,
        createdAt timestamp NOT NULL DEFAULT (now()),
        updatedAt timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT companies_id PRIMARY KEY (id)
      )
    `);
    await runSql(db, `ALTER TABLE users ADD COLUMN emailNotificationsEnabled boolean NOT NULL DEFAULT true`);

    // ── 0002: people table + engagement columns on competitor_posts
    await runSql(db, `
      CREATE TABLE IF NOT EXISTS people (
        id varchar(64) NOT NULL,
        name varchar(255) NOT NULL,
        title varchar(255),
        company varchar(255),
        linkedin varchar(500) NOT NULL,
        twitter varchar(500),
        notes text,
        isActive boolean NOT NULL DEFAULT true,
        createdAt timestamp NOT NULL DEFAULT (now()),
        updatedAt timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT people_id PRIMARY KEY (id)
      )
    `);

    // Make companyId nullable (was NOT NULL)
    await runSql(db, `ALTER TABLE competitor_posts MODIFY COLUMN companyId varchar(64) DEFAULT NULL`);

    // New columns on competitor_posts — each individually so partial failures don't block the rest
    await runSql(db, `ALTER TABLE competitor_posts ADD COLUMN personId varchar(64) DEFAULT NULL AFTER companyId`);
    await runSql(db, `ALTER TABLE competitor_posts ADD COLUMN sourceType enum('company','person') NOT NULL DEFAULT 'company' AFTER personId`);
    await runSql(db, `ALTER TABLE competitor_posts ADD COLUMN likeCount int DEFAULT NULL`);
    await runSql(db, `ALTER TABLE competitor_posts ADD COLUMN commentCount int DEFAULT NULL`);
    await runSql(db, `ALTER TABLE competitor_posts ADD COLUMN shareCount int DEFAULT NULL`);

    // ── 0003: AI daily reports
    await runSql(db, `
      CREATE TABLE IF NOT EXISTS ai_daily_reports (
        id int AUTO_INCREMENT NOT NULL,
        reportDate date NOT NULL,
        status enum('pending','generating','success','failed','skipped') NOT NULL,
        postCount int NOT NULL DEFAULT 0,
        summaryMarkdown text,
        summaryJson text,
        model varchar(64),
        promptTokens int,
        completionTokens int,
        error text,
        generatedAt timestamp,
        createdAt timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT ai_daily_reports_id PRIMARY KEY (id)
      )
    `);
    await runSql(db, `
      CREATE TABLE IF NOT EXISTS ai_report_posts (
        id int AUTO_INCREMENT NOT NULL,
        reportId int NOT NULL,
        postId int NOT NULL,
        createdAt timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT ai_report_posts_id PRIMARY KEY (id),
        CONSTRAINT ai_report_posts_report_post_unique UNIQUE (reportId, postId)
      )
    `);

    // ── 0004: AI weekly reports
    await runSql(db, `
      CREATE TABLE IF NOT EXISTS ai_weekly_reports (
        id int AUTO_INCREMENT NOT NULL,
        reportDate date NOT NULL,
        status enum('pending','generating','success','failed','skipped') NOT NULL,
        postCount int NOT NULL DEFAULT 0,
        summaryMarkdown text,
        summaryJson text,
        model varchar(64),
        promptTokens int,
        completionTokens int,
        error text,
        generatedAt timestamp,
        createdAt timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT ai_weekly_reports_id PRIMARY KEY (id)
      )
    `);

    // Remove Attio from dataset (hard delete company + posts)
    await purgeCompanyCompletely("attio");

    // Clean up legacy comments and profile fallback URLs from competitor_posts table
    console.log("[Migrations] Purging legacy comments and reactions from competitor_posts...");
    await runSql(db, `
      DELETE FROM competitor_posts 
      WHERE postUrl IS NULL 
         OR postUrl = '' 
         OR postUrl LIKE '%/recent-activity/shares%' 
         OR postUrl LIKE '%/recent-activity/comments%'
         OR postUrl LIKE '%/detail/recent-activity%'
         OR postUrl LIKE '%comment%'
         OR postUrl LIKE '%reply%'
         OR postUrl = authorUrl
         OR postUrl = CONCAT(authorUrl, '/')
         OR authorUrl = CONCAT(postUrl, '/')
    `);

    console.log("[Migrations] ✓ All migrations applied");
  } catch (error) {
    console.error("[Migrations] Migration error (server will continue):", error);
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      values[field] = value ?? null;
      updateSet[field] = value ?? null;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateUserSettings(openId: string, settings: { emailNotificationsEnabled?: boolean }): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set(settings).where(eq(users.openId, openId));
}

export async function getUsersWithEmailEnabled(): Promise<typeof users.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.emailNotificationsEnabled, true));
}

// ─── Companies CRUD ───────────────────────────────────────────────────────────

export async function getCompanies(): Promise<Company[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(companies).where(eq(companies.isActive, true));
}

export async function addCompany(data: InsertCompany): Promise<Company | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    await db.insert(companies).values(data);
    const result = await db.select().from(companies).where(eq(companies.id, data.id)).limit(1);
    return result[0] ?? null;
  } catch (error) {
    console.error("[Database] Failed to add company:", error);
    return null;
  }
}

export async function updateCompany(id: string, data: Partial<InsertCompany>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(companies).set(data).where(eq(companies.id, id));
}

export async function deleteCompany(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(companies).set({ isActive: false }).where(eq(companies.id, id));
}

/** Hard-delete a company and all related posts, notifications, and report links. */
export async function purgeCompanyCompletely(companyId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const posts = await db
      .select({ id: competitorPosts.id })
      .from(competitorPosts)
      .where(eq(competitorPosts.companyId, companyId));

    const postIds = posts.map((p) => p.id);

    if (postIds.length > 0) {
      await db.delete(aiReportPosts).where(inArray(aiReportPosts.postId, postIds));
      await db.delete(notifications).where(inArray(notifications.postId, postIds));
    }

    await db.delete(competitorPosts).where(eq(competitorPosts.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));

    console.log(`[Database] Purged company "${companyId}" (${postIds.length} posts removed)`);
  } catch (error) {
    console.error(`[Database] Failed to purge company "${companyId}":`, error);
  }
}

export async function seedCompaniesIfEmpty(seedData: InsertCompany[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(companies).limit(1);
  if (existing.length > 0) return;
  for (const company of seedData) {
    await db.insert(companies).values(company).onDuplicateKeyUpdate({ set: { name: company.name } });
  }
}

// ─── People CRUD ──────────────────────────────────────────────────────────────

export async function getPeople(): Promise<Person[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(people).where(eq(people.isActive, true));
}

export async function addPerson(data: InsertPerson): Promise<Person | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    await db.insert(people).values(data);
    const result = await db.select().from(people).where(eq(people.id, data.id)).limit(1);
    return result[0] ?? null;
  } catch (error) {
    console.error("[Database] Failed to add person:", error);
    return null;
  }
}

export async function updatePerson(id: string, data: Partial<InsertPerson>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(people).set(data).where(eq(people.id, id));
}

export async function deletePerson(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(people).set({ isActive: false }).where(eq(people.id, id));
}

// ─── Competitor posts ─────────────────────────────────────────────────────────

export async function addCompetitorPost(post: InsertCompetitorPost): Promise<CompetitorPost | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.insert(competitorPosts).values(post);
    const inserted = await db
      .select()
      .from(competitorPosts)
      .where(eq(competitorPosts.id, Number(result[0].insertId)))
      .limit(1);
    return inserted.length > 0 ? inserted[0] : null;
  } catch (error: any) {
    // Duplicate postId — already stored from a previous run. Expected, skip silently.
    if (error?.code === "ER_DUP_ENTRY" || error?.message?.includes("Duplicate entry")) {
      return null;
    }
    console.error("[Database] Failed to add competitor post:", error);
    return null;
  }
}

export async function getRecentCompetitorPosts(_hours?: number): Promise<CompetitorPost[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const { desc, and, not, eq, like } = await import("drizzle-orm");
    // Return ALL stored posts ordered by postedAt desc, filtering out comments and profile fallbacks
    return await db
      .select()
      .from(competitorPosts)
      .where(
        and(
          not(like(competitorPosts.postUrl, "%/recent-activity/shares%")),
          not(like(competitorPosts.postUrl, "%/recent-activity/comments%")),
          not(like(competitorPosts.postUrl, "%/detail/recent-activity%")),
          not(like(competitorPosts.postUrl, "%comment%")),
          not(like(competitorPosts.postUrl, "%reply%")),
          not(eq(competitorPosts.postUrl, competitorPosts.authorUrl))
        )
      )
      .orderBy(desc(competitorPosts.postedAt));
  } catch (error) {
    console.error("[Database] Failed to get competitor posts:", error);
    return [];
  }
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function createNotification(notification: InsertNotification): Promise<Notification | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.insert(notifications).values(notification);
    const inserted = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, Number(result[0].insertId)))
      .limit(1);
    return inserted.length > 0 ? inserted[0] : null;
  } catch (error) {
    console.error("[Database] Failed to create notification:", error);
    return null;
  }
}

export async function updateNotificationStatus(
  notificationId: number,
  status: "pending" | "sent" | "failed",
  error?: string,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.update(notifications).set({
      emailStatus: status,
      emailSent: status === "sent" ? new Date() : undefined,
      emailError: error || null,
    }).where(eq(notifications.id, notificationId));
  } catch (error) {
    console.error("[Database] Failed to update notification status:", error);
  }
}

// ─── Task logs ────────────────────────────────────────────────────────────────

export async function createTaskLog(log: InsertTaskLog): Promise<TaskLog | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.insert(taskLogs).values(log);
    const inserted = await db
      .select()
      .from(taskLogs)
      .where(eq(taskLogs.id, Number(result[0].insertId)))
      .limit(1);
    return inserted.length > 0 ? inserted[0] : null;
  } catch (error) {
    console.error("[Database] Failed to create task log:", error);
    return null;
  }
}

export async function updateTaskLog(taskLogId: number, updates: Partial<TaskLog>): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.update(taskLogs).set(updates).where(eq(taskLogs.id, taskLogId));
  } catch (error) {
    console.error("[Database] Failed to update task log:", error);
  }
}

// ─── AI daily reports ─────────────────────────────────────────────────────────

function utcReportDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function parseReportDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00.000Z`);
}

function utcReportDate(d = new Date()): Date {
  return parseReportDate(utcReportDateString(d));
}

export async function getPostsNotInAnyReport(limit = 50): Promise<CompetitorPost[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const rows = await db
      .select({ post: competitorPosts })
      .from(competitorPosts)
      .leftJoin(aiReportPosts, eq(competitorPosts.id, aiReportPosts.postId))
      .where(isNull(aiReportPosts.postId))
      .orderBy(desc(competitorPosts.postedAt))
      .limit(limit);

    return rows.map((r) => r.post);
  } catch (error) {
    console.error("[Database] Failed to get unreported posts:", error);
    return [];
  }
}

export async function getPostsFromPastWeek(limit = 200): Promise<CompetitorPost[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    // We import desc/gte here since they are not at top level or we can use sql
    const { desc, gte } = await import("drizzle-orm");
    
    return await db
      .select()
      .from(competitorPosts)
      .where(gte(competitorPosts.postedAt, oneWeekAgo))
      .orderBy(desc(competitorPosts.postedAt))
      .limit(limit);
  } catch (error) {
    console.error("[Database] Failed to get posts from past week:", error);
    return [];
  }
}

export async function createAiReport(data: InsertAiDailyReport): Promise<AiDailyReport | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.insert(aiDailyReports).values(data);
    const inserted = await db
      .select()
      .from(aiDailyReports)
      .where(eq(aiDailyReports.id, Number(result[0].insertId)))
      .limit(1);
    return inserted[0] ?? null;
  } catch (error) {
    console.error("[Database] Failed to create AI report:", error);
    return null;
  }
}

export async function updateAiReport(reportId: number, updates: Partial<AiDailyReport>): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.update(aiDailyReports).set(updates).where(eq(aiDailyReports.id, reportId));
  } catch (error) {
    console.error("[Database] Failed to update AI report:", error);
  }
}

export async function linkReportPosts(reportId: number, postIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db || postIds.length === 0) return;

  const rows: InsertAiReportPost[] = postIds.map((postId) => ({ reportId, postId }));

  try {
    for (const row of rows) {
      try {
        await db.insert(aiReportPosts).values(row);
      } catch (error: any) {
        if (error?.code === "ER_DUP_ENTRY" || error?.message?.includes("Duplicate entry")) continue;
        throw error;
      }
    }
  } catch (error) {
    console.error("[Database] Failed to link report posts:", error);
  }
}

export async function getAiReports(limit = 30, offset = 0): Promise<AiDailyReport[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db
      .select()
      .from(aiDailyReports)
      .orderBy(desc(aiDailyReports.reportDate), desc(aiDailyReports.id))
      .limit(limit)
      .offset(offset);
  } catch (error) {
    console.error("[Database] Failed to list AI reports:", error);
    return [];
  }
}

export async function getAiReportById(reportId: number): Promise<AiDailyReport | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select().from(aiDailyReports).where(eq(aiDailyReports.id, reportId)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error("[Database] Failed to get AI report:", error);
    return null;
  }
}

export async function createAiWeeklyReport(data: InsertAiWeeklyReport): Promise<AiWeeklyReport | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.insert(aiWeeklyReports).values(data);
    const inserted = await db
      .select()
      .from(aiWeeklyReports)
      .where(eq(aiWeeklyReports.id, Number(result[0].insertId)))
      .limit(1);
    return inserted[0] ?? null;
  } catch (error) {
    console.error("[Database] Failed to create AI weekly report:", error);
    return null;
  }
}

export async function updateAiWeeklyReport(reportId: number, updates: Partial<AiWeeklyReport>): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.update(aiWeeklyReports).set(updates).where(eq(aiWeeklyReports.id, reportId));
  } catch (error) {
    console.error("[Database] Failed to update AI weekly report:", error);
  }
}

export async function getAiWeeklyReports(limit = 30, offset = 0): Promise<AiWeeklyReport[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db
      .select()
      .from(aiWeeklyReports)
      .orderBy(desc(aiWeeklyReports.reportDate), desc(aiWeeklyReports.id))
      .limit(limit)
      .offset(offset);
  } catch (error) {
    console.error("[Database] Failed to list AI weekly reports:", error);
    return [];
  }
}

export async function getAiWeeklyReportById(reportId: number): Promise<AiWeeklyReport | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select().from(aiWeeklyReports).where(eq(aiWeeklyReports.id, reportId)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error("[Database] Failed to get AI weekly report:", error);
    return null;
  }
}

export async function getLatestAiReport(): Promise<AiDailyReport | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select()
      .from(aiDailyReports)
      .orderBy(desc(aiDailyReports.reportDate), desc(aiDailyReports.id))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error("[Database] Failed to get latest AI report:", error);
    return null;
  }
}

export async function getAiReportForDate(reportDate: string | Date): Promise<AiDailyReport | null> {
  const db = await getDb();
  if (!db) return null;

  const dateValue = typeof reportDate === "string" ? parseReportDate(reportDate) : reportDate;

  try {
    const rows = await db
      .select()
      .from(aiDailyReports)
      .where(eq(aiDailyReports.reportDate, dateValue))
      .orderBy(desc(aiDailyReports.id))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error("[Database] Failed to get AI report for date:", error);
    return null;
  }
}

export async function getPostsByReportId(reportId: number): Promise<CompetitorPost[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const rows = await db
      .select({ post: competitorPosts })
      .from(aiReportPosts)
      .innerJoin(competitorPosts, eq(aiReportPosts.postId, competitorPosts.id))
      .where(eq(aiReportPosts.reportId, reportId))
      .orderBy(desc(competitorPosts.postedAt));

    return rows.map((r) => r.post);
  } catch (error) {
    console.error("[Database] Failed to get posts for report:", error);
    return [];
  }
}

export { utcReportDateString, utcReportDate, parseReportDate };
