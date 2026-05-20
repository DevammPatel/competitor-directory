import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  getRecentCompetitorPosts,
  getCompanies, addCompany, updateCompany, deleteCompany,
  getPeople, addPerson, updatePerson, deletePerson,
  updateUserSettings,
  getAiReports,
  getAiReportById,
  getLatestAiReport,
  getPostsByReportId,
  getAiWeeklyReports,
  getAiWeeklyReportById,
} from "./db";
import { runCompetitorMonitoringJob } from "./services/competitorMonitoring";
import { runDailyAiReportJob } from "./services/aiReportService";
import { runWeeklyAiReportJob } from "./services/weeklyReportService";
import { dailyReportOutputSchema } from "../shared/reportTypes";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    updateSettings: protectedProcedure
      .input(z.object({ emailNotificationsEnabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await updateUserSettings(ctx.user!.openId, input);
        return { success: true };
      }),
  }),

  companies: router({
    list: publicProcedure.query(async () => {
      return getCompanies();
    }),

    add: protectedProcedure
      .input(z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(255),
        category: z.enum(["ai-context", "gtm-sales", "a16z"]).default("ai-context"),
        description: z.string().optional(),
        website: z.string().url().optional().or(z.literal("")),
        linkedin: z.string().url(),
        twitter: z.string().url().optional().or(z.literal("")),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== "admin") throw new Error("Only admins can add companies");
        const id = input.id || input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const company = await addCompany({ ...input, id, isActive: true });
        return company;
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.string(),
        name: z.string().min(1).max(255).optional(),
        category: z.enum(["ai-context", "gtm-sales", "a16z"]).optional(),
        description: z.string().optional(),
        website: z.string().optional(),
        linkedin: z.string().url().optional(),
        twitter: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== "admin") throw new Error("Only admins can update companies");
        const { id, ...data } = input;
        await updateCompany(id, data);
        return { success: true };
      }),

    remove: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== "admin") throw new Error("Only admins can delete companies");
        await deleteCompany(input.id);
        return { success: true };
      }),
  }),

  people: router({
    list: publicProcedure.query(async () => getPeople()),

    add: protectedProcedure
      .input(z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(255),
        title: z.string().optional(),
        company: z.string().optional(),
        linkedin: z.string().url(),
        twitter: z.string().url().optional().or(z.literal("")),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== "admin") throw new Error("Only admins can add people");
        const id = input.id || input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return addPerson({ ...input, id, isActive: true });
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.string(),
        name: z.string().min(1).max(255).optional(),
        title: z.string().optional(),
        company: z.string().optional(),
        linkedin: z.string().url().optional(),
        twitter: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== "admin") throw new Error("Only admins can update people");
        const { id, ...data } = input;
        await updatePerson(id, data);
        return { success: true };
      }),

    remove: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== "admin") throw new Error("Only admins can delete people");
        await deletePerson(input.id);
        return { success: true };
      }),
  }),

  competitors: router({
    getRecentPosts: protectedProcedure.query(async () => {
      // Returns every post ever collected, ordered by postedAt desc.
      // The DB is the source of truth — no time window applied.
      return getRecentCompetitorPosts();
    }),

    runMonitoringJob: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user?.role !== "admin") throw new Error("Only admins can trigger monitoring jobs");
      await runCompetitorMonitoringJob();
      return { success: true, message: "Monitoring job started" };
    }),
  }),

  reports: router({
    list: protectedProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).default(30),
        offset: z.number().min(0).default(0),
      }).optional())
      .query(async ({ input }) => {
        const limit = input?.limit ?? 30;
        const offset = input?.offset ?? 0;
        const reports = await getAiReports(limit, offset);
        return reports.map((r) => ({
          ...r,
          summaryJson: r.summaryJson ? safeParseSummaryJson(r.summaryJson) : null,
        }));
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const report = await getAiReportById(input.id);
        if (!report) return null;
        const posts = await getPostsByReportId(input.id);
        return {
          ...report,
          summaryJson: report.summaryJson ? safeParseSummaryJson(report.summaryJson) : null,
          posts,
        };
      }),

    getLatest: protectedProcedure.query(async () => {
      const report = await getLatestAiReport();
      if (!report) return null;
      const posts = report.id ? await getPostsByReportId(report.id) : [];
      return {
        ...report,
        summaryJson: report.summaryJson ? safeParseSummaryJson(report.summaryJson) : null,
        posts,
      };
    }),

    runNow: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user?.role !== "admin") throw new Error("Only admins can trigger AI report generation");
      return runDailyAiReportJob();
    }),

    listWeekly: protectedProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).default(30),
        offset: z.number().min(0).default(0),
      }).optional())
      .query(async ({ input }) => {
        const limit = input?.limit ?? 30;
        const offset = input?.offset ?? 0;
        const reports = await getAiWeeklyReports(limit, offset);
        return reports.map((r) => ({
          ...r,
          summaryJson: r.summaryJson ? safeParseSummaryJson(r.summaryJson) : null,
        }));
      }),

    getWeeklyById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const report = await getAiWeeklyReportById(input.id);
        if (!report) return null;
        return {
          ...report,
          summaryJson: report.summaryJson ? safeParseSummaryJson(report.summaryJson) : null,
          posts: [], // Weekly reports are aggregate summaries, so they don't have direct mapped posts in DB
        };
      }),

    runWeeklyNow: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user?.role !== "admin") throw new Error("Only admins can trigger AI weekly report generation");
      return runWeeklyAiReportJob();
    }),
  }),
});

function safeParseSummaryJson(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    const result = dailyReportOutputSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export type AppRouter = typeof appRouter;
