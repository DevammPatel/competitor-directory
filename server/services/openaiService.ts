import OpenAI from "openai";
import { ENV } from "../_core/env";
import { DAILY_REPORT_SYSTEM_PROMPT } from "../prompts/dailyReport";
import { WEEKLY_REPORT_SYSTEM_PROMPT } from "../prompts/weeklyReport";
import { DailyReportOutput, parseDailyReportOutput } from "../../shared/reportTypes";

export type ReportGenerationInput = {
  reportDate: string;
  entities: Array<{
    name: string;
    type: "company" | "person";
    posts: Array<{
      content: string;
      authorName: string | null;
      platform: string;
      postedAt: string;
      postUrl: string;
      likeCount: number | null;
      commentCount: number | null;
    }>;
  }>;
};

export type ReportGenerationResult = {
  output: DailyReportOutput;
  model: string;
  promptTokens: number;
  completionTokens: number;
};

const MAX_CONTENT_CHARS = 500;

function truncate(text: string, max = MAX_CONTENT_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

export async function generateCompetitorReport(
  input: ReportGenerationInput,
): Promise<ReportGenerationResult> {
  if (!ENV.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const client = new OpenAI({ apiKey: ENV.openaiApiKey });

  const payload = {
    reportDate: input.reportDate,
    entities: input.entities.map((e) => ({
      ...e,
      posts: e.posts.map((p) => ({
        ...p,
        content: truncate(p.content),
      })),
    })),
  };

  const response = await client.chat.completions.create({
    model: ENV.openaiModel,
    max_tokens: ENV.openaiMaxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: DAILY_REPORT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyze these competitor posts and produce today's report:\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response");
  }

  const output = parseDailyReportOutput(content);

  return {
    output,
    model: response.model ?? ENV.openaiModel,
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
  };
}

export async function generateWeeklyCompetitorReport(
  input: ReportGenerationInput,
): Promise<ReportGenerationResult> {
  if (!ENV.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const client = new OpenAI({ apiKey: ENV.openaiApiKey });

  const payload = {
    reportDate: input.reportDate,
    entities: input.entities.map((e) => ({
      ...e,
      posts: e.posts.map((p) => ({
        ...p,
        content: truncate(p.content),
      })),
    })),
  };

  const response = await client.chat.completions.create({
    model: ENV.openaiModel,
    max_tokens: ENV.openaiMaxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: WEEKLY_REPORT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyze this week's competitor posts and produce the weekly digest:\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response");
  }

  const output = parseDailyReportOutput(content);

  return {
    output,
    model: response.model ?? ENV.openaiModel,
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
  };
}
