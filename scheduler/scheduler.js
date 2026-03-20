/**
 * Skill: ModelFitAI Post Scheduler
 * Used by: x-autopilot, reddit-autopilot templates
 *
 * Lets OpenClaw agents schedule posts to X or Reddit via the
 * ModelFitAI scheduler pipeline (Vercel Cron runs every 15 min).
 *
 * Required env vars:
 *   MODELFITAI_API_URL   — e.g. "https://modelfitai.com"
 *   MODELFITAI_AGENT_ID  — agent ID (set automatically at deploy time)
 *
 *   For X:
 *     X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
 *
 *   For Reddit:
 *     REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
 */

const API_BASE = process.env.MODELFITAI_API_URL || 'https://modelfitai.com';
const AGENT_ID = process.env.MODELFITAI_AGENT_ID || '';

function getXCredentials() {
  return {
    x_api_key: process.env.X_API_KEY,
    x_api_secret: process.env.X_API_SECRET,
    x_access_token: process.env.X_ACCESS_TOKEN,
    x_access_secret: process.env.X_ACCESS_SECRET,
  };
}

function getRedditCredentials() {
  return {
    reddit_client_id: process.env.REDDIT_CLIENT_ID,
    reddit_client_secret: process.env.REDDIT_CLIENT_SECRET,
    reddit_username: process.env.REDDIT_USERNAME,
    reddit_password: process.env.REDDIT_PASSWORD,
  };
}

async function callScheduler(payload) {
  const res = await fetch(`${API_BASE}/api/scheduler`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer agent-${AGENT_ID}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Scheduler API error ${res.status}`);
  return data;
}

// ─── X Scheduling ─────────────────────────────────────────────────────────────

/**
 * Schedule a single tweet via the pipeline
 * @param {string} text - Tweet text (max 280 chars)
 * @param {string} scheduledAt - ISO 8601 e.g. "2026-02-20T09:00:00Z"
 */
export async function scheduleXTweet(text, scheduledAt) {
  try {
    if (!text) throw new Error('Tweet text is required');
    if (text.length > 280) throw new Error(`Tweet too long: ${text.length}/280 chars`);

    const result = await callScheduler({
      platform: 'x',
      content: text,
      post_type: 'text',
      scheduled_at: scheduledAt,
      agent_id: AGENT_ID,
      platform_credentials: getXCredentials(),
    });

    return {
      success: true,
      data: result.data,
      summary: result.message,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Schedule a Twitter thread via the pipeline
 * @param {string[]} tweets - Array of tweet texts
 * @param {string} scheduledAt - ISO 8601 datetime
 */
export async function scheduleXThread(tweets, scheduledAt) {
  try {
    if (!Array.isArray(tweets) || tweets.length < 2) throw new Error('Thread needs at least 2 tweets');
    const overLength = tweets.find(t => t.length > 280);
    if (overLength) throw new Error(`A tweet in the thread exceeds 280 chars: "${overLength.slice(0, 50)}..."`);

    const result = await callScheduler({
      platform: 'x',
      content: tweets[0],
      thread_items: tweets,
      post_type: 'thread',
      scheduled_at: scheduledAt,
      agent_id: AGENT_ID,
      platform_credentials: getXCredentials(),
    });

    return {
      success: true,
      data: result.data,
      summary: `${result.message} — ${tweets.length} tweets`,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Schedule a reply to a tweet via the pipeline
 * @param {string} replyToTweetId - Tweet ID to reply to
 * @param {string} text - Reply text
 * @param {string} scheduledAt - ISO 8601 datetime
 */
export async function scheduleXReply(replyToTweetId, text, scheduledAt) {
  try {
    if (!replyToTweetId) throw new Error('Tweet ID to reply to is required');
    if (!text) throw new Error('Reply text is required');

    const result = await callScheduler({
      platform: 'x',
      content: text,
      post_type: 'reply',
      reply_to_id: replyToTweetId,
      scheduled_at: scheduledAt,
      agent_id: AGENT_ID,
      platform_credentials: getXCredentials(),
    });

    return { success: true, data: result.data, summary: result.message };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ─── Reddit Scheduling ────────────────────────────────────────────────────────

/**
 * Schedule a Reddit post (text/link) via the pipeline
 * @param {string} subreddit - Subreddit name (no r/ prefix)
 * @param {string} title - Post title
 * @param {string} body - Post body (markdown)
 * @param {string} scheduledAt - ISO 8601 datetime
 * @param {string} postType - 'text' or 'link'
 */
export async function scheduleRedditPost(subreddit, title, body, scheduledAt, postType = 'text') {
  try {
    if (!subreddit) throw new Error('Subreddit is required');
    if (!title) throw new Error('Reddit post title is required');
    if (!body) throw new Error('Reddit post body is required');

    const result = await callScheduler({
      platform: 'reddit',
      content: body,
      title,
      subreddit,
      post_type: postType,
      scheduled_at: scheduledAt,
      agent_id: AGENT_ID,
      platform_credentials: getRedditCredentials(),
    });

    return { success: true, data: result.data, summary: result.message };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Schedule a Reddit comment on an existing post
 * @param {string} postId - Reddit post full ID e.g. "t3_abc123"
 * @param {string} commentText - Comment body (markdown)
 * @param {string} scheduledAt - ISO 8601 datetime
 */
export async function scheduleRedditComment(postId, commentText, scheduledAt) {
  try {
    if (!postId) throw new Error('Reddit post ID is required (e.g. t3_abc123)');
    if (!commentText) throw new Error('Comment text is required');

    const result = await callScheduler({
      platform: 'reddit',
      content: commentText,
      title: 'Comment', // not used for comments
      subreddit: 'none', // not used for comments
      post_type: 'reply',
      reply_to_id: postId,
      scheduled_at: scheduledAt,
      agent_id: AGENT_ID,
      platform_credentials: getRedditCredentials(),
    });

    return { success: true, data: result.data, summary: result.message };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ─── View / Cancel Scheduled Posts ───────────────────────────────────────────

/**
 * List upcoming scheduled posts
 * @param {string} platform - 'x', 'reddit', or 'all'
 */
export async function listScheduledPosts(platform = 'all') {
  try {
    const url = new URL(`${API_BASE}/api/scheduler`);
    url.searchParams.set('status', 'pending');
    if (platform !== 'all') url.searchParams.set('platform', platform);

    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer agent-${AGENT_ID}` },
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch scheduled posts');

    const posts = data.data?.posts || [];
    const formatted = posts.map((p, i) => ({
      index: i + 1,
      id: p.id,
      platform: p.platform,
      preview: p.content?.slice(0, 60) + (p.content?.length > 60 ? '...' : ''),
      scheduledAt: new Date(p.scheduled_at).toUTCString(),
      subreddit: p.subreddit,
      title: p.title,
    }));

    return {
      success: true,
      data: { posts: formatted, count: formatted.length },
      summary: `📅 ${formatted.length} posts scheduled`,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Cancel a scheduled post by ID
 * @param {string} postId - UUID of the scheduled post
 */
export async function cancelScheduledPost(postId) {
  try {
    if (!postId) throw new Error('Post ID is required');

    const res = await fetch(`${API_BASE}/api/scheduler?id=${postId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer agent-${AGENT_ID}` },
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to cancel post');

    return { success: true, summary: `🗑️ Scheduled post ${postId} cancelled` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
