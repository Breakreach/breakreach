"""End-to-end checks of the SDK against a local API (apps/api/scripts/local-api.mts).
Run through devkit/scripts/e2e.sh, or: python -m unittest discover -s tests"""

import json
import os
import unittest
import urllib.request
from unittest import mock

from breakreach import NOT_GIVEN, Breakreach, BreakreachConnectionError, BreakreachError

INFO = json.load(open(os.environ.get("LOCAL_API_INFO", "/tmp/breakreach-local-api.json")))
br = Breakreach(INFO["apiKey"], base_url=INFO["url"])
X = next(a["id"] for a in INFO["accounts"] if a["platform"] == "x")


class EndToEnd(unittest.TestCase):
    def test_lists(self):
        self.assertEqual(br.list_workspaces()["workspaces"][0]["slug"], "northbeam")
        self.assertEqual(len(br.list_accounts()["accounts"]), 3)

    def test_explicit_key_replays(self):
        a = br.create_post(content="Python draft", account_ids=[X], draft=True, idempotency_key="py-e2e-1")
        b = br.create_post(content="Python draft", account_ids=[X], draft=True, idempotency_key="py-e2e-1")
        self.assertEqual(a["post"]["status"], "draft")
        self.assertEqual(a["post"]["id"], b["post"]["id"])

    def test_lost_response_is_retried_with_the_same_key(self):
        before = len(br.list_posts(status="all", limit=100)["posts"])
        real = urllib.request.urlopen
        seen = []

        def flaky(req, timeout=None):
            seen.append(req.get_header("Idempotency-key"))
            resp = real(req, timeout=timeout)
            if len(seen) == 1:
                resp.read()
                raise ConnectionResetError("connection reset after the server answered")
            return resp

        with mock.patch("urllib.request.urlopen", flaky):
            post = br.create_post(content="Lost response", account_ids=[X], draft=True)["post"]
        self.assertEqual(len(seen), 2)
        self.assertTrue(seen[0] and seen[0] == seen[1])
        after = br.list_posts(status="all", limit=100)["posts"]
        self.assertEqual(len(after), before + 1)
        self.assertIn(post["id"], [p["id"] for p in after])

    def test_errors(self):
        with self.assertRaises(BreakreachError) as e:
            br.create_post(content="", account_ids=[X], draft=True)
        self.assertEqual(e.exception.status, 400)
        self.assertIn("content is required", e.exception.message)
        with self.assertRaises(BreakreachError) as e:
            Breakreach("br_wrong", base_url=INFO["url"]).list_accounts()
        self.assertEqual(e.exception.status, 401)

    def test_default_workspace(self):
        with self.assertRaises(BreakreachError) as e:
            Breakreach(INFO["apiKey"], base_url=INFO["url"], workspace="nope").list_accounts()
        self.assertEqual(e.exception.status, 404)
        scoped = Breakreach(INFO["apiKey"], base_url=INFO["url"], workspace="northbeam")
        self.assertEqual(len(scoped.list_accounts()["accounts"]), 3)

    def test_next_slot_schedule_delete(self):
        slot = br.get_next_slot()
        self.assertTrue(slot["scheduledAt"].endswith("T09:00:00"))
        post = br.create_post(content="On the next slot", account_ids=[X], use_next_slot=True)["post"]
        self.assertEqual(post["status"], "scheduled")
        self.assertEqual(br.delete_post(post["id"]), {"ok": True})

    def test_patch_sends_only_given_fields(self):
        post = br.create_post(content="Before", account_ids=[X], draft=True)["post"]
        updated = br.update_post(post["id"], content="After", scheduled_at=NOT_GIVEN)["post"]
        self.assertEqual(updated["status"], "draft")
        listed = {p["id"]: p for p in br.list_posts(status="draft", limit=100)["posts"]}
        self.assertEqual(listed[post["id"]]["content"], "After")

    def test_upload_rejects_unsupported_type(self):
        with self.assertRaises(BreakreachError) as e:
            br.upload_media_file(b"hello", filename="notes.txt")
        self.assertEqual(e.exception.status, 400)

    @unittest.skipUnless(os.environ.get("E2E_R2"), "needs --r2")
    def test_upload_photo(self):
        import base64

        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        url = br.upload_media_file(png, filename="pixel.png")["url"]
        self.assertTrue(url.endswith(".png"))

    def test_no_server(self):
        down = Breakreach(INFO["apiKey"], base_url="http://127.0.0.1:9", max_retries=1)
        with self.assertRaises(BreakreachConnectionError):
            down.list_accounts()


if __name__ == "__main__":
    unittest.main()
