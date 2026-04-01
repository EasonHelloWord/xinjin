#!/usr/bin/env python3
import argparse
import hashlib
import json
import mimetypes
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
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
REGISTRY_FILE = ROOT / ".content_registry.json"


def configure_stdio() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is not None and hasattr(stream, "reconfigure"):
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


def parse_metadata(metadata_arg: str | None, meta_items: list[str]) -> dict:
    metadata: dict = {}

    if metadata_arg:
        if metadata_arg.startswith("@"):
            metadata_path = Path(metadata_arg[1:]).resolve()
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        else:
            metadata = json.loads(metadata_arg)

    for item in meta_items:
        if "=" not in item:
            raise ValueError(f"Invalid --meta item: {item!r}. Expected key=value.")
        key, value = item.split("=", 1)
        metadata[key] = value

    return metadata


def load_registry(path: Path) -> dict:
    if not path.exists():
        return {"version": 1, "items": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def save_registry(path: Path, registry: dict) -> None:
    path.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()


def make_dedupe_key(kind: str, fingerprint: str, workspace_slug: str, metadata: dict) -> str:
    payload = {
        "kind": kind,
        "fingerprint": fingerprint,
        "workspace_slug": workspace_slug,
        "metadata": metadata,
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def request_json(
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes | None = None,
) -> dict:
    req = urllib.request.Request(url=url, method=method, headers=headers, data=body)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {method} {url}\n{detail}") from exc


def can_reach(url: str) -> bool:
    req = urllib.request.Request(url=url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=2):
            return True
    except Exception:
        return False


def start_local_admin_server(admin_base: str) -> subprocess.Popen[str] | None:
    parsed = urllib.parse.urlparse(admin_base)
    health_url = f"{parsed.scheme}://{parsed.netloc}/health"
    if can_reach(health_url):
        return None

    if not (MCP_DIR / "dist" / "index.js").exists():
        raise RuntimeError("mcp_server/dist/index.js not found. Run `cd mcp_server && npm run build` first.")

    child_env = os.environ.copy()
    child_env["MODE"] = "admin"
    proc = subprocess.Popen(
        ["node", "dist/index.js"],
        cwd=str(MCP_DIR),
        env=child_env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )

    deadline = time.time() + 15
    while time.time() < deadline:
        if proc.poll() is not None:
            stderr_text = ""
            if proc.stderr is not None:
                stderr_text = proc.stderr.read()
            if "EADDRINUSE" in stderr_text:
                for _ in range(6):
                    if can_reach(health_url):
                        return None
                    time.sleep(0.5)
            raise RuntimeError(f"Failed to start local mcp_server admin API.\n{stderr_text}")
        if can_reach(health_url):
            return proc
        time.sleep(0.5)

    proc.terminate()
    raise RuntimeError("Timed out waiting for local mcp_server admin API to become healthy.")


def list_workspaces(admin_base: str, admin_key: str) -> list[dict]:
    url = f"{admin_base.rstrip('/')}/admin/workspaces"
    headers = {"Authorization": f"Bearer {admin_key}"}
    data = request_json("GET", url, headers)
    return data.get("workspaces", [])


def resolve_workspace_slug(admin_base: str, admin_key: str, workspace: str) -> tuple[str, str]:
    workspaces = list_workspaces(admin_base, admin_key)
    for item in workspaces:
        if item.get("slug") == workspace:
            return item["slug"], item.get("name", item["slug"])
    for item in workspaces:
        if item.get("name", "").lower() == workspace.lower():
            return item["slug"], item.get("name", item["slug"])
    raise RuntimeError(f"Knowledge base not found: {workspace}")


def upload_url(admin_base: str, admin_key: str, workspace_slug: str, url_value: str) -> dict:
    url = f"{admin_base.rstrip('/')}/admin/documents/url"
    headers = {
        "Authorization": f"Bearer {admin_key}",
        "Content-Type": "application/json",
    }
    body = json.dumps(
        {
            "url": url_value,
            "workspaceSlug": workspace_slug,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    return request_json("POST", url, headers, body)


def build_multipart_body(file_path: Path, field_name: str = "file") -> tuple[bytes, str]:
    boundary = f"----xinjin-{uuid.uuid4().hex}"
    mime_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    file_bytes = file_path.read_bytes()

    parts = [
        f"--{boundary}\r\n".encode("utf-8"),
        (
            f'Content-Disposition: form-data; name="{field_name}"; filename="{file_path.name}"\r\n'
            f"Content-Type: {mime_type}\r\n\r\n"
        ).encode("utf-8"),
        file_bytes,
        b"\r\n",
        f"--{boundary}--\r\n".encode("utf-8"),
    ]
    return b"".join(parts), boundary


def upload_file(admin_base: str, admin_key: str, workspace_slug: str, file_path: Path) -> dict:
    query = urllib.parse.urlencode({"workspaceSlug": workspace_slug})
    url = f"{admin_base.rstrip('/')}/admin/documents/file?{query}"
    body, boundary = build_multipart_body(file_path)
    headers = {
        "Authorization": f"Bearer {admin_key}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(body)),
    }
    return request_json("POST", url, headers, body)


def build_parser(default_admin_base: str | None, default_workspace: str | None) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Upload URL or file content into a Dify knowledge base through the local mcp_server admin API."
    )
    source_group = parser.add_mutually_exclusive_group(required=False)
    source_group.add_argument("--url", help="URL to upload.")
    source_group.add_argument("--file", help="File path to upload, e.g. .txt, .html, .pdf.")

    parser.add_argument(
        "--workspace",
        default=default_workspace,
        help="Knowledge base dataset ID or exact knowledge base name. Defaults to mcp_server/.env.",
    )
    parser.add_argument(
        "--admin-base",
        default=default_admin_base or "http://127.0.0.1:4000",
        help="Admin API base URL. Default: http://127.0.0.1:4000",
    )
    parser.add_argument(
        "--admin-key",
        default=None,
        help="Admin API key. Defaults to ADMIN_API_KEY in mcp_server/.env.",
    )
    parser.add_argument(
        "--metadata",
        default=None,
        help='JSON metadata string or @path/to/metadata.json. Used for local dedupe registry.',
    )
    parser.add_argument(
        "--meta",
        action="append",
        default=[],
        help="Additional metadata item in key=value form. Can be used multiple times.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Bypass local dedupe check and upload anyway.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve workspace and compute dedupe info without uploading.",
    )
    parser.add_argument(
        "--registry",
        default=str(REGISTRY_FILE),
        help=f"Path to local dedupe registry. Default: {REGISTRY_FILE.name}",
    )
    parser.add_argument(
        "--list-workspaces",
        action="store_true",
        help="List knowledge bases and exit.",
    )
    return parser


def main() -> int:
    configure_stdio()
    env_values = load_env_file(ENV_FILE)

    parser = build_parser(
        default_admin_base=f"http://127.0.0.1:{env_values.get('ADMIN_PORT', '4000')}",
        default_workspace=env_values.get("DIFY_DEFAULT_DATASET_ID")
        or env_values.get("ANYTHINGLLM_WORKSPACE"),
    )
    args = parser.parse_args()

    admin_key = args.admin_key or env_values.get("ADMIN_API_KEY")
    if not admin_key:
        print("Missing admin API key. Set ADMIN_API_KEY in mcp_server/.env or pass --admin-key.", file=sys.stderr)
        return 1

    server_proc: subprocess.Popen[str] | None = None
    try:
        server_proc = start_local_admin_server(args.admin_base)

        if args.list_workspaces:
            print(json.dumps(list_workspaces(args.admin_base, admin_key), ensure_ascii=False, indent=2))
            return 0

        if not args.url and not args.file:
            parser.error("one of --url or --file is required unless --list-workspaces is used")
        if not args.workspace:
            parser.error("--workspace is required unless --list-workspaces is used")

        metadata = parse_metadata(args.metadata, args.meta)
        workspace_slug, workspace_name = resolve_workspace_slug(args.admin_base, admin_key, args.workspace)

        if args.url:
            source_kind = "url"
            source_value = args.url.strip()
            fingerprint = source_value
        else:
            source_kind = "file"
            file_path = Path(args.file).resolve()
            if not file_path.exists() or not file_path.is_file():
                raise RuntimeError(f"File not found: {file_path}")
            source_value = str(file_path)
            fingerprint = sha256_file(file_path)

        dedupe_key = make_dedupe_key(source_kind, fingerprint, workspace_slug, metadata)
        registry_path = Path(args.registry).resolve()
        registry = load_registry(registry_path)
        existing = registry.get("items", {}).get(dedupe_key)

        preview = {
            "workspace": {"name": workspace_name, "slug": workspace_slug},
            "source": {"kind": source_kind, "value": source_value},
            "metadata": metadata,
            "dedupeKey": dedupe_key,
            "alreadyExists": existing is not None,
        }

        if args.dry_run:
            print(json.dumps(preview, ensure_ascii=False, indent=2))
            return 0

        if existing and not args.force:
            print(
                json.dumps(
                    {
                        **preview,
                        "status": "skipped",
                        "reason": "duplicate_by_local_registry",
                        "existingRecord": existing,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0

        if source_kind == "url":
            response = upload_url(args.admin_base, admin_key, workspace_slug, source_value)
        else:
            response = upload_file(args.admin_base, admin_key, workspace_slug, Path(source_value))

        record = {
            "workspaceName": workspace_name,
            "workspaceSlug": workspace_slug,
            "sourceKind": source_kind,
            "sourceValue": source_value,
            "fingerprint": fingerprint,
            "metadata": metadata,
            "response": response,
            "createdAt": time_now_iso(),
        }
        registry.setdefault("items", {})[dedupe_key] = record
        save_registry(registry_path, registry)

        print(
            json.dumps(
                {
                    **preview,
                    "status": "uploaded",
                    "response": response,
                    "registry": str(registry_path),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    finally:
        if server_proc is not None and server_proc.poll() is None:
            server_proc.terminate()
            try:
                server_proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                server_proc.kill()


def time_now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())
