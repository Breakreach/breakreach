"""The HTTP layer under the generated methods: auth, timeouts, retries with
one Idempotency-Key per call, errors. Standard library only."""

from __future__ import annotations

import json
import os
import random
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, BinaryIO, Dict, Optional, Union, cast

from ._generated import Operations, UploadMediaFileResponse
from ._types import NotGiven

__version__ = "0.1.0"
DEFAULT_BASE_URL = "https://api.breakreach.com"


class BreakreachError(Exception):
    """The API answered with an error status. ``message`` is the API's own reason."""

    def __init__(self, status: int, message: str, body: Any = None) -> None:
        super().__init__(f"{status}: {message}")
        self.status = status
        self.message = message
        self.body = body


class BreakreachConnectionError(Exception):
    """No answer: network failure or timeout, after every retry."""


def _drop_not_given(values: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return {k: v for k, v in (values or {}).items() if not isinstance(v, NotGiven)}


class Breakreach(Operations):
    """Breakreach API client.

    >>> from breakreach import Breakreach
    >>> br = Breakreach()  # reads BREAKREACH_API_KEY
    >>> accounts = br.list_accounts()["accounts"]
    >>> post = br.create_post(
    ...     content="Meet Morning Light, our new blend.",
    ...     account_ids=[a["id"] for a in accounts],
    ...     use_next_slot=True,
    ... )["post"]

    Every method maps to one endpoint of https://api.breakreach.com/v1 and is
    named after its operationId in the OpenAPI spec, in snake_case. POST calls
    carry an Idempotency-Key, so the built-in retries never create a post twice.

    Args:
        api_key: API key (br_...). Defaults to the BREAKREACH_API_KEY environment variable.
        base_url: Defaults to BREAKREACH_BASE_URL, then https://api.breakreach.com.
        workspace: Workspace slug sent with every call that takes one, unless the call sets its own.
        max_retries: Retries after a network error, a timeout, a 429 or a 5xx (default 2).
        timeout: Seconds per attempt (default 60, uploads 300).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        workspace: Optional[str] = None,
        max_retries: int = 2,
        timeout: float = 60.0,
    ) -> None:
        key = api_key or os.environ.get("BREAKREACH_API_KEY")
        if not key:
            raise ValueError(
                "Missing API key: pass api_key or set BREAKREACH_API_KEY. "
                "Create one in Breakreach under Settings → API & MCP."
            )
        self._api_key = key
        self.base_url = (base_url or os.environ.get("BREAKREACH_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.workspace = workspace
        self.max_retries = max_retries
        self.timeout = timeout

    def upload_media_file(
        self,
        file: Union[str, "os.PathLike[str]", bytes, BinaryIO],
        *,
        filename: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> UploadMediaFileResponse:
        """Upload a local file to Breakreach storage. ``POST /v1/media/upload``.

        Returns the URL to put in ``create_post(media=[...])``. Up to 100 MB:
        JPG, PNG, WebP, GIF, MP4, MOV, WebM or PDF, recognised by the file
        name's extension.

        Args:
            file: A path, the file's bytes, or an open binary file.
            filename: Needed with bytes; defaults to the path's or file's name.
        """
        if isinstance(file, (str, os.PathLike)):
            with open(file, "rb") as f:
                content = f.read()
            filename = filename or os.path.basename(os.fspath(file))
        elif isinstance(file, (bytes, bytearray)):
            content = bytes(file)
        else:
            content = file.read()
            filename = filename or os.path.basename(getattr(file, "name", "") or "")
        if not filename:
            raise ValueError('upload_media_file needs a filename with an extension, e.g. filename="photo.jpg"')

        boundary = uuid.uuid4().hex
        safe_name = filename.replace('"', "%22").replace("\r", "").replace("\n", "")
        data = b"".join([
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{safe_name}"\r\n'.encode(),
            b"Content-Type: application/octet-stream\r\n\r\n",
            content,
            f"\r\n--{boundary}--\r\n".encode(),
        ])
        return cast(UploadMediaFileResponse, self._send(
            "POST", "/v1/media/upload", data, f"multipart/form-data; boundary={boundary}",
            key=None, safe=True, timeout=timeout or max(self.timeout, 300.0),
        ))

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Dict[str, Any]] = None,
        body: Optional[Dict[str, Any]] = None,
        idempotent: bool = False,
        idempotency_key: Optional[str] = None,
        workspace_in: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> Any:
        query = _drop_not_given(query)
        payload = _drop_not_given(body) if body is not None else None
        # The client's default workspace, wherever the operation takes one
        if self.workspace and workspace_in == "query" and query.get("workspace") is None:
            query["workspace"] = self.workspace
        if self.workspace and workspace_in == "body" and payload is not None and payload.get("workspace") is None:
            payload["workspace"] = self.workspace

        params = {k: ("true" if v is True else "false" if v is False else v) for k, v in query.items() if v is not None}
        if params:
            path = f"{path}?{urllib.parse.urlencode(params)}"
        # One key for every attempt of this call: a retry can't create a second post
        key = (idempotency_key or str(uuid.uuid4())) if idempotent else None
        data = json.dumps(payload).encode() if payload is not None else None
        # Without a key, a POST that may have run isn't retried (a 500 could come after the write)
        safe = method in ("GET", "DELETE") or key is not None
        return self._send(method, path, data, "application/json" if data is not None else None, key=key, safe=safe, timeout=timeout or self.timeout)

    def _send(self, method: str, path: str, data: Optional[bytes], content_type: Optional[str], *, key: Optional[str], safe: bool, timeout: float) -> Any:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
            "User-Agent": f"breakreach-python/{__version__}",
        }
        if content_type:
            headers["Content-Type"] = content_type
        if key:
            headers["Idempotency-Key"] = key

        attempt = 0
        while True:
            req = urllib.request.Request(self.base_url + path, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    status, raw, resp_headers = resp.status, resp.read(), resp.headers
            except urllib.error.HTTPError as err:
                status, raw, resp_headers = err.code, err.read(), err.headers
            except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as err:
                if safe and attempt < self.max_retries:
                    time.sleep(_backoff(attempt))
                    attempt += 1
                    continue
                reason = getattr(err, "reason", err)
                raise BreakreachConnectionError(f"{method} {path} failed: {reason}") from err

            is_json = "application/json" in (resp_headers.get("Content-Type") or "")
            text = raw.decode("utf-8", "replace")
            try:
                parsed: Any = json.loads(text) if is_json and text else text
            except ValueError:
                parsed = text
            if 200 <= status < 300:
                return parsed

            # 409 = the first attempt with this key is still running: its answer comes on a retry.
            # A 5xx that isn't our JSON comes from the proxy (deploy, restart): the API never saw it.
            retryable = (
                status == 429
                or (status == 409 and key is not None)
                or (status >= 500 and (not is_json or method in ("GET", "DELETE")))
            )
            if retryable and attempt < self.max_retries:
                time.sleep(_retry_after(resp_headers.get("Retry-After")) or _backoff(attempt))
                attempt += 1
                continue
            error = parsed.get("error") if isinstance(parsed, dict) else None
            message = str(error) if error else (text[:200] or f"HTTP {status}")
            raise BreakreachError(status, message, parsed)


def _backoff(attempt: int) -> float:
    return min(0.5 * 2.0**attempt, 8.0) * (0.75 + random.random() * 0.5)


def _retry_after(value: Optional[str]) -> Optional[float]:
    try:
        seconds = float(value) if value else 0
    except ValueError:
        return None
    return min(seconds, 30.0) if seconds > 0 else None
