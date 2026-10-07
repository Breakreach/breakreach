// End-to-end checks of the built SDK (dist/) against a local API
// (apps/api/scripts/local-api.mts). Run through devkit/scripts/e2e.sh.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Breakreach, BreakreachError, BreakreachConnectionError } from "../dist/index.js";

const info = JSON.parse(fs.readFileSync(process.env.LOCAL_API_INFO || "/tmp/breakreach-local-api.json", "utf8"));
const br = new Breakreach({ apiKey: info.apiKey, baseUrl: info.url });
const x = info.accounts.find((a) => a.platform === "x").id;

test("lists workspaces and accounts, typed", async () => {
  const { workspaces } = await br.listWorkspaces();
  assert.equal(workspaces[0].slug, "northbeam");
  const { accounts } = await br.listAccounts();
  assert.equal(accounts.length, 3);
});

test("creates a draft, and an explicit key replays it", async () => {
  const body = { content: "SDK draft", accountIds: [x], draft: true };
  const a = await br.createPost(body, { idempotencyKey: "sdk-e2e-1" });
  const b = await br.createPost(body, { idempotencyKey: "sdk-e2e-1" });
  assert.equal(a.post.status, "draft");
  assert.equal(b.post.id, a.post.id);
});

test("a lost response is retried with the same key: one post, not two", async () => {
  const before = (await br.listPosts({ status: "all", limit: 100 })).posts.length;
  let calls = 0;
  const keys = [];
  const flaky = new Breakreach({
    apiKey: info.apiKey,
    baseUrl: info.url,
    fetch: async (url, init) => {
      calls++;
      keys.push(init.headers["Idempotency-Key"]);
      const res = await fetch(url, init);
      if (calls === 1) throw new TypeError("fetch failed (socket hang up)"); // the server created it, the client never heard
      return res;
    },
  });
  const { post } = await flaky.createPost({ content: "Lost response", accountIds: [x], draft: true });
  assert.equal(calls, 2);
  assert.ok(keys[0] && keys[0] === keys[1], "both attempts carry the same generated key");
  const after = (await br.listPosts({ status: "all", limit: 100 })).posts;
  assert.equal(after.length, before + 1);
  assert.ok(after.some((p) => p.id === post.id));
});

test("each call gets its own generated key", async () => {
  const a = await br.createPost({ content: "Twice on purpose", accountIds: [x], draft: true });
  const b = await br.createPost({ content: "Twice on purpose", accountIds: [x], draft: true });
  assert.notEqual(a.post.id, b.post.id);
});

test("API errors are BreakreachError with the API's reason", async () => {
  await assert.rejects(br.createPost({ content: "", accountIds: [x], draft: true }), (err) => {
    assert.ok(err instanceof BreakreachError);
    assert.equal(err.status, 400);
    assert.match(err.message, /content is required/);
    return true;
  });
  await assert.rejects(br.createPost({ content: "a", accountIds: [x], draft: true }, { idempotencyKey: "sdk-e2e-1" }), (err) => err.status === 422);
  await assert.rejects(new Breakreach({ apiKey: "br_wrong", baseUrl: info.url }).listAccounts(), (err) => err.status === 401);
});

test("the default workspace is sent, and a wrong one is reported", async () => {
  const scoped = new Breakreach({ apiKey: info.apiKey, baseUrl: info.url, workspace: "nope" });
  await assert.rejects(scoped.listAccounts(), (err) => err.status === 404 && /nope/.test(err.message));
  await assert.rejects(scoped.createPost({ content: "a", accountIds: [x], draft: true }), (err) => err.status === 404);
  const right = new Breakreach({ apiKey: info.apiKey, baseUrl: info.url, workspace: "northbeam" });
  assert.equal((await right.listAccounts()).accounts.length, 3);
});

test("next slot, schedule on it, then delete", async () => {
  const slot = await br.getNextSlot();
  assert.match(slot.scheduledAt, /T09:00:00$/);
  assert.equal(slot.timezone, "Europe/Paris");
  const { post } = await br.createPost({ content: "On the next slot", accountIds: [x], useNextSlot: true });
  assert.equal(post.status, "scheduled");
  assert.equal(new Date(post.scheduledAt).toISOString(), new Date(slot.utc).toISOString());
  assert.deepEqual(await br.deletePost(post.id), { ok: true });
});

test("upload rejects a file type the API doesn't take", async () => {
  const file = path.join(os.tmpdir(), "breakreach-e2e.txt");
  fs.writeFileSync(file, "hello");
  await assert.rejects(br.uploadMediaFile(file), (err) => err.status === 400 && /Unsupported file type \.txt/.test(err.message));
});

test("upload stores a photo", { skip: !process.env.E2E_R2 && "needs --r2" }, async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const { url } = await br.uploadMediaFile(new Blob([png]), { filename: "pixel.png" });
  assert.match(url, /^https:\/\/.+\.png$/);
  const head = await fetch(url, { method: "HEAD" });
  assert.equal(head.headers.get("content-type"), "image/png");
});

test("no server: BreakreachConnectionError after the retries", async () => {
  const down = new Breakreach({ apiKey: info.apiKey, baseUrl: "http://127.0.0.1:9", maxRetries: 1 });
  await assert.rejects(down.listAccounts(), (err) => err instanceof BreakreachConnectionError);
});
