// `npx breakreach …`: the API from a terminal, for people and for agents that
// prefer a shell command to an MCP server. Same client as the SDK.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { parseArgs } from "node:util";
import { Breakreach, BreakreachError, BreakreachConnectionError, VERSION, type Account, type CreatePostBody } from "./index";

const HELP = `breakreach ${VERSION}: schedule and publish social media posts from your terminal

Usage
  breakreach login [--key br_...]        Save your API key (Breakreach → Settings → API & MCP)
  breakreach logout                      Forget the saved key
  breakreach whoami                      Check the key and list its workspaces
  breakreach accounts                    Connected accounts and their ids
  breakreach post <text> --to <account> <when>
      when: --now | --at <time> | --next-slot | --draft (--draft can go with --at)
      --to <id|platform|platform:name>   repeat it or separate with commas, e.g. --to instagram,linkedin
      --media <file|url>                 repeat it; local files are uploaded first
      --board <id> --pin-link <url>      Pinterest board (required) and link
      --subreddit <name> --flair <text>  Reddit
      --tiktok-privacy <level>           PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR or SELF_ONLY (default)
      --idempotency-key <key>            send the same key again and the post is not created twice
  breakreach posts [--status draft|scheduled|published|failed|all] [--limit 25]
  breakreach next-slot                   The next free slot of the posting schedule
  breakreach upload <file|url>...        Host media on Breakreach, print the URLs
  breakreach delete <postId>             Remove a post and cancel its schedule

Options
  --workspace <slug>                     Default: the one saved at login, else your first workspace
  --json                                 Print the API's JSON instead of text
  --api-key <key>                        Instead of the saved key (or set BREAKREACH_API_KEY)
  -h, --help / -v, --version

Text "-" reads the post from stdin. --at is read in the workspace timezone: 2026-10-08T09:00.
Docs: https://www.breakreach.com/developers`;

// ── Config ───────────────────────────────────────────────────────────────
type Config = { apiKey?: string; baseUrl?: string; workspace?: string };

function configFile() {
  const dir = process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "breakreach")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "breakreach");
  return path.join(dir, "config.json");
}

function readConfig(): Config {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config: Config) {
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

// ── Helpers ──────────────────────────────────────────────────────────────
class UsageError extends Error {}

const fail = (message: string): never => {
  throw new UsageError(message);
};

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    // Keep the key off the screen
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const firstLine = (s: string, n = 60) => {
  const line = (s || "").split("\n")[0];
  return line.length > n ? line.slice(0, n - 1) + "…" : line;
};

function table(rows: string[][]) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] || "").length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : (c || "").padEnd(widths[i]))).join("  ")).join("\n");
}

const PLATFORM_ALIASES: Record<string, string> = { twitter: "x", ig: "instagram", fb: "facebook", yt: "youtube", li: "linkedin" };

// --to instagram | --to x:northbeam | --to 6701a2f4c9e84b0012a3b4c5
function resolveAccounts(targets: string[], accounts: Account[]) {
  const ids = new Set<string>();
  const list = () => accounts.map((a) => `  ${a.platform}:${a.displayName}  ${a.id}`).join("\n");
  for (const raw of targets.flatMap((t) => t.split(",")).map((t) => t.trim()).filter(Boolean)) {
    if (/^[0-9a-f]{24}$/i.test(raw)) {
      if (!accounts.some((a) => a.id === raw)) fail(`No account ${raw} in this workspace. Accounts:\n${list()}`);
      ids.add(raw);
      continue;
    }
    const [p, ...rest] = raw.split(":");
    const platform = PLATFORM_ALIASES[p.toLowerCase()] || p.toLowerCase();
    const name = rest.join(":").replace(/^@/, "").toLowerCase();
    const matches = accounts.filter((a) => a.platform === platform && (!name || a.displayName.replace(/^@/, "").toLowerCase() === name));
    if (!matches.length) fail(`No ${name ? `${platform} account named ${name}` : `${platform} account`} in this workspace. Accounts:\n${list() || "  (none: connect one in Breakreach settings)"}`);
    if (matches.length > 1) fail(`${matches.length} ${platform} accounts: pick one with ${platform}:<name> or its id:\n${matches.map((a) => `  ${platform}:${a.displayName}  ${a.id}`).join("\n")}`);
    ids.add(matches[0].id);
  }
  if (!ids.size) fail("Say where to post with --to, e.g. --to instagram,linkedin (see breakreach accounts)");
  return [...ids];
}

async function hostMedia(br: Breakreach, item: string, json: boolean) {
  if (/^https?:\/\//i.test(item)) return item;
  if (!fs.existsSync(item)) fail(`No file at ${item}`);
  const { url } = await br.uploadMediaFile(item);
  if (!json) console.error(`Uploaded ${path.basename(item)}`);
  return url;
}

// ── Commands ─────────────────────────────────────────────────────────────
async function main(argv: string[]) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      json: { type: "boolean" },
      workspace: { type: "string" },
      "api-key": { type: "string" },
      "base-url": { type: "string" },
      key: { type: "string" },
      to: { type: "string", multiple: true },
      media: { type: "string", multiple: true },
      now: { type: "boolean" },
      at: { type: "string" },
      "next-slot": { type: "boolean" },
      draft: { type: "boolean" },
      board: { type: "string" },
      "pin-link": { type: "string" },
      subreddit: { type: "string" },
      flair: { type: "string" },
      "tiktok-privacy": { type: "string" },
      "idempotency-key": { type: "string" },
      status: { type: "string" },
      limit: { type: "string" },
    },
  });
  const [command, ...args] = positionals;
  if (o.version) return console.log(VERSION);
  if (o.help || !command || command === "help") return console.log(HELP);

  const config = readConfig();
  const baseUrl = o["base-url"] || process.env.BREAKREACH_BASE_URL || config.baseUrl;
  const out = (data: unknown, text: () => string) => console.log(o.json ? JSON.stringify(data, null, 2) : text());

  if (command === "login") {
    let apiKey = o.key || o["api-key"];
    if (!apiKey) apiKey = process.stdin.isTTY ? await askHidden("API key (Breakreach → Settings → API & MCP): ") : await readStdin();
    if (!apiKey?.startsWith("br_")) fail("An API key starts with br_. Create one in Breakreach under Settings → API & MCP.");
    const br = new Breakreach({ apiKey, baseUrl });
    const { workspaces } = await br.listWorkspaces();
    if (o.workspace && !workspaces.some((w) => w.slug === o.workspace)) fail(`This key has no workspace "${o.workspace}": ${workspaces.map((w) => w.slug).join(", ")}`);
    writeConfig({ apiKey, ...(o["base-url"] ? { baseUrl: o["base-url"] } : {}), ...(o.workspace ? { workspace: o.workspace } : {}) });
    return out({ ok: true, workspaces, config: configFile() }, () =>
      `Logged in. Key saved to ${configFile()}\n\n${table([["WORKSPACE", "NAME", "TIMEZONE"], ...workspaces.map((w) => [w.slug, w.name, w.timezone])])}`
    );
  }

  if (command === "logout") {
    const { apiKey: _, ...rest } = config;
    if (fs.existsSync(configFile())) writeConfig(rest);
    return out({ ok: true }, () => "Logged out: the API key was removed from this computer.");
  }

  const apiKey = o["api-key"] || process.env.BREAKREACH_API_KEY || config.apiKey;
  if (!apiKey) fail("Not logged in: run `npx breakreach login`, or set BREAKREACH_API_KEY.");
  const workspace = o.workspace || process.env.BREAKREACH_WORKSPACE || config.workspace;
  const br = new Breakreach({ apiKey, baseUrl, workspace });

  switch (command) {
    case "whoami":
    case "workspaces": {
      const res = await br.listWorkspaces();
      return out(res, () =>
        `${apiKey!.slice(0, 12)}… on ${br.baseUrl}${workspace ? `, default workspace ${workspace}` : ""}\n\n` +
        table([["WORKSPACE", "NAME", "TIMEZONE"], ...res.workspaces.map((w) => [w.slug, w.name, w.timezone])])
      );
    }

    case "accounts": {
      const res = await br.listAccounts();
      return out(res, () =>
        res.accounts.length
          ? table([["ID", "PLATFORM", "NAME", ""], ...res.accounts.map((a) => [a.id, a.platform, a.displayName, a.warning ? `⚠ ${a.warning}` : ""])])
          : res.message || "No account connected yet."
      );
    }

    case "post": {
      let content = args.join(" ");
      if ((!content || content === "-") && !process.stdin.isTTY) content = await readStdin();
      if (!content || content === "-") fail('Give the post text: breakreach post "Hello" --to x --now');
      const timing = [o.now, o.at !== undefined, o["next-slot"]].filter(Boolean).length;
      if (timing > 1) fail("Pick one of --now, --at and --next-slot");
      if (!timing && !o.draft) fail("Say when: --now, --at 2026-10-08T09:00, --next-slot or --draft");
      if (o.draft && o.now) fail("A draft can't be published now: drop --draft or --now");

      const { accounts } = await br.listAccounts();
      const accountIds = resolveAccounts(o.to || [], accounts);
      const media: string[] = [];
      for (const item of o.media || []) media.push(await hostMedia(br, item, !!o.json));

      const body: CreatePostBody = {
        content,
        accountIds,
        ...(media.length ? { media } : {}),
        ...(o.now ? { publishNow: true } : {}),
        ...(o.at ? { scheduledAt: o.at.trim().replace(" ", "T") } : {}),
        ...(o["next-slot"] ? { useNextSlot: true } : {}),
        ...(o.draft ? { draft: true } : {}),
        ...(o.board ? { pinterestBoardId: o.board } : {}),
        ...(o["pin-link"] ? { pinterestLink: o["pin-link"] } : {}),
        ...(o.subreddit ? { redditSubreddit: o.subreddit.replace(/^r\//, "") } : {}),
        ...(o.flair ? { redditFlairText: o.flair } : {}),
        ...(o["tiktok-privacy"] ? { tiktokSettings: { privacyLevel: o["tiktok-privacy"] as NonNullable<CreatePostBody["tiktokSettings"]>["privacyLevel"] } } : {}),
      };
      const res = await br.createPost(body, { idempotencyKey: o["idempotency-key"] });
      const p = res.post;
      const verb = p.status === "draft" ? "Saved as a draft" : p.status === "publishing" ? "Publishing now" : `Scheduled for ${when(p.scheduledAt)}`;
      return out(res, () => `${verb} on ${p.accounts.join(", ")}\nPost id: ${p.id}`);
    }

    case "posts": {
      const status = o.status as "draft" | "scheduled" | "published" | "failed" | "all" | undefined;
      const res = await br.listPosts({ status, limit: o.limit ? Number(o.limit) : undefined });
      return out(res, () =>
        res.posts.length
          ? table([["ID", "STATUS", "WHEN", "ACCOUNTS", "TEXT"], ...res.posts.map((p) => [p.id, p.status, when(p.scheduledAt), String(p.accountIds.length), firstLine(p.content) + (p.error ? `  (${firstLine(p.error, 80)})` : "")])])
          : "No posts."
      );
    }

    case "next-slot": {
      const res = await br.getNextSlot();
      return out(res, () => `${res.scheduledAt.replace("T", " ")} (${res.timezone}), ${when(res.utc)} here. Use it with: breakreach post … --next-slot`);
    }

    case "upload": {
      if (!args.length) fail("breakreach upload <file|url>...");
      const urls: string[] = [];
      for (const item of args) urls.push(/^https?:\/\//i.test(item) ? (await br.uploadMedia({ url: item })).url : await hostMedia(br, item, true));
      return out({ urls }, () => urls.join("\n"));
    }

    case "delete": {
      if (!args[0]) fail("breakreach delete <postId> (ids from breakreach posts)");
      const res = await br.deletePost(args[0]);
      return out(res, () => `Deleted ${args[0]}: it won't publish.`);
    }

    default:
      fail(`Unknown command "${command}". Run breakreach --help`);
  }
}

main(process.argv.slice(2)).catch((err) => {
  if (err instanceof UsageError || (err as { code?: string })?.code?.startsWith?.("ERR_PARSE_ARGS")) {
    console.error(err.message);
    process.exit(2);
  }
  if (err instanceof BreakreachError) {
    const hint = err.status === 401 ? "\nRun `npx breakreach login` with a valid key." : "";
    console.error(`Error ${err.status}: ${err.message}${hint}`);
    process.exit(1);
  }
  if (err instanceof BreakreachConnectionError) {
    console.error(`Could not reach Breakreach: ${err.message}`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
