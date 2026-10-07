# Breakreach for TypeScript and the command line

The official SDK and CLI for the [Breakreach API](https://www.breakreach.com/developers): schedule and publish social media posts to Instagram, TikTok, X, LinkedIn, YouTube, Facebook, Threads, Pinterest, Bluesky, Reddit, Telegram, Discord, Slack, Mastodon and WordPress with one request shape.

- Typed from the [OpenAPI spec](https://api.breakreach.com/v1/openapi.json), one method per endpoint
- Retries network errors, timeouts, 429s and restarts, with an `Idempotency-Key` on every POST so a retry never posts twice
- No dependencies, Node 18+ (it uses the built-in `fetch`)
- A `breakreach` command for your terminal, your CI and your agents

```bash
npm install breakreach
```

You need an API key: in [Breakreach](https://www.breakreach.com), open **Settings → API & MCP** and create one (`br_...`). API access comes with every plan, and the [Developer plan](https://www.breakreach.com/developers#pricing) bills per connected account.

## Quickstart

```ts
import { Breakreach } from "breakreach";

const br = new Breakreach(); // reads BREAKREACH_API_KEY

const { accounts } = await br.listAccounts();

const { post } = await br.createPost({
  content: "Meet Morning Light, our new blend. Out tomorrow.",
  accountIds: accounts.map((a) => a.id),
  media: ["https://cdn.example.com/launch.jpg"],
  scheduledAt: "2026-10-20T09:00:00", // read in the workspace timezone
});

console.log(post.status, post.scheduledAt); // "scheduled", the UTC time
```

Instead of `scheduledAt`, pass `useNextSlot: true` to take the next free slot of the workspace's posting schedule, `publishNow: true` to publish at once, or `draft: true` to save it for review in Breakreach.

Instagram, TikTok, YouTube and Pinterest need a photo or a video. Pinterest also needs `pinterestBoardId` (from `listPinterestBoards()`), and TikTok takes `tiktokSettings`.

### Local files

```ts
const { url } = await br.uploadMediaFile("./launch.jpg"); // or a Blob with { filename }
await br.createPost({ content: "…", accountIds, media: [url], useNextSlot: true });
```

Up to 100 MB: JPG, PNG, WebP, GIF, MP4, MOV, WebM or PDF. A file that's already online goes through `uploadMedia({ url })`, which copies it to Breakreach storage so it's still there when the post goes out.

### Several workspaces

Agencies and apps with one workspace per customer can set a default, or pass `workspace` to any call:

```ts
const northbeam = new Breakreach({ workspace: "northbeam" }); // every call goes there
await br.listAccounts({ workspace: "acme" }); // or say it per call
```

## Retries and idempotency

Every POST carries an `Idempotency-Key`. The SDK generates one per call and sends the same key on each retry, so when a response is lost after the post was created, the retry gets that post back instead of creating a second one. Pass your own to make re-runs of a whole job safe:

```ts
await br.createPost(body, { idempotencyKey: `newsletter-${issue.id}` });
```

Keys are kept 24 hours per API key. The same key with a different body is refused with a 422.

The client retries network errors, timeouts, 429s, and 5xx answers that come from the proxy rather than the API (a restart), twice by default with backoff, honouring `Retry-After`. Set `maxRetries` and `timeout` (ms) on the client or per call.

## Errors

```ts
import { BreakreachError, BreakreachConnectionError } from "breakreach";

try {
  await br.createPost({ content: "Hi", accountIds: [] });
} catch (err) {
  if (err instanceof BreakreachError) console.log(err.status, err.message); // 400 "accountIds is required…"
  if (err instanceof BreakreachConnectionError) console.log("no answer", err.message);
}
```

`message` is the API's own reason, written to be shown to a person or an agent.

## The CLI

```bash
npx breakreach login                      # paste your key, saved in ~/.config/breakreach
npx breakreach accounts
npx breakreach post "Out tomorrow." --to instagram,linkedin --media ./launch.jpg --next-slot
npx breakreach post "Live now" --to x --now
npx breakreach post "Friday recap" --to x:northbeam --at 2026-10-24T17:00
npx breakreach post "For review" --to linkedin --draft
npx breakreach posts --status scheduled
npx breakreach upload ./clip.mp4
```

`--to` takes an account id, a network (when the workspace has one account there) or `network:name`. Local files in `--media` are uploaded first. `--json` prints the API's JSON, for scripts and agents; text `-` reads the post from stdin. `BREAKREACH_API_KEY` and `--workspace` work as in the SDK. Run `npx breakreach --help` for every option.

## All methods

<!-- methods:start -->
| Method | Endpoint | |
| --- | --- | --- |
| `listWorkspaces()` | `GET /v1/workspaces` | List workspaces |
| `createWorkspace()` | `POST /v1/workspaces` | Create a workspace |
| `createConnectLink()` | `POST /v1/connect-links` | Create a connect link |
| `getConnectLink()` | `GET /v1/connect-links/{id}` | Get a connect link |
| `revokeConnectLink()` | `DELETE /v1/connect-links/{id}` | Revoke a connect link |
| `listAccounts()` | `GET /v1/accounts` | List connected social accounts |
| `listPosts()` | `GET /v1/posts` | List posts |
| `createPost()` | `POST /v1/posts` | Create a post (schedule, publish now or save a draft) |
| `updatePost()` | `PATCH /v1/posts/{id}` | Edit, schedule or move back to drafts |
| `deletePost()` | `DELETE /v1/posts/{id}` | Delete a post (cancels scheduling) |
| `uploadMedia()` | `POST /v1/media` | Re-host a media URL on Breakreach storage |
| `uploadMediaFile()` | `POST /v1/media/upload` | Upload a local file to Breakreach storage |
| `getNextSlot()` | `GET /v1/next-slot` | Next free posting slot |
| `listPinterestBoards()` | `GET /v1/pinterest-boards` | List Pinterest boards |
| `getAnalytics()` | `GET /v1/analytics` | Workspace analytics |
| `getAccountStats()` | `GET /v1/accounts/stats` | Account-level stats |
| `getPostInsights()` | `GET /v1/post-insights` | Post insights |
| `getAccountTrends()` | `GET /v1/accounts/trends` | Daily account trends |
| `getPostMetrics()` | `GET /v1/posts/{id}/metrics` | Per-post metrics |
| `getPostComments()` | `GET /v1/posts/{id}/comments` | Read comments on a published post |
| `listRecentComments()` | `GET /v1/comments` | Recent comments |
| `replyToComment()` | `POST /v1/comments/reply` | Reply to a comment |
| `getContentPerformance()` | `GET /v1/performance` | Content performance |
| `listConversations()` | `GET /v1/inbox` | List direct message conversations |
| `getConversationMessages()` | `GET /v1/inbox/{conversationId}/messages` | Read a conversation |
| `sendDirectMessage()` | `POST /v1/inbox/{conversationId}/messages` | Send a direct message |
| `listCommentDmRules()` | `GET /v1/comment-dm-rules` | List Comment to DM rules |
| `createCommentDmRule()` | `POST /v1/comment-dm-rules` | Create a Comment to DM rule |
| `listCommentDmMedia()` | `GET /v1/comment-dm-rules/media` | Latest posts of an Instagram account or a Facebook Page |
| `updateCommentDmRule()` | `PATCH /v1/comment-dm-rules/{id}` | Update a Comment to DM rule |
| `deleteCommentDmRule()` | `DELETE /v1/comment-dm-rules/{id}` | Delete a Comment to DM rule |
| `listCommentDmEvents()` | `GET /v1/comment-dm-rules/{id}/events` | Activity of a Comment to DM rule |
<!-- methods:end -->

## Also

- [MCP server](https://www.breakreach.com/agents) for Claude, ChatGPT, Cursor, Codex and other agents: `https://api.breakreach.com/mcp`
- [Python SDK](https://pypi.org/project/breakreach/): `pip install breakreach`
- [API reference](https://www.breakreach.com/developers) and [OpenAPI spec](https://api.breakreach.com/v1/openapi.json)

MIT licensed.
