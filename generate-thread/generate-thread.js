/**
 * Skill: X / Twitter Thread Generator
 * Publisher: @modelfitai
 *
 * Generate structured tweet thread outlines with hooks, value tweets, and CTAs.
 * The agent uses these prompts to write each tweet with the AI model.
 *
 * Commands:
 *   generate <topic> [--count 5] [--tone casual]  — Generate thread structure
 *   timing [--audience tech]                       — Get best posting times
 *   validate <tweet text>                          — Check tweet length
 *
 * Example:
 *   node generate-thread.js generate "Why most SaaS pricing pages fail"
 *   node generate-thread.js generate "AI agent tips" --count 7 --tone professional
 *   node generate-thread.js timing --audience tech
 *   node generate-thread.js validate "This is my tweet text"
 *
 * No API key required.
 */

const TWEET_MAX_LENGTH = 280;

/**
 * Generate a full tweet thread on a topic
 * @param {string} topic - The topic for the thread
 * @param {number} tweetCount - Number of tweets (default: 5)
 * @param {string} tone - casual, professional, provocative (default: casual)
 */
export async function generateThread(topic, tweetCount = 5, tone = 'casual') {
  try {
    if (!topic) throw new Error('Topic is required');
    if (tweetCount < 3 || tweetCount > 15) {
      throw new Error('Thread should be 3-15 tweets');
    }

    const thread = [];

    // Tweet 1: Hook (always attention-grabbing)
    thread.push({
      position: 1,
      type: 'hook',
      prompt: `Write a scroll-stopping opening tweet about "${topic}". Make it a bold claim, surprising stat, or compelling question. Max ${TWEET_MAX_LENGTH} chars. Tone: ${tone}.`,
      guidelines: 'No hashtags in hook. End with a thread emoji 🧵 or "A thread 👇"'
    });

    // Middle tweets: Value bombs
    for (let i = 2; i < tweetCount; i++) {
      thread.push({
        position: i,
        type: 'value',
        prompt: `Tweet ${i}/${tweetCount} about "${topic}". Share one actionable insight, example, or lesson. Max ${TWEET_MAX_LENGTH} chars. Tone: ${tone}.`,
        guidelines: 'One idea per tweet. Use line breaks for readability.'
      });
    }

    // Last tweet: CTA
    thread.push({
      position: tweetCount,
      type: 'cta',
      prompt: `Final tweet of a ${tweetCount}-tweet thread about "${topic}". Summarize and include a call-to-action (follow, retweet, comment). Max ${TWEET_MAX_LENGTH} chars. Tone: ${tone}.`,
      guidelines: 'End with engagement CTA. Recap key takeaway.'
    });

    return {
      success: true,
      data: {
        topic,
        tweetCount,
        tone,
        thread,
        timestamp: new Date().toISOString()
      },
      summary: `📝 Generated ${tweetCount}-tweet thread structure about "${topic}"`
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Suggest optimal posting times based on general best practices
 * @param {string} timezone - User's timezone (default: America/Los_Angeles)
 * @param {string} audience - target audience type
 */
export async function optimalTiming(timezone = 'America/Los_Angeles', audience = 'tech') {
  const schedules = {
    tech: {
      bestDays: ['Tuesday', 'Wednesday', 'Thursday'],
      bestHours: [9, 12, 17],
      peakDay: 'Wednesday',
      avoid: ['Saturday night', 'Sunday morning']
    },
    business: {
      bestDays: ['Tuesday', 'Wednesday', 'Thursday'],
      bestHours: [8, 12, 18],
      peakDay: 'Tuesday',
      avoid: ['Weekend', 'Friday afternoon']
    },
    creator: {
      bestDays: ['Monday', 'Wednesday', 'Friday'],
      bestHours: [10, 14, 20],
      peakDay: 'Monday',
      avoid: ['Early morning', 'Late night']
    },
    general: {
      bestDays: ['Tuesday', 'Wednesday', 'Thursday'],
      bestHours: [9, 13, 17],
      peakDay: 'Wednesday',
      avoid: ['Late night', 'Sunday']
    }
  };

  const schedule = schedules[audience] || schedules.general;

  return {
    success: true,
    data: {
      ...schedule,
      timezone,
      audience,
      recommendation: `Post on ${schedule.peakDay} at ${schedule.bestHours[0]}:00 ${timezone} for peak engagement`
    },
    summary: `⏰ Best times: ${schedule.bestDays.join(', ')} at ${schedule.bestHours.map(h => `${h}:00`).join(', ')} (${timezone})`
  };
}

/**
 * Validate a tweet's length and suggest improvements
 */
export function validateTweet(text) {
  const length = text.length;
  const isValid = length <= TWEET_MAX_LENGTH;
  const hasHashtags = (text.match(/#\w+/g) || []).length;

  return {
    text,
    length,
    maxLength: TWEET_MAX_LENGTH,
    isValid,
    remaining: TWEET_MAX_LENGTH - length,
    hashtags: hasHashtags,
    suggestions: [
      ...(!isValid ? [`Over by ${length - TWEET_MAX_LENGTH} chars — needs trimming`] : []),
      ...(hasHashtags > 2 ? ['Too many hashtags (max 1-2 recommended)'] : []),
      ...(length < 100 ? ['Short tweet — consider adding more value'] : [])
    ]
  };
}

// ─── CLI Entrypoint ────────────────────────────────────────────────────────────
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [,, cmd, ...rest] = process.argv;

  const parseArgs = (args) => {
    const result = { _: [] };
    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith('--')) {
        const key = args[i].slice(2);
        result[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      } else {
        result._.push(args[i]);
      }
    }
    return result;
  };

  if (!cmd) {
    console.log('Commands:');
    console.log('  generate <topic> [--count 5] [--tone casual|professional|provocative]');
    console.log('  timing [--audience tech|business|creator|general]');
    console.log('  validate <tweet text>');
    process.exit(0);
  }

  (async () => {
    switch (cmd) {
      case 'generate': {
        const args = parseArgs(rest);
        const topic = args._.join(' ');
        if (!topic) { console.error('Usage: generate <topic> [--count 5] [--tone casual]'); process.exit(1); }
        const count = parseInt(args.count || '5');
        const tone = args.tone || 'casual';
        const result = await generateThread(topic, count, tone);
        if (!result.success) { console.error('Error:', result.error); process.exit(1); }
        console.log(`\n${result.summary}\n`);
        result.data.thread.forEach(t => {
          console.log(`--- Tweet ${t.position}/${count} [${t.type.toUpperCase()}] ---`);
          console.log(`Prompt: ${t.prompt}`);
          console.log(`Tip: ${t.guidelines}\n`);
        });
        break;
      }
      case 'timing': {
        const args = parseArgs(rest);
        const result = await optimalTiming('UTC', args.audience || 'tech');
        console.log(`\n${result.summary}\n`);
        console.log(`Best days : ${result.data.bestDays.join(', ')}`);
        console.log(`Best hours: ${result.data.bestHours.map(h => `${h}:00`).join(', ')}`);
        console.log(`Avoid     : ${result.data.avoid.join(', ')}`);
        break;
      }
      case 'validate': {
        const text = rest.join(' ');
        if (!text) { console.error('Usage: validate <tweet text>'); process.exit(1); }
        const result = validateTweet(text);
        console.log(`Length: ${result.length}/${result.maxLength} (${result.remaining} remaining)`);
        console.log(`Valid : ${result.isValid ? '✅ Yes' : '❌ No'}`);
        if (result.suggestions.length > 0) {
          console.log('Suggestions:');
          result.suggestions.forEach(s => console.log(`  • ${s}`));
        }
        break;
      }
      default:
        console.error(`Unknown command: ${cmd}`);
        console.log('Commands: generate, timing, validate');
        process.exit(1);
    }
  })();
}
