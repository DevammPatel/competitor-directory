import axios from "axios";
import { getCompanies, getPeople, addCompetitorPost, createTaskLog, updateTaskLog, getUsersWithEmailEnabled } from "../db";
import { sendDailyDigestEmailsBatch } from "./emailService";
import { ENV } from "../_core/env";
import type { Company, Person } from "../../drizzle/schema";

// ─── Apify helpers ────────────────────────────────────────────────────────────

async function runApifyActor(actorId: string, input: object): Promise<any[]> {
  if (!ENV.apifyApiKey) {
    console.warn(`[Apify] APIFY_API_KEY not set — skipping ${actorId}`);
    return [];
  }

  try {
    const slug = actorId.replace("/", "~");
    const response = await axios.post(
      `https://api.apify.com/v2/acts/${slug}/run-sync-get-dataset-items`,
      input,
      {
        params: { token: ENV.apifyApiKey },
        headers: { "Content-Type": "application/json" },
        timeout: 5 * 60 * 1000,
      }
    );
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.error(`[Apify] Actor ${actorId} failed:`, error);
    return [];
  }
}

// ─── Engagement helpers ───────────────────────────────────────────────────────

/** Extract like/reaction count from various field shapes Apify actors use. */
function pickLikeCount(item: any): number | null {
  const v =
    item.likeCount ??
    item.numLikes ??
    item.likes ??
    item.reactions?.numReactions ??
    item.numReactions ??
    item.totalReactionCount ??
    null;
  return typeof v === "number" ? v : null;
}

function pickCommentCount(item: any): number | null {
  const v =
    item.commentCount ??
    item.numComments ??
    item.comments ??
    item.totalSocialActivityCounts?.numComments ??
    null;
  return typeof v === "number" ? v : null;
}

function pickShareCount(item: any): number | null {
  const v =
    item.shareCount ??
    item.numShares ??
    item.shares ??
    item.totalSocialActivityCounts?.numShares ??
    null;
  return typeof v === "number" ? v : null;
}

// ─── LinkedIn Company Posts ───────────────────────────────────────────────────

function extractLinkedInSlug(url: string): string {
  return url.replace(/\/$/, "").replace(/\/posts\/?$/, "").split("/").pop() ?? url;
}

async function fetchLinkedInCompanyPosts(trackedCompanies: Company[]) {
  const linkedinUrls = trackedCompanies.map(c => c.linkedin);

  const items = await runApifyActor("harvestapi/linkedin-company-posts", {
    targetUrls: linkedinUrls,
    maxPosts: 10,
    postedLimit: "week",
    scrapeReactions: true,
    scrapeComments: false,
  });

  return items.flatMap(item => {
    const postUrl: string | undefined = item.linkedinUrl ?? item.postUrl ?? item.url;
    if (!postUrl) {
      return [];
    }

    const urlLower = postUrl.toLowerCase();

    // Filter out comments, reactions, shares, etc.
    if (
      item.isComment === true ||
      urlLower.includes("/recent-activity/shares") ||
      urlLower.includes("/recent-activity/comments") ||
      urlLower.includes("/detail/recent-activity") ||
      urlLower.includes("comment") ||
      urlLower.includes("reply") ||
      (typeof item.action === "string" && item.action.toLowerCase().includes("comment")) ||
      (typeof item.type === "string" && item.type.toLowerCase().includes("comment")) ||
      (typeof item.postType === "string" && item.postType.toLowerCase().includes("comment"))
    ) {
      return [];
    }

    const rawAuthorUrl: string = item.author?.linkedinUrl ?? item.authorUrl ?? item.companyUrl ?? "";
    const cleanedAuthorUrl = rawAuthorUrl.replace(/\/posts\/?$/, "");
    const itemSlug = extractLinkedInSlug(cleanedAuthorUrl);

    const company = trackedCompanies.find(c =>
      extractLinkedInSlug(c.linkedin) === itemSlug || c.linkedin.includes(itemSlug)
    );
    if (!company || urlLower === company.linkedin.toLowerCase()) return [];

    const postedAtRaw = item.postedAt?.date ?? item.postedAt ?? item.publishedAt ?? item.date;

    return [{
      companyId: company.id,
      personId: null,
      sourceType: "company" as const,
      platform: "linkedin" as const,
      postId: `linkedin-company-${item.id ?? item.activityId ?? postUrl}`,
      content: item.content ?? item.text ?? "",
      authorName: item.author?.name ?? item.authorName ?? company.name,
      authorUrl: cleanedAuthorUrl || company.linkedin,
      postUrl,
      postedAt: new Date(postedAtRaw ?? Date.now()),
      likeCount: pickLikeCount(item),
      commentCount: pickCommentCount(item),
      shareCount: pickShareCount(item),
    }];
  });
}

// ─── LinkedIn Individual Profile Posts ───────────────────────────────────────

async function fetchLinkedInPersonPosts(trackedPeople: Person[]) {
  if (trackedPeople.length === 0) return [];

  const profileUrls = trackedPeople.map(p => p.linkedin);

  const items = await runApifyActor("harvestapi/linkedin-profile-posts", {
    profileUrls,
    maxPosts: 10,
    postedLimit: "week",
    scrapeReactions: true,
    scrapeComments: false,
  });

  return items.flatMap(item => {
    const postUrl: string | undefined = item.linkedinUrl ?? item.postUrl ?? item.url;
    if (!postUrl) {
      return [];
    }

    const urlLower = postUrl.toLowerCase();

    // Filter out comments, reactions, shares, etc.
    if (
      item.isComment === true ||
      urlLower.includes("/recent-activity/shares") ||
      urlLower.includes("/recent-activity/comments") ||
      urlLower.includes("/detail/recent-activity") ||
      urlLower.includes("comment") ||
      urlLower.includes("reply") ||
      (typeof item.action === "string" && item.action.toLowerCase().includes("comment")) ||
      (typeof item.type === "string" && item.type.toLowerCase().includes("comment")) ||
      (typeof item.postType === "string" && item.postType.toLowerCase().includes("comment"))
    ) {
      return [];
    }

    const rawAuthorUrl: string = item.author?.linkedinUrl ?? item.authorUrl ?? item.profileUrl ?? "";
    const cleanedAuthorUrl = rawAuthorUrl.replace(/\/recent-activity.*$/, "").replace(/\/posts\/?$/, "");
    const itemSlug = extractLinkedInSlug(cleanedAuthorUrl);

    const person = trackedPeople.find(p =>
      extractLinkedInSlug(p.linkedin) === itemSlug || p.linkedin.includes(itemSlug)
    );
    if (!person || urlLower === person.linkedin.toLowerCase()) return [];

    const postedAtRaw = item.postedAt?.date ?? item.postedAt ?? item.publishedAt ?? item.date;

    return [{
      companyId: null,
      personId: person.id,
      sourceType: "person" as const,
      platform: "linkedin" as const,
      postId: `linkedin-person-${item.id ?? item.activityId ?? postUrl}`,
      content: item.content ?? item.text ?? "",
      authorName: item.author?.name ?? item.authorName ?? person.name,
      authorUrl: cleanedAuthorUrl || person.linkedin,
      postUrl,
      postedAt: new Date(postedAtRaw ?? Date.now()),
      likeCount: pickLikeCount(item),
      commentCount: pickCommentCount(item),
      shareCount: pickShareCount(item),
    }];
  });
}

// ─── Twitter/X ────────────────────────────────────────────────────────────────

async function fetchTwitterPosts() {
  // Twitter/X blocks Apify free-tier proxies — skip to avoid wasting time/credits
  console.log("[Twitter] Skipping Twitter scraping (X anti-scraping blocks free proxies)");
  return [];
}

// ─── Main job ─────────────────────────────────────────────────────────────────

export async function runCompetitorMonitoringJob() {
  const startTime = new Date();
  const taskName = "daily-competitor-monitoring";

  console.log(`[${taskName}] Starting competitor monitoring job…`);

  try {
    const taskLog = await createTaskLog({
      taskName,
      status: "running",
      startedAt: startTime,
    });

    if (!taskLog) console.warn(`[${taskName}] No DB — task log skipped, continuing`);

    const [trackedCompanies, trackedPeople] = await Promise.all([
      getCompanies(),
      getPeople(),
    ]);

    console.log(`[${taskName}] Tracking ${trackedCompanies.length} companies, ${trackedPeople.length} people`);

    const [companyPosts, personPosts, twitterPosts] = await Promise.all([
      fetchLinkedInCompanyPosts(trackedCompanies),
      fetchLinkedInPersonPosts(trackedPeople),
      fetchTwitterPosts(),
    ]);

    const allPosts = [...companyPosts, ...personPosts, ...twitterPosts];
    console.log(
      `[${taskName}] Fetched ${allPosts.length} posts ` +
      `(${companyPosts.length} company LinkedIn, ${personPosts.length} person LinkedIn, ${twitterPosts.length} Twitter)`
    );

    const insertedPostIds: number[] = [];
    for (const post of allPosts) {
      const added = await addCompetitorPost(post as any);
      if (added) insertedPostIds.push(added.id);
    }

    const postsAdded = insertedPostIds.length;
    console.log(`[${taskName}] Added ${postsAdded} new posts`);



    if (taskLog) {
      await updateTaskLog(taskLog.id, {
        status: "success",
        postsFound: postsAdded,
        completedAt: new Date(),
      });
    }

    console.log(`[${taskName}] Job completed successfully`);
  } catch (error) {
    console.error(`[${taskName}] Job failed:`, error);
    await createTaskLog({
      taskName,
      status: "failed",
      error: String(error),
      startedAt: startTime,
      completedAt: new Date(),
    });
  }
}
