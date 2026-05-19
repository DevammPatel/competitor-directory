import {
  createAiWeeklyReport,
  createTaskLog,
  getCompanies,
  getPeople,
  getPostsFromPastWeek,
  updateAiWeeklyReport,
  updateTaskLog,
  getUsersWithEmailEnabled,
  utcReportDate,
  utcReportDateString,
} from "../db";
import { ENV } from "../_core/env";
import { generateWeeklyCompetitorReport } from "./openaiService";
import { groupPostsForPrompt } from "./aiReportService";
import { sendWeeklyDigestEmailsBatch } from "./emailService";

const TASK_NAME = "weekly-ai-report";

export async function runWeeklyAiReportJob(): Promise<{
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

  console.log(`[${TASK_NAME}] Starting weekly AI report job for ${reportDateStr}…`);

  try {
    const taskLog = await createTaskLog({
      taskName: TASK_NAME,
      status: "running",
      startedAt: startTime,
    });
    taskLogId = taskLog?.id;

    // Fetch all posts from the past week (maximum 200 posts to avoid overwhelming the context)
    const pastWeekPosts = await getPostsFromPastWeek(200);

    if (pastWeekPosts.length === 0) {
      console.log(`[${TASK_NAME}] No posts from the past week to summarize`);

      await createAiWeeklyReport({
        reportDate,
        status: "skipped",
        postCount: 0,
        summaryMarkdown: "No competitor posts found from the past week.",
        summaryJson: JSON.stringify({
          executiveSummary: ["No competitor posts found from the past week."],
          highlights: [],
          themes: [],
          worthWatching: [],
          lowSignalDay: true,
          summaryMarkdown: "No competitor posts found from the past week.",
        }),
        model: ENV.openaiModel,
        generatedAt: new Date(),
      });

      if (taskLogId) {
        await updateTaskLog(taskLogId, {
          status: "success",
          postsFound: 0,
          completedAt: new Date(),
        });
      }

      return { status: "skipped", postCount: 0 };
    }

    const report = await createAiWeeklyReport({
      reportDate,
      status: "generating",
      postCount: pastWeekPosts.length,
    });

    if (!report) {
      throw new Error("Failed to create weekly AI report row");
    }

    const [companies, people] = await Promise.all([getCompanies(), getPeople()]);
    const entities = groupPostsForPrompt(pastWeekPosts, companies, people);

    const result = await generateWeeklyCompetitorReport({
      reportDate: reportDateStr,
      entities,
    });

    await updateAiWeeklyReport(report.id, {
      status: "success",
      postCount: pastWeekPosts.length,
      summaryMarkdown: result.output.summaryMarkdown,
      summaryJson: JSON.stringify(result.output),
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      generatedAt: new Date(),
    });

    // Send weekly digest email to subscribers
    try {
      const subscribers = await getUsersWithEmailEnabled();
      const validSubscribers = subscribers.filter(s => !!s.email);
      if (validSubscribers.length > 0) {
        const emailsSent = await sendWeeklyDigestEmailsBatch(
          validSubscribers,
          reportDateStr,
          result.output.summaryMarkdown
        );
        console.log(`[${TASK_NAME}] Emailed weekly AI report to ${emailsSent}/${validSubscribers.length} subscribers`);
        
        if (taskLogId) {
          await updateTaskLog(taskLogId, {
            emailsSent,
          });
        }
      }
    } catch (emailError) {
      console.error(`[${TASK_NAME}] Failed to send weekly AI report emails:`, emailError);
    }

    if (taskLogId) {
      await updateTaskLog(taskLogId, {
        status: "success",
        postsFound: pastWeekPosts.length,
        completedAt: new Date(),
      });
    }

    console.log(
      `[${TASK_NAME}] Weekly Report #${report.id} generated (${pastWeekPosts.length} posts, ` +
      `${result.promptTokens}+${result.completionTokens} tokens)`,
    );

    return { status: "success", reportId: report.id, postCount: pastWeekPosts.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${TASK_NAME}] Weekly job failed:`, error);

    await createAiWeeklyReport({
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
