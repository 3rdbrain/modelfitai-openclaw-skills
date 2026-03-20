# OpenClaw Skills by ModelFitAI

Modular skills for [OpenClaw](https://openclaw.ai) agents — installable via [ClawHub](https://clawhub.ai).

```bash
npx clawhub@latest install @modelfitai/<skill-name>
```

---

## Skills

### Social Media
| Skill | Description |
|-------|-------------|
| [reddit-api](./reddit-api/) | Post, comment, upvote on Reddit via OAuth2 |
| [x-api](./x-api/) | Post tweets, manage follows via X OAuth2 |
| [generate-thread](./generate-thread/) | Split content into 280-char tweet threads |

### Lead Generation
| Skill | Description |
|-------|-------------|
| [reddit-prospecting](./reddit-prospecting/) | Find buying-intent leads on Reddit |
| [x-prospecting](./x-prospecting/) | Find leads on X/Twitter, enrich with Brave Search |
| [outreach-crm](./outreach-crm/) | Local JSON CRM — track leads, export CSV |

### Customer Support
| Skill | Description |
|-------|-------------|
| [ticket-routing](./ticket-routing/) | Categorize tickets by priority/sentiment |

### Product Hunt
| Skill | Description |
|-------|-------------|
| [track-upvotes](./track-upvotes/) | Track upvotes, rank, and comments with Telegram alerts |

### Automation
| Skill | Description |
|-------|-------------|
| [scheduler](./scheduler/) | Cron-based task scheduler for recurring agent jobs |

### VPS Security
| Skill | Description |
|-------|-------------|
| [container-monitor](./container-monitor/) | Monitor Docker CPU/memory/restarts, Telegram alerts |
| [network-enforcer](./network-enforcer/) | iptables isolation between Docker containers |
| [security-updater](./security-updater/) | Rolling updates with per-container rollback |
| [health-reporter](./health-reporter/) | Daily VPS health reports via Telegram |

---

## Usage with OpenClaw

Each skill folder contains a `SKILL.md` that tells OpenClaw how to load and invoke the skill. Reference the skill in your agent's `soul.md`:

```markdown
You have access to the reddit-prospecting skill.
Run it with: node skills/reddit-prospecting/reddit-prospecting.js search "your keyword"
```

## Requirements

- Node.js >= 18
- OpenClaw agent runtime
- Skill-specific env vars (see each skill's `SKILL.md`)

## License

MIT — [ModelFitAI](https://modelfitai.com)
