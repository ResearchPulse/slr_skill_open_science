"""End-to-end checks: slr_mcp.py over stdio against a fake Agent Task API.

Run: python -m unittest discover -s tests -v   (stdlib only, no network)
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
TOKEN = "slrp_test_token_1234567890"
DATA = {"basis": "title_abstract", "confidence": 0.9, "keyFinding": "Adults, primary study.",
        "criteria": [{"id": "IC1", "name": "Adults", "status": "met", "reasoning": "Adult sample.",
                      "evidence": ['"adults aged 18-65" (Abstract)']},
                     {"id": "EC1", "name": "Reviews", "status": "not_met", "reasoning": "Primary study.",
                      "evidence": []}]}


def _task(tid, stage, status="ASSIGNED"):
    t = {"id": tid, "stage": stage, "status": status, "paperTitle": f"Paper {tid}",
         "instructions": "Assess criteria.",
         "protocolSnapshot": {"inclusionCriteria": ["Adults"], "exclusionCriteria": ["Reviews"]},
         "paper": {"id": f"p-{tid}", "title": f"Paper {tid}", "abstract": "...", "fullTextStatus": "COMPLETED"}}
    if stage == "FULL_TEXT":
        t["markdownPath"] = f"/api/agent/v1/tasks/{tid}/markdown"
    return t


class FakeApi(BaseHTTPRequestHandler):
    tasks = {}
    posts = []

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json", headers=None):
        raw = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _auth(self):
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self._send(401, {"success": False, "error": {"code": "UNAUTHORIZED", "message": "bad token"}})
            return False
        return True

    def do_GET(self):
        if not self._auth():
            return
        path, _, query = self.path.partition("?")
        ids = sorted(self.tasks)
        if path == "/api/agent/v1/tasks":
            # one item per page, to exercise the cursor loop; cursor = "c<offset>"
            start = int(query.split("cursor=c")[1].split("&")[0]) if "cursor=c" in query else 0
            items = [self.tasks[i] for i in ids[start:start + 1]]
            more = start + 1 < len(ids)
            return self._send(200, {"success": True, "data": {
                "project": {"name": "Demo review"}, "items": items,
                "nextCursor": f"c{start + 1}" if more else None, "hasMore": more}})
        parts = path.strip("/").split("/")  # api agent v1 tasks <id> [markdown]
        tid = parts[4] if len(parts) > 4 else None
        if tid not in self.tasks:
            return self._send(404, {"success": False, "error": {"code": "NOT_FOUND", "message": "no task"}})
        if len(parts) == 5:
            return self._send(200, {"success": True, "data": {"task": self.tasks[tid]}})
        if tid == "t-pending":
            return self._send(202, {"success": True, "data": {"status": "PROCESSING"}}, headers={"Retry-After": "10"})
        return self._send(200, "# Methods\nAdults 18-65.", "text/markdown; charset=utf-8")

    def do_POST(self):
        if not self._auth():
            return
        tid = self.path.strip("/").split("/")[4]
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.tasks[tid]["status"] == "COMPLETED":
            return self._send(409, {"success": False, "error": {"code": "TASK_COMPLETED", "message": "done"}})
        self.posts.append((tid, body))
        self.tasks[tid]["status"] = "COMPLETED"
        return self._send(200, {"success": True, "data": self.tasks[tid]})


class McpEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeApi)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        FakeApi.tasks = {t["id"]: t for t in (_task("t-ta", "TITLE_ABSTRACT"), _task("t-ft", "FULL_TEXT"),
                                              _task("t-pending", "FULL_TEXT"))}
        FakeApi.posts = []
        self.tmp = tempfile.TemporaryDirectory()
        self.env = {k: v for k, v in os.environ.items()
                    if k not in ("API_BASE_URL", "AGENT_TOKEN", "AGENT_TOKEN_FILE", "REVIEW_PROFILE")}
        self.env.update(REVIEW_CONFIG_DIR=self.tmp.name, REVIEW_WORKDIR=str(Path(self.tmp.name) / "pr"),
                        PYTHONIOENCODING="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def mcp(self, *calls):
        """Run one MCP session: initialize, then each (tool, args); return tool results."""
        msgs = [{"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
                {"jsonrpc": "2.0", "method": "notifications/initialized"}]
        msgs += [{"jsonrpc": "2.0", "id": i + 1, "method": "tools/call", "params": {"name": n, "arguments": a}}
                 for i, (n, a) in enumerate(calls)]
        p = subprocess.run([sys.executable, str(SCRIPTS / "slr_mcp.py")], env=self.env, timeout=60,
                           input="\n".join(json.dumps(m) for m in msgs) + "\n",
                           capture_output=True, text=True, encoding="utf-8")
        out = {m["id"]: m for m in map(json.loads, p.stdout.splitlines())}
        self.assertEqual(out[0]["result"]["serverInfo"]["name"], "slr")
        return [out[i + 1]["result"] for i in range(len(calls))]

    def configure(self):
        url, tok = self.mcp(("config_set_url", {"url": self.url}), ("config_set_token", {"token": TOKEN}))
        return url, tok

    def test_tools_list(self):
        p = subprocess.run([sys.executable, str(SCRIPTS / "slr_mcp.py")], env=self.env, timeout=60,
                           input='{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
                           capture_output=True, text=True, encoding="utf-8")
        names = {t["name"] for t in json.loads(p.stdout)["result"]["tools"]}
        self.assertEqual(names, {"connection_test", "list_tasks", "get_task", "get_markdown", "submit_result",
                                 "config_show", "config_set_url", "config_set_token", "config_use"})

    def test_unconfigured_reports_config_error(self):
        (res,) = self.mcp(("connection_test", {}))
        self.assertTrue(res["isError"])
        self.assertEqual(res["structuredContent"]["error"]["code"], "CONFIG")

    def test_config_from_chat_masks_token(self):
        url, tok = self.configure()
        self.assertEqual(url["structuredContent"]["api_base_url"], self.url + "/api")
        self.assertTrue(tok["structuredContent"]["connected"])
        self.assertNotIn(TOKEN, json.dumps(tok))
        (show,) = self.mcp(("config_show", {}))
        self.assertNotIn(TOKEN, json.dumps(show))
        self.assertTrue((Path(self.tmp.name) / "tokens" / "default").exists())

    def test_bad_token_is_error(self):
        self.mcp(("config_set_url", {"url": self.url}))
        (res,) = self.mcp(("config_set_token", {"token": "slrp_wrong_token_000000"}))
        self.assertTrue(res["isError"])
        self.assertEqual(res["structuredContent"]["error"]["status"], 401)

    def test_list_follows_cursor_and_counts(self):
        self.configure()
        ct, lst = self.mcp(("connection_test", {}), ("list_tasks", {}))
        self.assertEqual(ct["structuredContent"]["assigned"], 3)
        self.assertEqual(ct["structuredContent"]["project"], "Demo review")
        self.assertEqual(lst["structuredContent"]["count"], 3)

    def test_markdown_stage_guard_pending_and_ready(self):
        self.configure()
        ta, pend, ft = self.mcp(("get_markdown", {"task_id": "t-ta"}),
                                ("get_markdown", {"task_id": "t-pending", "max_wait": 0}),
                                ("get_markdown", {"task_id": "t-ft"}))
        self.assertEqual(ta["structuredContent"]["status"], "unavailable")
        self.assertEqual(ta["structuredContent"]["code"], "FULLTEXT_STAGE_REQUIRED")
        self.assertEqual(pend["structuredContent"]["status"], "pending")
        self.assertEqual(ft["structuredContent"]["status"], "ready")
        self.assertIn("Adults 18-65", ft["content"][0]["text"])

    def test_submit_once_then_already_completed(self):
        self.configure()
        vote = {"task_id": "t-ta", "decision": "INCLUDE", "reasoning": "Key reason: adults.", "data": DATA}
        first, second, task = self.mcp(("submit_result", vote), ("submit_result", vote),
                                       ("get_task", {"task_id": "t-ta"}))
        self.assertEqual(first["structuredContent"]["status"], "submitted")
        self.assertEqual(second["structuredContent"]["status"], "already_completed")
        self.assertEqual(task["structuredContent"]["task"]["status"], "COMPLETED")
        self.assertEqual(len(FakeApi.posts), 1)

    def test_submit_validation_blocks_post(self):
        self.configure()
        (res,) = self.mcp(("submit_result", {"task_id": "t-ta", "decision": "INCLUDE", "reasoning": "  ",
                                             "data": DATA}))
        self.assertTrue(res["isError"])
        self.assertEqual(FakeApi.posts, [])

    def test_submit_without_criteria_is_rejected(self):
        # Regression: votes with data = {confidence, stage} showed no "Criteria assessment" in the web app.
        self.configure()
        base = {"task_id": "t-ta", "decision": "INCLUDE", "reasoning": "I1: met. I2: met."}
        bad = [None, {"confidence": 0.9, "stage": "TITLE_ABSTRACT"},
               {**DATA, "criteria": []},
               {**DATA, "criteria": [{"id": "IC1", "text": "Adults", "status": "met", "evidence": []}]},
               {**DATA, "criteria": [{**DATA["criteria"][0], "status": "yes"}]},
               {**DATA, "basis": "abstract"}]
        results = self.mcp(*[("submit_result", {**base, **({} if d is None else {"data": d})}) for d in bad])
        for d, res in zip(bad, results):
            self.assertTrue(res["isError"], d)
            self.assertEqual(res["structuredContent"]["code"], "VALIDATION", d)
        self.assertEqual(FakeApi.posts, [])

    def test_profiles_switch_live(self):
        self.configure()
        self.mcp(("config_set_url", {"url": "http://127.0.0.1:9/api", "profile": "other"}))
        (sw,) = self.mcp(("config_use", {"profile": "other"}))
        self.assertEqual(sw["structuredContent"]["current"], "other")
        self.assertFalse(sw["structuredContent"]["connected"])
        (back,) = self.mcp(("config_use", {"profile": "default"}))
        self.assertTrue(back["structuredContent"]["connected"])

    def test_cli_draft_and_mark_submitted(self):
        def cli(*args):
            p = subprocess.run([sys.executable, str(SCRIPTS / "slr.py"), *args], env=self.env, timeout=60,
                               capture_output=True, text=True, encoding="utf-8")
            return json.loads(p.stdout)
        data_file = Path(self.tmp.name) / "t-ta.data.json"
        data_file.write_text(json.dumps(DATA), encoding="utf-8")
        d = cli("draft", "t-ta", "--title", "T", "--decision", "EXCLUDE",
                "--reasoning", "Decision: EXCLUDE\nKey reason: children.", "--data-file", str(data_file))
        self.assertTrue(d["ok"])
        self.assertEqual(cli("draft", "t-ft", "--decision", "INCLUDE", "--reasoning", "x",
                             "--data", '{"confidence": 0.8}')["code"], "VALIDATION")
        table = cli("drafts")
        self.assertEqual(table["drafts"][0]["keyReason"], "children.")
        m = cli("mark-submitted", "t-ta", "--result", "submitted")
        self.assertTrue(m["draftMoved"])
        self.assertEqual(cli("drafts")["pending"], 0)


if __name__ == "__main__":
    unittest.main()
