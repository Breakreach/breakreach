# Breakreach developer and agent kit

Everything to use [Breakreach](https://www.breakreach.com) from code and from AI agents: schedule and publish social media posts to Instagram, TikTok, X, LinkedIn, YouTube, Facebook, Threads, Pinterest, Bluesky, Reddit, Telegram, Discord, Slack, Mastodon, WordPress, Ghost, Dev.to, Hashnode and Tumblr.

| | Install | |
| --- | --- | --- |
| [TypeScript SDK + CLI](typescript) | `npm install breakreach` · `npx breakreach post …` | Node 18+, no dependencies |
| [Python SDK](python) | `pip install breakreach` | Python 3.9+, standard library only |
| [Agent skill](skills/breakreach/SKILL.md) | `npx skills add breakreach/breakreach` | Claude Code, Codex, Cursor, OpenClaw and other agents that read `SKILL.md` |
| Claude Code plugin (skill + MCP server) | `claude plugin marketplace add breakreach/breakreach` then `claude plugin install breakreach@breakreach` | |
| MCP server | `https://api.breakreach.com/mcp` | hosted, OAuth; [setup per client](https://www.breakreach.com/agents) |

The SDKs are generated from the [OpenAPI spec](https://api.breakreach.com/v1/openapi.json) the API serves (a copy is in [openapi.json](openapi.json)), so every endpoint has a typed method. Both retry network errors and restarts with an `Idempotency-Key` on each POST: a retry never publishes a post twice.

```ts
import { Breakreach } from "breakreach";

const br = new Breakreach(); // BREAKREACH_API_KEY
const { accounts } = await br.listAccounts();
await br.createPost({ content: "Out tomorrow.", accountIds: accounts.map((a) => a.id), useNextSlot: true });
```

```bash
npx breakreach login
npx breakreach post "Out tomorrow." --to instagram,linkedin --media ./launch.jpg --next-slot
```

An API key comes from Breakreach, **Settings → API & MCP**. Docs: [breakreach.com/developers](https://www.breakreach.com/developers).

## Working on it

```bash
npx tsx scripts/generate.mts          # after an API change: types, methods and README tables from the spec
npx tsx scripts/generate.mts --check  # fails when the generated files are out of date
cd typescript && npm install && npm run build
```

In the Breakreach monorepo the generator reads the spec from `apps/api/src/lib/openapi.ts`; elsewhere from `openapi.json`, or `--spec https://api.breakreach.com/v1/openapi.json`. `scripts/e2e.sh` (monorepo only) drives both SDKs and the CLI against the real API code on a local database. Releasing: [RELEASING.md](RELEASING.md).

MIT licensed.
