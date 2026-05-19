import { Request, Response } from "express";
import { runCompetitorMonitoringJob } from "../services/competitorMonitoring";
import { runDailyAiReportJob } from "../services/aiReportService";
import { runWeeklyAiReportJob } from "../services/weeklyReportService";
import { sdk } from "../_core/sdk";
import { ENV } from "../_core/env";

/**
 * Scheduled handler for daily competitor monitoring.
 *
 * Supports two callers:
 *  - GitHub Actions: Authorization: Bearer <CRON_SECRET>
 *  - Manus heartbeat (legacy): Manus cron JWT in session cookie
 *
 * Endpoint: POST /api/scheduled/competitor-monitoring
 */
export async function scheduledCompetitorMonitoringHandler(req: Request, res: Response) {
  let taskUid: string | undefined;
  try {
    const authHeader = req.headers.authorization ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (bearerToken) {
      // GitHub Actions / external cron path
      if (!ENV.cronSecret || bearerToken !== ENV.cronSecret) {
        return res.status(403).json({ error: "Invalid cron secret" });
      }
      taskUid = "github-actions";
    } else {
      // Manus heartbeat path — keep working on Manus
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        return res.status(403).json({ error: "cron-only" });
      }
      taskUid = user.taskUid;
    }

    console.log(`[Scheduled Handler] Competitor monitoring triggered by: ${taskUid}`);

    // 1. Fetch raw posts from LinkedIn/Apify
    await runCompetitorMonitoringJob();

    // 2. Generate and email daily AI report
    let aiReport: Awaited<ReturnType<typeof runDailyAiReportJob>> | undefined;
    try {
      aiReport = await runDailyAiReportJob();
    } catch (aiError) {
      console.error("[Scheduled Handler] Daily AI report failed:", aiError);
      aiReport = {
        status: "failed",
        error: aiError instanceof Error ? aiError.message : String(aiError),
      };
    }

    // 3. Generate and email weekly AI report on Mondays (getDay() === 1)
    let weeklyReport: Awaited<ReturnType<typeof runWeeklyAiReportJob>> | undefined;
    const isMonday = new Date().getDay() === 1;
    
    if (isMonday) {
      console.log("[Scheduled Handler] Today is Monday! Triggering weekly AI report job...");
      try {
        weeklyReport = await runWeeklyAiReportJob();
      } catch (weeklyError) {
        console.error("[Scheduled Handler] Weekly AI report failed:", weeklyError);
        weeklyReport = {
          status: "failed",
          error: weeklyError instanceof Error ? weeklyError.message : String(weeklyError),
        };
      }
    }

    res.json({
      ok: true,
      message: "Competitor monitoring job completed successfully",
      taskUid,
      aiReport,
      weeklyReport,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[Scheduled Handler] Error:", error);
    res.status(500).json({ error: errorMessage, stack, context: { taskUid }, timestamp: new Date().toISOString() });
  }
}
