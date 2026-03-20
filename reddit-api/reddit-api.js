/**
 * Skill: Reddit Autopilot — Direct API Integration
 * Template: reddit-autopilot
 *
 * Post, comment, reply, and schedule on Reddit directly
 * via the Reddit OAuth2 API (script app type).
 *
 * Required env vars:
 *   REDDIT_CLIENT_ID      — Reddit app client ID
 *   REDDIT_CLIENT_SECRET  — Reddit app client secret
 *   REDDIT_USERNAME       — Your Reddit username
 *   REDDIT_PASSWORD       — Your Reddit account password
 */

const USER_AGENT = 'ModelFitAI-Bot/1.0';

// ─── Auth ──────────────────────────────────────────────────────────────────────

async function getAccessToken() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;

  if (!clientId || !clientSecret || !username || !password) {
    throw new Error('Missing Reddit credentials. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD.');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'password',
      username,
      password,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Reddit auth failed: ${res.status}`);
  return data.access_token;
}

async function redditRequest(method, endpoint, body = null) {
  const token = await getAccessToken();

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
  };

  if (body) {
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = body instanceof URLSearchParams ? body : new URLSearchParams(body);
  }

  const res = await fetch(`https://oauth.reddit.com${endpoint}`, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Reddit API error ${res.status}`);
  return data;
}

// ─── Skills ───────────────────────────────────────────────────────────────────

/**
 * Submit a text post to a subreddit
 * @param {string} subreddit - Subreddit name (no r/ prefix)
 * @param {string} title - Post title
 * @param {string} body - Post body (markdown supported)
 */
export async function postToReddit(subreddit, title, body) {
  try {
    if (!subreddit) throw new Error('Subreddit is required');
    if (!title) throw new Error('Post title is required');
    if (!body) throw new Error('Post body is required');

    const data = await redditRequest('POST', '/api/submit', {
      sr: subreddit,
      kind: 'self',
      title,
      text: body,
      nsfw: 'false',
      spoiler: 'false',
      resubmit: 'true',
      api_type: 'json',
    });

    const postUrl = data?.json?.data?.url;
    const errors = data?.json?.errors;
    if (errors?.length) throw new Error(errors[0][1]);
    if (!postUrl) throw new Error('Post submitted but no URL returned');

    return {
      success: true,
      data: { url: postUrl, subreddit, title },
      summary: `✅ Posted to r/${subreddit}! ${postUrl}`,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Submit a link post to a subreddit
 * @param {string} subreddit - Subreddit name
 * @param {string} title - Post title
 * @param {string} url - URL to share
 */
export async function postLinkToReddit(subreddit, title, url) {
  try {
    if (!subreddit) throw new Error('Subreddit is required');
    if (!title) throw new Error('Post title is required');
    if (!url) throw new Error('URL is required');

    const data = await redditRequest('POST', '/api/submit', {
      sr: subreddit,
      kind: 'link',
      title,
      url,
      nsfw: 'false',
      resubmit: 'true',
      api_type: 'json',
    });

    const postUrl = data?.json?.data?.url;
    const errors = data?.json?.errors;
    if (errors?.length) throw new Error(errors[0][1]);
    if (!postUrl) throw new Error('Post submitted but no URL returned');

    return {
      success: true,
      data: { url: postUrl, subreddit, title },
      summary: `✅ Link posted to r/${subreddit}! ${postUrl}`,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Comment on a Reddit post or reply to a comment
 * @param {string} thingId - Full Reddit ID e.g. "t3_abc123" (post) or "t1_abc123" (comment)
 * @param {string} text - Comment body (markdown)
 */
export async function commentOnReddit(thingId, text) {
  try {
    if (!thingId) throw new Error('Post/comment ID is required (e.g. t3_abc123)');
    if (!text) throw new Error('Comment text is required');

    const data = await redditRequest('POST', '/api/comment', {
      thing_id: thingId,
      text,
      api_type: 'json',
    });

    const commentData = data?.json?.data?.things?.[0]?.data;
    const errors = data?.json?.errors;
    if (errors?.length) throw new Error(errors[0][1]);

    const commentId = commentData?.id;
    const postId = thingId.replace('t3_', '');
    const commentUrl = `https://reddit.com/comments/${postId}/_/${commentId}`;

    return {
      success: true,
      data: { commentId, url: commentUrl, thingId },
      summary: `✅ Comment posted! ${commentUrl}`,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Upvote a post or comment
 * @param {string} thingId - Full Reddit ID e.g. "t3_abc123"
 */
export async function upvote(thingId) {
  try {
    await redditRequest('POST', '/api/vote', { id: thingId, dir: '1' });
    return { success: true, summary: `⬆️ Upvoted ${thingId}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get hot/new posts from a subreddit for monitoring
 * @param {string} subreddit - Subreddit name
 * @param {string} sort - 'hot' | 'new' | 'rising' | 'top'
 * @param {number} limit - Number of posts (max 25)
 */
export async function getSubredditPosts(subreddit, sort = 'hot', limit = 10) {
  try {
    if (!subreddit) throw new Error('Subreddit is required');

    const data = await redditRequest('GET', `/r/${subreddit}/${sort}?limit=${Math.min(limit, 25)}`);
    const posts = data?.data?.children || [];

    const formatted = posts.map(p => ({
      id: p.data.name, // full ID e.g. t3_abc123
      title: p.data.title,
      author: p.data.author,
      score: p.data.score,
      numComments: p.data.num_comments,
      url: `https://reddit.com${p.data.permalink}`,
      selftext: p.data.selftext?.slice(0, 200),
      createdAt: new Date(p.data.created_utc * 1000).toISOString(),
    }));

    return {
      success: true,
      data: { posts: formatted, subreddit, sort },
      summary: `📋 Fetched ${formatted.length} ${sort} posts from r/${subreddit}`,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete one of your own posts or comments
 * @param {string} thingId - Full Reddit ID e.g. "t3_abc123"
 */
export async function deleteRedditPost(thingId) {
  try {
    if (!thingId) throw new Error('Post/comment ID is required');
    await redditRequest('POST', '/api/del', { id: thingId });
    return { success: true, summary: `🗑️ Deleted ${thingId}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get your recent post/comment history
 * @param {number} limit - Number of items (max 25)
 */
export async function getMyRedditHistory(limit = 10) {
  try {
    const username = process.env.REDDIT_USERNAME;
    if (!username) throw new Error('REDDIT_USERNAME not set');

    const data = await redditRequest('GET', `/user/${username}/submitted?limit=${Math.min(limit, 25)}`);
    const posts = data?.data?.children || [];

    const formatted = posts.map(p => ({
      id: p.data.name,
      type: p.data.name.startsWith('t1_') ? 'comment' : 'post',
      title: p.data.title || p.data.body?.slice(0, 60),
      subreddit: p.data.subreddit,
      score: p.data.score,
      url: `https://reddit.com${p.data.permalink}`,
      createdAt: new Date(p.data.created_utc * 1000).toISOString(),
    }));

    return {
      success: true,
      data: { items: formatted, count: formatted.length },
      summary: `📊 Fetched ${formatted.length} recent posts/comments`,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
