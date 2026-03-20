/**
 * Skill: Customer Support Ticket Routing
 * Publisher: @modelfitai
 *
 * Analyze customer messages for sentiment and urgency, then route to the right handler.
 * Works as a first-pass triage layer before your AI or human agents respond.
 *
 * Commands:
 *   route "<message>"       — Route a ticket and get priority + suggested response
 *   sentiment "<message>"   — Analyze sentiment and urgency only
 *   faq "<question>"        — Check if question matches a common FAQ
 *
 * Example:
 *   node ticket-routing.js route "I can't login and I have a demo in 10 minutes!"
 *   node ticket-routing.js sentiment "Your product is terrible, I want a refund"
 *   node ticket-routing.js faq "How do I cancel my subscription?"
 *
 * No API key required.
 */

/**
 * Analyze customer message sentiment and urgency
 * @param {string} message - The customer's message
 */
export function analyzeSentiment(message) {
  if (!message) return { sentiment: 'neutral', urgency: 'low' };

  const lower = message.toLowerCase();

  // Urgency signals
  const urgentWords = ['urgent', 'asap', 'emergency', 'down', 'broken', 'cannot access', 'locked out', 'hacked', 'unauthorized', 'billing error', 'charged twice', 'data loss'];
  const frustratedWords = ['terrible', 'worst', 'angry', 'frustrated', 'unacceptable', 'ridiculous', 'disappointed', 'hate', 'useless', 'waste of money', 'scam', 'lawsuit', 'refund'];
  const positiveWords = ['thanks', 'great', 'love', 'awesome', 'amazing', 'helpful', 'excellent', 'appreciate', 'perfect', 'fantastic'];

  const urgencyScore = urgentWords.filter(w => lower.includes(w)).length;
  const frustrationScore = frustratedWords.filter(w => lower.includes(w)).length;
  const positiveScore = positiveWords.filter(w => lower.includes(w)).length;

  let sentiment, urgency, tone;

  if (frustrationScore >= 2) {
    sentiment = 'negative';
    tone = 'angry';
  } else if (frustrationScore === 1) {
    sentiment = 'negative';
    tone = 'frustrated';
  } else if (positiveScore >= 1) {
    sentiment = 'positive';
    tone = 'happy';
  } else {
    sentiment = 'neutral';
    tone = 'calm';
  }

  if (urgencyScore >= 2 || lower.includes('down') || lower.includes('hacked')) {
    urgency = 'critical';
  } else if (urgencyScore === 1 || frustrationScore >= 2) {
    urgency = 'high';
  } else if (frustrationScore === 1) {
    urgency = 'medium';
  } else {
    urgency = 'low';
  }

  return {
    sentiment,
    tone,
    urgency,
    scores: {
      urgency: urgencyScore,
      frustration: frustrationScore,
      positive: positiveScore
    }
  };
}

/**
 * Route a support ticket to the right handler
 * @param {object} ticket - Ticket containing message, userId, category
 */
export function routeTicket(ticket) {
  const { message, userId, category } = ticket;

  const analysis = analyzeSentiment(message);
  const lower = (message || '').toLowerCase();

  // Determine routing
  let route, reason, priority, suggestedResponse;

  // Critical → Human immediately
  if (analysis.urgency === 'critical') {
    route = 'human-agent';
    reason = 'Critical urgency detected';
    priority = 'P0';
    suggestedResponse = "I can see this is urgent. I'm escalating this to our senior support team right now — they'll reach out within 15 minutes.";
  }
  // Billing → Billing team
  else if (lower.includes('refund') || lower.includes('charge') || lower.includes('billing') || lower.includes('invoice') || lower.includes('payment')) {
    route = 'billing-team';
    reason = 'Billing-related inquiry';
    priority = analysis.urgency === 'high' ? 'P1' : 'P2';
    suggestedResponse = "I'll connect you with our billing team who can help with this. In the meantime, could you share your account email so they can look into it right away?";
  }
  // Angry customer → Senior agent
  else if (analysis.tone === 'angry' || analysis.frustration >= 2) {
    route = 'senior-agent';
    reason = 'Frustrated customer needs senior handling';
    priority = 'P1';
    suggestedResponse = "I completely understand your frustration, and I'm sorry for this experience. Let me get our senior support specialist involved to make this right.";
  }
  // Technical → AI or tech team
  else if (lower.includes('bug') || lower.includes('error') || lower.includes('crash') || lower.includes('not working')) {
    route = 'ai-agent';
    reason = 'Technical issue — can troubleshoot';
    priority = 'P2';
    suggestedResponse = null; // AI handles directly
  }
  // FAQ → AI handles
  else {
    route = 'ai-agent';
    reason = 'Standard query — AI can handle';
    priority = 'P3';
    suggestedResponse = null;
  }

  return {
    ticketId: `TKT-${Date.now()}`,
    route,
    reason,
    priority,
    analysis,
    suggestedResponse,
    timestamp: new Date().toISOString(),
    summary: `🎫 ${priority} → ${route} | ${reason} | Sentiment: ${analysis.sentiment}`
  };
}

/**
 * Generate FAQ response based on category
 * @param {string} question - The customer's question
 * @param {string} category - FAQ category
 */
export function matchFAQ(question, knowledgeBase = []) {
  if (!question) return { matched: false };

  const lower = question.toLowerCase();

  // Default FAQ entries (override with knowledgeBase param)
  const defaultFAQs = [
    {
      keywords: ['pricing', 'cost', 'price', 'how much', 'plan'],
      answer: 'You can view our current pricing at ${PRICING_URL}. We offer Free, Starter, Pro, and Enterprise plans.',
      category: 'pricing'
    },
    {
      keywords: ['cancel', 'cancellation', 'unsubscribe'],
      answer: 'You can cancel anytime from Settings → Billing → Cancel Subscription. Your access continues until the end of your billing period.',
      category: 'billing'
    },
    {
      keywords: ['reset password', 'forgot password', 'can\'t login', 'locked out'],
      answer: 'Click "Forgot Password" on the login page, or I can send you a reset link. Which email is on your account?',
      category: 'account'
    },
    {
      keywords: ['api key', 'api', 'integration'],
      answer: 'You can find your API key in Settings → API → Keys. Our API documentation is at ${DOCS_URL}/api.',
      category: 'technical'
    }
  ];

  const faqs = knowledgeBase.length > 0 ? knowledgeBase : defaultFAQs;

  for (const faq of faqs) {
    const matchCount = faq.keywords.filter(kw => lower.includes(kw)).length;
    if (matchCount >= 1) {
      return {
        matched: true,
        answer: faq.answer,
        category: faq.category,
        confidence: Math.min(matchCount / faq.keywords.length, 1),
        summary: `✅ FAQ match: ${faq.category} (${Math.round(matchCount / faq.keywords.length * 100)}% confidence)`
      };
    }
  }

  return {
    matched: false,
    summary: '❓ No FAQ match — needs AI or human response'
  };
}

// ─── CLI Entrypoint ────────────────────────────────────────────────────────────
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [,, cmd, ...rest] = process.argv;
  const message = rest.join(' ').replace(/^"|"$/g, '');

  if (!cmd) {
    console.log('Commands:');
    console.log('  route "<customer message>"');
    console.log('  sentiment "<customer message>"');
    console.log('  faq "<question>"');
    process.exit(0);
  }

  switch (cmd) {
    case 'route': {
      if (!message) { console.error('Usage: route "<customer message>"'); process.exit(1); }
      const result = routeTicket({ message });
      console.log(`\n${result.summary}\n`);
      console.log(`  Ticket ID : ${result.ticketId}`);
      console.log(`  Route     : ${result.route}`);
      console.log(`  Priority  : ${result.priority}`);
      console.log(`  Reason    : ${result.reason}`);
      console.log(`  Sentiment : ${result.analysis.sentiment} (${result.analysis.tone})`);
      console.log(`  Urgency   : ${result.analysis.urgency}`);
      if (result.suggestedResponse) {
        console.log(`\nSuggested response:\n  "${result.suggestedResponse}"`);
      }
      break;
    }
    case 'sentiment': {
      if (!message) { console.error('Usage: sentiment "<customer message>"'); process.exit(1); }
      const result = analyzeSentiment(message);
      console.log(`  Sentiment : ${result.sentiment}`);
      console.log(`  Tone      : ${result.tone}`);
      console.log(`  Urgency   : ${result.urgency}`);
      console.log(`  Scores    : urgency=${result.scores.urgency} frustration=${result.scores.frustration} positive=${result.scores.positive}`);
      break;
    }
    case 'faq': {
      if (!message) { console.error('Usage: faq "<question>"'); process.exit(1); }
      const result = matchFAQ(message);
      console.log(result.summary);
      if (result.matched) {
        console.log(`  Category  : ${result.category}`);
        console.log(`  Confidence: ${Math.round(result.confidence * 100)}%`);
        console.log(`  Answer    : ${result.answer}`);
      }
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      console.log('Commands: route, sentiment, faq');
      process.exit(1);
  }
}
