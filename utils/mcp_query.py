#!/usr/bin/env python3
import argparse
import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path


def find_project_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "mcp_server").exists():
            return candidate
    raise RuntimeError("Could not find project root containing mcp_server")


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = find_project_root(SCRIPT_DIR)
MCP_DIR = ROOT / "mcp_server"
ENV_FILE = MCP_DIR / ".env"
SERVER_ENTRY = MCP_DIR / "dist" / "index.js"


def configure_stdio() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None or not hasattr(stream, "reconfigure"):
            continue
        stream.reconfigure(encoding="utf-8", errors="replace")


def load_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


class McpStdioClient:
    def __init__(self, command: list[str], cwd: Path, env: dict[str, str]) -> None:
        self._command = command
        self._cwd = str(cwd)
        self._env = env
        self._proc: subprocess.Popen[str] | None = None
        self._stdout_queue: "queue.Queue[dict]" = queue.Queue()
        self._stderr_queue: "queue.Queue[str]" = queue.Queue()
        self._next_id = 1

    def start(self) -> None:
        self._proc = subprocess.Popen(
            self._command,
            cwd=self._cwd,
            env=self._env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        assert self._proc.stdout is not None
        assert self._proc.stderr is not None

        threading.Thread(
            target=self._read_stdout,
            args=(self._proc.stdout,),
            daemon=True,
        ).start()
        threading.Thread(
            target=self._read_stderr,
            args=(self._proc.stderr,),
            daemon=True,
        ).start()

    def close(self) -> None:
        if not self._proc:
            return
        try:
            if self._proc.stdin:
                self._proc.stdin.close()
        except OSError:
            pass
        if self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        self._proc = None

    def _read_stdout(self, stream) -> None:
        for line in stream:
            line = line.strip()
            if not line:
                continue
            try:
                self._stdout_queue.put(json.loads(line))
            except json.JSONDecodeError:
                self._stderr_queue.put(f"Invalid JSON from MCP server: {line}")

    def _read_stderr(self, stream) -> None:
        for line in stream:
            line = line.rstrip()
            if line:
                self._stderr_queue.put(line)

    def _send(self, message: dict) -> None:
        if not self._proc or not self._proc.stdin:
            raise RuntimeError("MCP process is not running")
        payload = json.dumps(message, ensure_ascii=False) + "\n"
        self._proc.stdin.write(payload)
        self._proc.stdin.flush()

    def notify(self, method: str, params: dict | None = None) -> None:
        message = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self._send(message)

    def request(self, method: str, params: dict | None = None, timeout: float = 30.0) -> dict:
        request_id = self._next_id
        self._next_id += 1
        message = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            message["params"] = params
        self._send(message)
        return self._wait_for_response(request_id, timeout=timeout)

    def _wait_for_response(self, request_id: int, timeout: float) -> dict:
        deadline = time.time() + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                stderr_lines = self.drain_stderr()
                suffix = f"\nStderr:\n{stderr_lines}" if stderr_lines else ""
                raise TimeoutError(f"MCP request {request_id} timed out after {timeout:.0f}s{suffix}")

            try:
                message = self._stdout_queue.get(timeout=remaining)
            except queue.Empty:
                continue

            if message.get("id") != request_id:
                continue
            return message

    def drain_stderr(self) -> str:
        lines: list[str] = []
        while True:
            try:
                lines.append(self._stderr_queue.get_nowait())
            except queue.Empty:
                break
        return "\n".join(lines)


def extract_text_content(result: dict) -> str | None:
    content = result.get("result", {}).get("content")
    if not isinstance(content, list):
        return None

    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            text = item.get("text")
            if isinstance(text, str):
                return text
    return None


def parse_embedded_json(text: str | None):
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def build_parser(default_slug: str | None) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Call the local xinjin MCP server over stdio and query a Dify knowledge base."
    )
    parser.add_argument("query", nargs="?", help="Query text to send to query_workspace.")
    parser.add_argument(
        "--slug",
        default=default_slug,
        help="Knowledge base dataset ID. Defaults to mcp_server/.env.",
    )
    parser.add_argument("--top-n", type=int, default=3, help="Number of vector hits to return.")
    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Per-request timeout in seconds. Default: 300.",
    )
    parser.add_argument(
        "--list-tools",
        action="store_true",
        help="List MCP tools instead of querying.",
    )
    parser.add_argument(
        "--raw-mcp",
        action="store_true",
        help="Print the full MCP response envelope instead of extracting text content.",
    )
    return parser


def main() -> int:
    configure_stdio()

    if not SERVER_ENTRY.exists():
        print(
            f"MCP server entry not found: {SERVER_ENTRY}\nRun `cd mcp_server && npm run build` first.",
            file=sys.stderr,
        )
        return 1

    env_file_values = load_env_file(ENV_FILE)
    default_slug = env_file_values.get("DIFY_DEFAULT_DATASET_ID") or env_file_values.get(
        "ANYTHINGLLM_WORKSPACE"
    )
    parser = build_parser(default_slug)
    args = parser.parse_args()

    if not args.list_tools and not args.query:
        parser.error("query is required unless --list-tools is used")
    if not args.slug and not args.list_tools:
        parser.error("--slug is required when no default Dify dataset ID is available")

    child_env = os.environ.copy()
    child_env["MODE"] = "mcp"

    client = McpStdioClient(
        command=["node", "dist/index.js"],
        cwd=MCP_DIR,
        env=child_env,
    )

    try:
        client.start()

        init_response = client.request(
            "initialize",
            {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {
                    "name": "xinjin-python-mcp-client",
                    "version": "1.0.0",
                },
            },
            timeout=min(args.timeout, 30),
        )
        if "error" in init_response:
            raise RuntimeError(f"initialize failed: {json.dumps(init_response['error'], ensure_ascii=False)}")

        client.notify("notifications/initialized")

        if args.list_tools:
            response = client.request("tools/list", {}, timeout=min(args.timeout, 30))
        else:
            response = client.request(
                "tools/call",
                {
                    "name": "query_workspace",
                    "arguments": {
                        "slug": args.slug,
                        "message": args.query,
                        "topN": args.top_n,
                    },
                },
                timeout=float(args.timeout),
            )

        if args.raw_mcp:
            print(json.dumps(response, ensure_ascii=False, indent=2))
            return 0

        if args.list_tools:
            print(json.dumps(response.get("result", {}), ensure_ascii=False, indent=2))
            return 0

        text = extract_text_content(response)
        parsed = parse_embedded_json(text)
        if parsed is None:
            print(json.dumps(response, ensure_ascii=False, indent=2))
        else:
            print(json.dumps(parsed, ensure_ascii=False, indent=2))

        stderr_text = client.drain_stderr()
        if stderr_text:
            print(stderr_text, file=sys.stderr)
        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        stderr_text = client.drain_stderr()
        if stderr_text:
            print(stderr_text, file=sys.stderr)
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
