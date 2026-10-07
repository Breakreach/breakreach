# Breakreach for Python

The official Python SDK for the [Breakreach API](https://www.breakreach.com/developers): schedule and publish social media posts to Instagram, TikTok, X, LinkedIn, YouTube, Facebook, Threads, Pinterest, Bluesky, Reddit, Telegram, Discord, Slack, Mastodon and WordPress with one request shape.

- Typed from the [OpenAPI spec](https://api.breakreach.com/v1/openapi.json) (TypedDict responses), one method per endpoint
- Retries network errors, timeouts, 429s and restarts, with an `Idempotency-Key` on every POST so a retry never posts twice
- Standard library only, Python 3.9+

```bash
pip install breakreach
```

You need an API key: in [Breakreach](https://www.breakreach.com), open **Settings → API & MCP** and create one (`br_...`). API access comes with every plan, and the [Developer plan](https://www.breakreach.com/developers#pricing) bills per connected account.

## Quickstart

```python
from breakreach import Breakreach

br = Breakreach()  # reads BREAKREACH_API_KEY

accounts = br.list_accounts()["accounts"]

post = br.create_post(
    content="Meet Morning Light, our new blend. Out tomorrow.",
    account_ids=[a["id"] for a in accounts],
    media=["https://cdn.example.com/launch.jpg"],
    scheduled_at="2026-10-20T09:00:00",  # read in the workspace timezone
)["post"]

print(post["status"], post["scheduledAt"])  # scheduled, the UTC time
```

Arguments are snake_case; responses are the API's JSON as dicts, with its camelCase keys. Instead of `scheduled_at`, pass `use_next_slot=True` to take the next free slot of the workspace's posting schedule, `publish_now=True` to publish at once, or `draft=True` to save it for review in Breakreach.

Instagram, TikTok, YouTube and Pinterest need a photo or a video. Pinterest also needs `pinterest_board_id` (from `list_pinterest_boards()`), and TikTok takes `tiktok_settings={"privacyLevel": "PUBLIC_TO_EVERYONE"}`.

### Local files

```python
url = br.upload_media_file("launch.jpg")["url"]  # a path, bytes (with filename=) or an open file
br.create_post(content="…", account_ids=ids, media=[url], use_next_slot=True)
```

Up to 100 MB: JPG, PNG, WebP, GIF, MP4, MOV, WebM or PDF. A file that's already online goes through `upload_media(url=...)`, which copies it to Breakreach storage so it's still there when the post goes out.

### Several workspaces

```python
northbeam = Breakreach(workspace="northbeam")  # every call goes there
br.list_accounts(workspace="acme")  # or say it per call
```

### Leaving a field out vs sending null

PATCH calls change only the fields you pass. An argument you don't pass isn't sent; `None` is sent as `null`. So `br.update_comment_dm_rule(rule_id, media_id=None)` makes a rule watch every post, while leaving `media_id` out keeps its post.

## Retries and idempotency

Every POST carries an `Idempotency-Key`. The SDK generates one per call and sends the same key on each retry, so when a response is lost after the post was created, the retry gets that post back instead of creating a second one. Pass your own to make re-runs of a whole job safe:

```python
br.create_post(content=text, account_ids=ids, use_next_slot=True, idempotency_key=f"newsletter-{issue_id}")
```

Keys are kept 24 hours per API key. The same key with a different body is refused with a 422.

The client retries network errors, timeouts, 429s, and 5xx answers that come from the proxy rather than the API (a restart), twice by default with backoff, honouring `Retry-After`. Set `max_retries` and `timeout` (seconds) on the client, `timeout` per call.

## Errors

```python
from breakreach import BreakreachError, BreakreachConnectionError

try:
    br.create_post(content="Hi", account_ids=[], publish_now=True)
except BreakreachError as err:
    print(err.status, err.message)  # 400 accountIds is required…
except BreakreachConnectionError as err:
    print("no answer:", err)
```

`message` is the API's own reason, written to be shown to a person or an agent.

## All methods

<!-- methods:start -->
| Method | Endpoint | |
| --- | --- | --- |
| `list_workspaces()` | `GET /v1/workspaces` | List workspaces |
| `create_workspace()` | `POST /v1/workspaces` | Create a workspace |
| `create_connect_link()` | `POST /v1/connect-links` | Create a connect link |
| `get_connect_link()` | `GET /v1/connect-links/{id}` | Get a connect link |
| `revoke_connect_link()` | `DELETE /v1/connect-links/{id}` | Revoke a connect link |
| `list_accounts()` | `GET /v1/accounts` | List connected social accounts |
| `list_posts()` | `GET /v1/posts` | List posts |
| `create_post()` | `POST /v1/posts` | Create a post (schedule, publish now or save a draft) |
| `update_post()` | `PATCH /v1/posts/{id}` | Edit, schedule or move back to drafts |
| `delete_post()` | `DELETE /v1/posts/{id}` | Delete a post (cancels scheduling) |
| `upload_media()` | `POST /v1/media` | Re-host a media URL on Breakreach storage |
| `upload_media_file()` | `POST /v1/media/upload` | Upload a local file to Breakreach storage |
| `get_next_slot()` | `GET /v1/next-slot` | Next free posting slot |
| `list_pinterest_boards()` | `GET /v1/pinterest-boards` | List Pinterest boards |
| `get_analytics()` | `GET /v1/analytics` | Workspace analytics |
| `get_account_stats()` | `GET /v1/accounts/stats` | Account-level stats |
| `get_post_insights()` | `GET /v1/post-insights` | Post insights |
| `get_account_trends()` | `GET /v1/accounts/trends` | Daily account trends |
| `get_post_metrics()` | `GET /v1/posts/{id}/metrics` | Per-post metrics |
| `get_post_comments()` | `GET /v1/posts/{id}/comments` | Read comments on a published post |
| `list_recent_comments()` | `GET /v1/comments` | Recent comments |
| `reply_to_comment()` | `POST /v1/comments/reply` | Reply to a comment |
| `get_content_performance()` | `GET /v1/performance` | Content performance |
| `list_conversations()` | `GET /v1/inbox` | List direct message conversations |
| `get_conversation_messages()` | `GET /v1/inbox/{conversationId}/messages` | Read a conversation |
| `send_direct_message()` | `POST /v1/inbox/{conversationId}/messages` | Send a direct message |
| `list_comment_dm_rules()` | `GET /v1/comment-dm-rules` | List Comment to DM rules |
| `create_comment_dm_rule()` | `POST /v1/comment-dm-rules` | Create a Comment to DM rule |
| `list_comment_dm_media()` | `GET /v1/comment-dm-rules/media` | Latest posts of an Instagram account or a Facebook Page |
| `update_comment_dm_rule()` | `PATCH /v1/comment-dm-rules/{id}` | Update a Comment to DM rule |
| `delete_comment_dm_rule()` | `DELETE /v1/comment-dm-rules/{id}` | Delete a Comment to DM rule |
| `list_comment_dm_events()` | `GET /v1/comment-dm-rules/{id}/events` | Activity of a Comment to DM rule |
<!-- methods:end -->

## Also

- [MCP server](https://www.breakreach.com/agents) for Claude, ChatGPT, Cursor, Codex and other agents: `https://api.breakreach.com/mcp`
- [TypeScript SDK and CLI](https://www.npmjs.com/package/breakreach): `npm install breakreach`, `npx breakreach post …`
- [API reference](https://www.breakreach.com/developers) and [OpenAPI spec](https://api.breakreach.com/v1/openapi.json)

MIT licensed.
