import type { CompetitorPost, Company, Person } from "../../drizzle/schema";
import {
  createAiReport,
  createTaskLog,
  getAiReportForDate,
  getCompanies,
  getPeople,
  getPostsNotInAnyReport,
  linkReportPosts,
  updateAiReport,
  updateTaskLog,
  utcReportDate,
  utcReportDateString,
  getUsersWithEmailEnabled,
} from "../db";
import { ENV } from "../_core/env";
import { generateCompetitorReport } from "./openaiService";
import { sendDailyAiReportEmailBatch } from "./emailService";

const MAX_POSTS_PER_RUN = 50;
const TASK_NAME = "daily-ai-report";

export function resolveEntityName(
  post: CompetitorPost,
  companiesById: Map<string, Company>,
  peopleById: Map<string, Person>,
): { name: string; type: "company" | "person" } {
  if (post.sourceType === "person" && post.personId) {
    const person = peopleById.get(post.personId);
    return { name: person?.name ?? post.authorName ?? post.personId, type: "person" };
  }
  if (post.companyId) {
    const company = companiesById.get(post.companyId);
    return { name: company?.name ?? post.authorName ?? post.companyId, type: "company" };
  }
  return { name: post.authorName ?? "Unknown", type: post.sourceType === "person" ? "person" : "company" };
}

export function groupPostsForPrompt(
  posts: CompetitorPost[],
  companies: Company[],
  people: Person[],
) {
  const companiesById = new Map(companies.map((c) => [c.id, c]));
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const groups = new Map<string, { name: string; type: "company" | "person"; posts: CompetitorPost[] }>();

  for (const post of posts) {
    const { name, type } = resolveEntityName(post, companiesById, peopleById);
    const key = `${type}:${name}`;
    const existing = groups.get(key);
    if (existing) {
      existing.posts.push(post);
    } else {
      groups.set(key, { name, type, posts: [post] });
    }
  }

  return Array.from(groups.values()).map((g) => ({
    name: g.name,
    type: g.type,
    posts: g.posts.map((p) => ({
      content: p.content ?? "",
      authorName: p.authorName,
      platform: p.platform,
      postedAt: new Date(p.postedAt).toISOString(),
      postUrl: p.postUrl,
      likeCount: p.likeCount,
      commentCount: p.commentCount,
    })),
  }));
}

export async function runDailyAiReportJob(): Promise<{
  status: "success" | "skipped" | "disabled" | "failed";
  reportId?: number;
  postCount?: number;
  error?: string;
}> {
  if (!ENV.aiReportEnabled) {
    console.log(`[${TASK_NAME}] AI reports disabled (AI_REPORT_ENABLED=false)`);
    return { status: "disabled" };
  }

  if (!ENV.openaiApiKey) {
    console.warn(`[${TASK_NAME}] OPENAI_API_KEY not set — skipping`);
    return { status: "disabled" };
  }

  const reportDate = utcReportDate();
  const reportDateStr = utcReportDateString();
  const startTime = new Date();
  let taskLogId: number | undefined;

  console.log(`[${TASK_NAME}] Starting AI report job for ${reportDateStr}…`);

  try {
    const taskLog = await createTaskLog({
      taskName: TASK_NAME,
      status: "running",
      startedAt: startTime,
    });
    taskLogId = taskLog?.id;

    const unreportedPosts = await getPostsNotInAnyReport(MAX_POSTS_PER_RUN);

    if (unreportedPosts.length === 0) {
      console.log(`[${TASK_NAME}] No new posts to summarize`);

      const existing = await getAiReportForDate(reportDateStr);
      if (!existing) {
        await createAiReport({
          reportDate,
          status: "skipped",
          postCount: 0,
          summaryMarkdown: "No new competitor posts since the last report.",
          summaryJson: JSON.stringify({
            executiveSummary: ["No new posts to analyze today."],
            highlights: [],
            themes: [],
            worthWatching: [],
            lowSignalDay: true,
            summaryMarkdown: "No new competitor posts since the last report.",
          }),
          model: ENV.openaiModel,
          generatedAt: new Date(),
        });
      }

      if (taskLogId) {
        await updateTaskLog(taskLogId, {
          status: "success",
          postsFound: 0,
          completedAt: new Date(),
        });
      }

      return { status: "skipped", postCount: 0 };
    }

    const report = await createAiReport({
      reportDate,
      status: "generating",
      postCount: unreportedPosts.length,
    });

    if (!report) {
      throw new Error("Failed to create AI report row");
    }

    const [companies, people] = await Promise.all([getCompanies(), getPeople()]);
    const entities = groupPostsForPrompt(unreportedPosts, companies, people);

    const result = await generateCompetitorReport({
      reportDate: reportDateStr,
      entities,
    });

    await updateAiReport(report.id, {
      status: "success",
      postCount: unreportedPosts.length,
      summaryMarkdown: result.output.summaryMarkdown,
      summaryJson: JSON.stringify(result.output),
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      generatedAt: new Date(),
    });

    await linkReportPosts(
      report.id,
      unreportedPosts.map((p) => p.id),
    );

    // Send email digest of the daily report
    try {
      const subscribers = await getUsersWithEmailEnabled();
      const validSubscribers = subscribers.filter(s => !!s.email);
      if (validSubscribers.length > 0) {
        const emailsSent = await sendDailyAiReportEmailBatch(
          validSubscribers,
          reportDateStr,
          result.output.summaryMarkdown
        );
        console.log(`[${TASK_NAME}] Emailed daily AI report to ${emailsSent}/${validSubscribers.length} subscribers`);
      }
    } catch (emailError) {
      console.error(`[${TASK_NAME}] Failed to send daily AI report emails:`, emailError);
    }

    if (taskLogId) {
      await updateTaskLog(taskLogId, {
        status: "success",
        postsFound: unreportedPosts.length,
        completedAt: new Date(),
      });
    }

    console.log(
      `[${TASK_NAME}] Report #${report.id} generated (${unreportedPosts.length} posts, ` +
      `${result.promptTokens}+${result.completionTokens} tokens)`,
    );

    return { status: "success", reportId: report.id, postCount: unreportedPosts.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${TASK_NAME}] Job failed:`, error);

    await createAiReport({
      reportDate,
      status: "failed",
      postCount: 0,
      error: message,
      model: ENV.openaiModel,
      generatedAt: new Date(),
    });

    if (taskLogId) {
      await updateTaskLog(taskLogId, {
        status: "failed",
        error: message,
        completedAt: new Date(),
      });
    } else {
      await createTaskLog({
        taskName: TASK_NAME,
        status: "failed",
        error: message,
        startedAt: startTime,
        completedAt: new Date(),
      });
    }

    return { status: "failed", error: message };
  }
}
