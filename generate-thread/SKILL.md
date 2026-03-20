---
name: generate-thread
description: Generate and format multi-tweet threads for X (Twitter) from a topic or outline.
version: 1.0.0
author: ModelFitAI <skills@modelfitai.com>
license: MIT
keywords: [openclaw, skill, twitter, x, threads, content, social-media]
requires: {}
---

# Thread Generator Skill

Generate well-structured tweet threads from topics or outlines.

## Available Tools

Run with Node.js: `node {baseDir}/generate-thread.js <command> [args]`

- **generate** — Generate a thread from a topic
- **format** — Format raw text into tweet-sized chunks (max 280 chars each)

## Usage

```bash
node {baseDir}/generate-thread.js generate "AI trends in 2026"
node {baseDir}/generate-thread.js format "Long text to split into tweets..."
```
