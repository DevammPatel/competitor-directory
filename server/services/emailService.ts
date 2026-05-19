import { Resend } from "resend";
import { CompetitorPost } from "../../drizzle/schema";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.EMAIL_FROM ?? "Competitor Directory <onboarding@resend.dev>";
const APP_URL = process.env.APP_URL ?? "https://competitor-directory-production.up.railway.app";

function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function linkify(escapedText: string) {
  return escapedText.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#0284c7;text-decoration:underline;">$1</a>'
  );
}

function formatContent(content: string) {
  const escaped = escapeHtml(content);
  const linkified = linkify(escaped);
  return linkified.replace(/\n/g, "<br/>");
}

function generatePlainText(toName: string, posts: CompetitorPost[]) {
  const parts = [];
  parts.push(`Hi ${toName || "there"},\n`);
  parts.push(`Here are ${posts.length} new post${posts.length !== 1 ? "s" : ""} from your tracked competitors:\n`);
  parts.push(`--------------------------------------------------\n`);

  for (const p of posts.slice(0, 20)) {
    const authorName = p.authorName ?? p.companyId ?? "Unknown";
    const platformName = p.platform.charAt(0).toUpperCase() + p.platform.slice(1);
    const date = new Date(p.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    
    parts.push(`[${authorName}] via ${platformName} on ${date}`);
    if (p.content) {
      parts.push(`\n${p.content}`);
    } else {
      parts.push(`\n(No content provided)`);
    }
    
    const metrics = [];
    if (p.likeCount != null) metrics.push(`Likes: ${p.likeCount}`);
    if (p.commentCount != null) metrics.push(`Comments: ${p.commentCount}`);
    if (p.shareCount != null) metrics.push(`Shares: ${p.shareCount}`);
    
    if (metrics.length > 0) {
      parts.push(`\n[${metrics.join(" | ")}]`);
    }
    
    parts.push(`\nView Original Post: ${p.postUrl}\n`);
    parts.push(`--------------------------------------------------\n`);
  }

  parts.push(`\nYou are receiving this digest because you have email notifications enabled.`);
  parts.push(`Manage Notifications: ${APP_URL}/settings`);

  return parts.join("\n");
}

function generatePostRowsHtml(posts: CompetitorPost[]) {
  return posts
    .slice(0, 20)
    .map((p) => {
      const contentHtml = p.content ? formatContent(p.content) : "<i>No content provided.</i>";
      
      const metrics = [];
      if (p.likeCount != null) metrics.push(`❤️ ${p.likeCount}`);
      if (p.commentCount != null) metrics.push(`💬 ${p.commentCount}`);
      if (p.shareCount != null) metrics.push(`🔄 ${p.shareCount}`);
      
      const metricsHtml = metrics.length > 0 
        ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px solid #e2e8f0;">
             <tr>
               <td style="padding-top:12px;font-size:13px;color:#64748b;font-weight:500;">
                 ${metrics.map(m => `<span style="margin-right:16px;">${m}</span>`).join('')}
               </td>
             </tr>
           </table>`
        : '';

      const authorNameEscaped = escapeHtml(p.authorName ?? p.companyId ?? "Unknown");
      const platformName = p.platform.charAt(0).toUpperCase() + p.platform.slice(1);
      const formattedDate = new Date(p.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const avatarInitial = authorNameEscaped.charAt(0).toUpperCase();

      return `
      <tr>
        <td style="padding: 12px 0;">
          <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
              <tr>
                <td width="48" valign="middle">
                  <div style="width:40px;height:40px;border-radius:20px;background:#f1f5f9;color:#475569;font-weight:600;font-size:16px;line-height:40px;text-align:center;">
                    ${avatarInitial}
                  </div>
                </td>
                <td valign="middle">
                  <div style="font-weight:600;color:#0f172a;font-size:16px;margin-bottom:2px;">${authorNameEscaped}</div>
                  <div style="font-size:13px;color:#64748b;">
                    ${platformName} &bull; ${formattedDate}
                  </div>
                </td>
              </tr>
            </table>
            
            <div style="color:#334155;font-size:15px;line-height:1.6;white-space:normal;word-break:break-word;">
              ${contentHtml}
            </div>
            
            ${metricsHtml}
            
            <div style="margin-top:20px;">
              <a href="${p.postUrl}" style="display:inline-block;background:#f8fafc;color:#0f172a;border:1px solid #cbd5e1;padding:8px 16px;border-radius:6px;font-size:14px;font-weight:500;text-decoration:none;">
                View Original Post &rarr;
              </a>
            </div>
          </div>
        </td>
      </tr>
      `;
    })
    .join("");
}

function generateFullHtml(toName: string, postsCount: number, postRowsHtml: string) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Daily Competitor Update</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Segoe UI Symbol';-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr>
      <td align="center">
        <!-- Main Container -->
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          
          <!-- Header -->
          <tr>
            <td style="padding-bottom:24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(to right, #0f172a, #1e293b);border-radius:16px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);">
                <tr>
                  <td style="padding:32px;">
                    <div style="color:#38bdf8;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">Competitor Directory</div>
                    <div style="color:#ffffff;font-size:26px;font-weight:800;margin-bottom:8px;line-height:1.2;">Daily Intel Digest</div>
                    <div style="color:#94a3b8;font-size:15px;font-weight:500;">
                      ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Summary Intro -->
          <tr>
            <td style="padding:0 8px 16px 8px;">
              <p style="margin:0 0 8px 0;color:#334155;font-size:16px;line-height:1.5;">Hi ${toName || "there"},</p>
              <p style="margin:0;color:#334155;font-size:16px;line-height:1.5;">Here are <strong>${postsCount} new post${postsCount !== 1 ? "s" : ""}</strong> from your tracked competitors.</p>
            </td>
          </tr>

          <!-- Posts List -->
          <tr>
            <td>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${postRowsHtml}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:32px 8px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="border-top:1px solid #cbd5e1;padding-top:32px;">
                    <p style="margin:0 0 16px 0;color:#64748b;font-size:13px;line-height:1.5;">
                      You are receiving this digest because you have email notifications enabled in your <strong>Competitor Directory</strong> settings.
                    </p>
                    <p style="margin:0;">
                      <a href="${APP_URL}/settings" style="color:#0284c7;font-size:13px;font-weight:600;text-decoration:none;background-color:#e0f2fe;padding:8px 16px;border-radius:6px;display:inline-block;">Manage Notifications</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendDailyDigestEmailsBatch(
  subscribers: { email: string | null; name: string | null }[],
  posts: CompetitorPost[]
): Promise<number> {
  const validSubscribers = subscribers.filter(s => !!s.email);

  if (!resend) {
    console.log(`[Email] RESEND_API_KEY not set — would have emailed ${validSubscribers.length} subscribers with ${posts.length} posts`);
    return 0;
  }

  if (validSubscribers.length === 0 || posts.length === 0) return 0;

  // Generate the shared part of the posts HTML to save CPU
  const postRowsHtml = generatePostRowsHtml(posts);

  const batches = [];
  // Split into chunks of 100 for Resend Batch API
  const chunkSize = 100;
  for (let i = 0; i < validSubscribers.length; i += chunkSize) {
    batches.push(validSubscribers.slice(i, i + chunkSize));
  }

  let emailsSentCount = 0;
  const subject = `${posts.length} new competitor post${posts.length !== 1 ? "s" : ""} — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  for (const batch of batches) {
    const payload = batch.map(sub => {
      const html = generateFullHtml(sub.name ?? "", posts.length, postRowsHtml);
      const text = generatePlainText(sub.name ?? "", posts);
      
      return {
        from: FROM_EMAIL,
        to: sub.email!,
        subject,
        html,
        text,
        headers: {
          "List-Unsubscribe": `<${APP_URL}/settings>`
        }
      };
    });

    try {
      const { error } = await resend.batch.send(payload);
      if (error) {
        console.error("[Email] Resend batch error:", error);
      } else {
        emailsSentCount += batch.length;
      }
    } catch (err) {
      console.error("[Email] Failed to send batch:", err);
    }
  }

  return emailsSentCount;
}

function markdownToHtml(md: string): string {
  // Replace headers (from # down to ###)
  let html = md
    .replace(/^# (.*$)/gim, '<h1 style="color:#0f172a;font-size:24px;font-weight:800;margin-top:24px;margin-bottom:12px;border-bottom:1px solid #cbd5e1;padding-bottom:8px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;">$1</h1>')
    .replace(/^## (.*$)/gim, '<h2 style="color:#1e293b;font-size:18px;font-weight:700;margin-top:20px;margin-bottom:8px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;">$1</h2>')
    .replace(/^### (.*$)/gim, '<h3 style="color:#334155;font-size:15px;font-weight:600;margin-top:16px;margin-bottom:6px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;">$1</h3>')
    
    // Bold / Italic
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    
    // Unordered lists
    .replace(/^\* (.*$)/gim, '<li style="margin-left:20px;margin-bottom:6px;color:#334155;font-size:15px;line-height:1.6;">$1</li>')
    .replace(/^- (.*$)/gim, '<li style="margin-left:20px;margin-bottom:6px;color:#334155;font-size:15px;line-height:1.6;">$1</li>')
    
    // Newlines
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');

  // Convert standard markdown links [text](url) to HTML
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#0284c7;text-decoration:underline;">$1</a>');

  return html;
}

export async function sendDailyAiReportEmailBatch(
  subscribers: { email: string | null; name: string | null }[],
  dateStr: string,
  markdown: string
): Promise<number> {
  const validSubscribers = subscribers.filter(s => !!s.email);
  if (!resend || validSubscribers.length === 0 || !markdown) return 0;

  const htmlContent = markdownToHtml(markdown);
  const subject = `📊 Daily Competitor Intel Briefing — ${new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  let emailsSentCount = 0;
  const chunks = [];
  const chunkSize = 100;
  for (let i = 0; i < validSubscribers.length; i += chunkSize) {
    chunks.push(validSubscribers.slice(i, i + chunkSize));
  }

  for (const chunk of chunks) {
    const payload = chunk.map(sub => {
      const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Daily Competitor Briefing</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;text-align:left;">
          
          <!-- Header -->
          <tr>
            <td style="padding-bottom:24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(to right, #0f172a, #1e293b);border-radius:16px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
                <tr>
                  <td style="padding:32px;">
                    <div style="color:#38bdf8;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">Competitor Directory</div>
                    <div style="color:#ffffff;font-size:26px;font-weight:800;margin-bottom:8px;line-height:1.2;">Daily Intel Briefing</div>
                    <div style="color:#94a3b8;font-size:15px;font-weight:500;">
                      ${new Date(dateStr).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.05);color:#334155;font-size:15px;line-height:1.6;">
              <p style="margin-top:0;margin-bottom:20px;font-size:16px;color:#0f172a;">Hi ${sub.name || "there"},</p>
              <div>
                ${htmlContent}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:32px 8px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="text-align:center;">
                <tr>
                  <td style="border-top:1px solid #cbd5e1;padding-top:32px;">
                    <p style="margin:0 0 16px 0;color:#64748b;font-size:13px;line-height:1.5;">
                      You are receiving this intelligence report because you have email notifications enabled in your <strong>Competitor Directory</strong> settings.
                    </p>
                    <p style="margin:0;">
                      <a href="${APP_URL}/settings" style="color:#0284c7;font-size:13px;font-weight:600;text-decoration:none;background-color:#e0f2fe;padding:8px 16px;border-radius:6px;display:inline-block;">Manage Notifications</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `;

      return {
        from: FROM_EMAIL,
        to: sub.email!,
        subject,
        html: emailHtml,
        text: markdown,
        headers: {
          "List-Unsubscribe": `<${APP_URL}/settings>`
        }
      };
    });

    try {
      const { error } = await resend.batch.send(payload);
      if (error) {
        console.error("[Email] Resend batch error:", error);
      } else {
        emailsSentCount += chunk.length;
      }
    } catch (err) {
      console.error("[Email] Failed to send batch:", err);
    }
  }

  return emailsSentCount;
}

export async function sendWeeklyDigestEmailsBatch(
  subscribers: { email: string | null; name: string | null }[],
  dateStr: string,
  markdown: string
): Promise<number> {
  const validSubscribers = subscribers.filter(s => !!s.email);
  if (!resend || validSubscribers.length === 0 || !markdown) return 0;

  const htmlContent = markdownToHtml(markdown);
  const subject = `🔮 Weekly Competitor Intel Digest — W/C ${new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  let emailsSentCount = 0;
  const chunks = [];
  const chunkSize = 100;
  for (let i = 0; i < validSubscribers.length; i += chunkSize) {
    chunks.push(validSubscribers.slice(i, i + chunkSize));
  }

  for (const chunk of chunks) {
    const payload = chunk.map(sub => {
      const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Weekly Competitor Digest</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;text-align:left;">
          
          <!-- Header -->
          <tr>
            <td style="padding-bottom:24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(to right, #4f46e5, #4338ca);border-radius:16px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
                <tr>
                  <td style="padding:32px;">
                    <div style="color:#c7d2fe;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">Competitor Directory</div>
                    <div style="color:#ffffff;font-size:26px;font-weight:800;margin-bottom:8px;line-height:1.2;">Weekly Intel Digest</div>
                    <div style="color:#e0e7ff;font-size:15px;font-weight:500;">
                      Week of ${new Date(dateStr).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.05);color:#334155;font-size:15px;line-height:1.6;">
              <p style="margin-top:0;margin-bottom:20px;font-size:16px;color:#0f172a;">Hi ${sub.name || "there"},</p>
              <div>
                ${htmlContent}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:32px 8px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="text-align:center;">
                <tr>
                  <td style="border-top:1px solid #cbd5e1;padding-top:32px;">
                    <p style="margin:0 0 16px 0;color:#64748b;font-size:13px;line-height:1.5;">
                      You are receiving this intelligence report because you have email notifications enabled in your <strong>Competitor Directory</strong> settings.
                    </p>
                    <p style="margin:0;">
                      <a href="${APP_URL}/settings" style="color:#4f46e5;font-size:13px;font-weight:600;text-decoration:none;background-color:#e0e7ff;padding:8px 16px;border-radius:6px;display:inline-block;">Manage Notifications</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `;

      return {
        from: FROM_EMAIL,
        to: sub.email!,
        subject,
        html: emailHtml,
        text: markdown,
        headers: {
          "List-Unsubscribe": `<${APP_URL}/settings>`
        }
      };
    });

    try {
      const { error } = await resend.batch.send(payload);
      if (error) {
        console.error("[Email] Resend batch error:", error);
      } else {
        emailsSentCount += chunk.length;
      }
    } catch (err) {
      console.error("[Email] Failed to send batch:", err);
    }
  }

  return emailsSentCount;
}

