import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import type { DailyReportOutput } from "@shared/reportTypes";

function formatReportDate(d: string | Date, isWeekly = false): string {
  const raw = String(d);
  const date = raw.length === 10 ? new Date(`${raw}T12:00:00Z`) : new Date(raw);
  if (isWeekly) {
    return "Week of " + date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    success: { bg: "rgb(16 185 129 / 0.12)", color: "rgb(5 150 105)" },
    skipped: { bg: "rgb(var(--ink-hair))", color: "rgb(var(--ink-muted))" },
    failed: { bg: "rgb(239 68 68 / 0.12)", color: "rgb(220 38 38)" },
    generating: { bg: "rgb(59 130 246 / 0.12)", color: "rgb(37 99 235)" },
  };
  const style = colors[status] ?? colors.skipped;
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        background: style.bg,
        color: style.color,
      }}
    >
      {status}
    </span>
  );
}

function ReportContent({
  summary,
  markdown,
}: {
  summary: DailyReportOutput | null;
  markdown: string | null;
}) {
  if (!summary && !markdown) {
    return (
      <p style={{ fontSize: 14, color: "rgb(var(--ink-muted))" }}>
        No summary content available for this report.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {summary && summary.executiveSummary.length > 0 && (
        <section>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgb(var(--ink-faint))",
              marginBottom: 12,
            }}
          >
            Executive summary
          </h2>
          <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            {summary.executiveSummary.map((bullet, i) => (
              <li key={i} style={{ fontSize: 14.5, lineHeight: 1.55, color: "rgb(var(--ink-text))" }}>
                {bullet}
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary && summary.highlights.length > 0 && (
        <section>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgb(var(--ink-faint))",
              marginBottom: 12,
            }}
          >
            Highlights
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {summary.highlights.map((h, i) => (
              <div
                key={i}
                style={{
                  padding: 16,
                  borderRadius: 8,
                  border: "1px solid rgb(var(--ink-line))",
                }}
              >
                <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "rgb(var(--ink-text))" }}>
                    {h.entityName}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "rgb(var(--ink-hair))",
                      color: "rgb(var(--ink-muted))",
                      textTransform: "capitalize",
                    }}
                  >
                    {h.entityType}
                  </span>
                </div>
                <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "rgb(var(--ink-muted))", margin: 0 }}>
                  {h.summary}
                </p>
                {h.postUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
                    {h.postUrls.slice(0, 3).map((url, j) => (
                      <a
                        key={j}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11.5, color: "rgb(var(--ink-accent))" }}
                      >
                        Source {j + 1} →
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {summary && summary.themes.length > 0 && (
        <section>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgb(var(--ink-faint))",
              marginBottom: 10,
            }}
          >
            Themes
          </h2>
          <div className="flex flex-wrap gap-2">
            {summary.themes.map((theme, i) => (
              <span
                key={i}
                style={{
                  fontSize: 12,
                  padding: "4px 10px",
                  borderRadius: 9999,
                  border: "1px solid rgb(var(--ink-line))",
                  color: "rgb(var(--ink-text))",
                }}
              >
                {theme}
              </span>
            ))}
          </div>
        </section>
      )}

      {summary && summary.worthWatching.length > 0 && (
        <section>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgb(var(--ink-faint))",
              marginBottom: 10,
            }}
          >
            Worth watching
          </h2>
          <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            {summary.worthWatching.map((item, i) => (
              <li key={i} style={{ fontSize: 13.5, color: "rgb(var(--ink-muted))" }}>
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {markdown && (
        <section>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgb(var(--ink-faint))",
              marginBottom: 10,
            }}
          >
            Full report
          </h2>
          <pre
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              color: "rgb(var(--ink-text))",
              margin: 0,
              padding: 16,
              borderRadius: 8,
              border: "1px solid rgb(var(--ink-line))",
              background: "rgb(var(--ink-hair))",
            }}
          >
            {markdown}
          </pre>
        </section>
      )}
    </div>
  );
}

type SourcePost = {
  id: number;
  authorName: string | null;
  content: string;
  postUrl: string;
  platform: string;
  postedAt: string | Date;
};

function SourcePosts({ posts }: { posts: SourcePost[] }) {
  if (!posts.length) return null;

  return (
    <section style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid rgb(var(--ink-line))" }}>
      <h2
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgb(var(--ink-faint))",
          marginBottom: 16,
        }}
      >
        Source posts ({posts.length})
      </h2>
      <div className="flex flex-col">
        {posts.map((post) => (
          <article
            key={post.id}
            style={{ padding: "16px 0", borderBottom: "1px solid rgb(var(--ink-line))" }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              {post.authorName ?? "Unknown"}
              <span style={{ fontWeight: 400, color: "rgb(var(--ink-faint))", marginLeft: 8 }}>
                {post.platform}
              </span>
            </div>
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: "rgb(var(--ink-muted))",
                margin: "0 0 8px",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {post.content}
            </p>
            <a
              href={post.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: "rgb(var(--ink-accent))" }}
            >
              View post →
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function Reports() {
  const { user, isAuthenticated } = useAuth();
  const [reportType, setReportType] = useState<"daily" | "weekly">("daily");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: list, isLoading: listLoading, refetch: refetchList } = trpc.reports.list.useQuery(
    undefined,
    { enabled: isAuthenticated && reportType === "daily" },
  );

  const { data: weeklyList, isLoading: weeklyListLoading, refetch: refetchWeeklyList } = trpc.reports.listWeekly.useQuery(
    undefined,
    { enabled: isAuthenticated && reportType === "weekly" },
  );

  const currentList = reportType === "daily" ? list : weeklyList;
  const currentListLoading = reportType === "daily" ? listLoading : weeklyListLoading;
  const refetchCurrentList = reportType === "daily" ? refetchList : refetchWeeklyList;

  const activeId = selectedId ?? currentList?.[0]?.id ?? null;

  const { data: detail, isLoading: detailLoading, refetch: refetchDetail } = trpc.reports.getById.useQuery(
    { id: activeId! },
    { enabled: isAuthenticated && reportType === "daily" && activeId != null },
  );

  const { data: weeklyDetail, isLoading: weeklyDetailLoading, refetch: refetchWeeklyDetail } = trpc.reports.getWeeklyById.useQuery(
    { id: activeId! },
    { enabled: isAuthenticated && reportType === "weekly" && activeId != null },
  );

  const currentDetail = reportType === "daily" ? detail : weeklyDetail;
  const currentDetailLoading = reportType === "daily" ? detailLoading : weeklyDetailLoading;
  const refetchCurrentDetail = reportType === "daily" ? refetchDetail : refetchWeeklyDetail;

  const { mutate: runReport } = trpc.reports.runNow.useMutation({
    onSuccess: () => {
      refetchList();
      refetchDetail();
      setIsGenerating(false);
    },
    onError: () => setIsGenerating(false),
  });

  const { mutate: runWeeklyReport } = trpc.reports.runWeeklyNow.useMutation({
    onSuccess: () => {
      refetchWeeklyList();
      refetchWeeklyDetail();
      setIsGenerating(false);
    },
    onError: () => setIsGenerating(false),
  });

  const handleGenerate = () => {
    setIsGenerating(true);
    if (reportType === "daily") {
      runReport();
    } else {
      runWeeklyReport();
    }
  };

  const handleTabChange = (type: "daily" | "weekly") => {
    setReportType(type);
    setSelectedId(null);
  };

  if (!isAuthenticated) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
          AI Reports
        </h1>
        <p style={{ marginTop: 12, color: "rgb(var(--ink-muted))" }}>
          Sign in to view daily and weekly AI-generated competitor intelligence reports.
        </p>
      </div>
    );
  }

  const summary = (currentDetail?.summaryJson ?? null) as DailyReportOutput | null;

  return (
    <div>
      <header
        className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
        style={{ marginBottom: 32 }}
      >
        <div>
          <p
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "rgb(var(--ink-accent))",
              marginBottom: 8,
            }}
          >
            Intelligence
          </p>
          <h1
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              lineHeight: 1.15,
            }}
          >
            AI Reports
          </h1>
          <p style={{ marginTop: 8, fontSize: 14, color: "rgb(var(--ink-muted))", maxWidth: 480 }}>
            {reportType === "daily"
              ? "Daily summaries of new competitor posts, generated by OpenAI after each monitoring run."
              : "Weekly aggregate briefings compiling key movements and highlights of the entire week."}
          </p>
        </div>
        {user?.role === "admin" && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="focus-ring shrink-0"
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 6,
              border: "1px solid rgb(var(--ink-line))",
              background: "rgb(var(--ink-text))",
              color: "rgb(var(--ink-bg))",
              cursor: isGenerating ? "wait" : "pointer",
              opacity: isGenerating ? 0.7 : 1,
              transition: "all 0.15s ease",
            }}
          >
            {isGenerating
              ? "Generating…"
              : `Generate ${reportType === "daily" ? "daily" : "weekly"} report`}
          </button>
        )}
      </header>

      {/* Premium Tabs Menu */}
      <div
        className="flex items-center gap-1"
        style={{
          borderBottom: "1px solid rgb(var(--ink-line))",
          marginBottom: 32,
          paddingBottom: 0,
        }}
      >
        <button
          type="button"
          onClick={() => handleTabChange("daily")}
          className="focus-ring"
          style={{
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 500,
            color: reportType === "daily" ? "rgb(var(--ink-text))" : "rgb(var(--ink-muted))",
            borderBottom: "2px solid",
            borderColor: reportType === "daily" ? "rgb(var(--ink-text))" : "transparent",
            background: "transparent",
            cursor: "pointer",
            marginBottom: -1,
            transition: "all 0.2s ease",
          }}
        >
          Daily Briefings
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("weekly")}
          className="focus-ring"
          style={{
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 500,
            color: reportType === "weekly" ? "rgb(var(--ink-text))" : "rgb(var(--ink-muted))",
            borderBottom: "2px solid",
            borderColor: reportType === "weekly" ? "rgb(var(--ink-text))" : "transparent",
            background: "transparent",
            cursor: "pointer",
            marginBottom: -1,
            transition: "all 0.2s ease",
          }}
        >
          Weekly Digests
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        <aside style={{ width: "100%", maxWidth: 280, flexShrink: 0 }}>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgb(var(--ink-faint))",
              marginBottom: 12,
            }}
          >
            Archive
          </h2>
          {currentListLoading ? (
            <p style={{ fontSize: 13, color: "rgb(var(--ink-muted))" }}>Loading…</p>
          ) : !currentList?.length ? (
            <p style={{ fontSize: 13, color: "rgb(var(--ink-muted))" }}>
              {reportType === "daily"
                ? "No reports yet. Reports are created automatically after the daily monitoring job when new posts exist."
                : "No weekly digests yet. Weekly digests are generated automatically on Monday mornings or manually by admins."}
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {currentList.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className="focus-ring w-full text-left"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 6,
                      border: "1px solid",
                      borderColor: activeId === r.id ? "rgb(var(--ink-text))" : "rgb(var(--ink-line))",
                      background: activeId === r.id ? "rgb(var(--ink-hair))" : "transparent",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span style={{ fontSize: 13, fontWeight: 500 }}>
                        {formatReportDate(String(r.reportDate), reportType === "weekly")}
                      </span>
                      <StatusBadge status={r.status} />
                    </div>
                    <span style={{ fontSize: 11.5, color: "rgb(var(--ink-faint))" }}>
                      {r.postCount} post{r.postCount !== 1 ? "s" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main style={{ flex: 1, minWidth: 0 }}>
          {currentDetailLoading && !currentDetail ? (
            <p style={{ color: "rgb(var(--ink-muted))" }}>Loading report…</p>
          ) : !currentDetail ? (
            <p style={{ color: "rgb(var(--ink-muted))" }}>Select a report from the archive.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>
                  {formatReportDate(String(currentDetail.reportDate), reportType === "weekly")}
                </h2>
                <StatusBadge status={currentDetail.status} />
                {currentDetail.postCount > 0 && (
                  <span style={{ fontSize: 12, color: "rgb(var(--ink-faint))" }}>
                    {currentDetail.postCount} posts analyzed
                  </span>
                )}
                {currentDetail.model && (
                  <span style={{ fontSize: 11, color: "rgb(var(--ink-faint))" }}>{currentDetail.model}</span>
                )}
              </div>

              {currentDetail.status === "failed" && currentDetail.error && (
                <p
                  style={{
                    padding: 12,
                    borderRadius: 6,
                    background: "rgb(239 68 68 / 0.08)",
                    color: "rgb(220 38 38)",
                    fontSize: 13,
                    marginBottom: 20,
                  }}
                >
                  {currentDetail.error}
                </p>
              )}

              {currentDetail.status === "skipped" && (
                <p style={{ fontSize: 14, color: "rgb(var(--ink-muted))", marginBottom: 20 }}>
                  {currentDetail.summaryMarkdown ?? (reportType === "daily" 
                    ? "No new posts were available to summarize for this day." 
                    : "No new posts were available to summarize for this week.")}
                </p>
              )}

              {(currentDetail.status === "success" || currentDetail.summaryJson) && (
                <ReportContent summary={summary} markdown={currentDetail.summaryMarkdown} />
              )}

              {currentDetail.posts && currentDetail.posts.length > 0 && (
                <SourcePosts posts={currentDetail.posts} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
