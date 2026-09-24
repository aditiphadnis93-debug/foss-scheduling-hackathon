"""LLM decision engine (Sarvam chat completions) with a replay cache.

Called over plain HTTP (httpx). The key comes only from the environment
(``SARVAM_API_KEY``) and is never written anywhere. Every parsed response is cached in
``out/agent_cache.json`` keyed by (engine, model, prompt hash), so a replay is
deterministic and works offline. Any failure returns ``None`` and the caller falls back to
the rules model for the affected cases.

The model is a reasoning model. Left to itself it can spend thousands of tokens thinking
(and return ``content: null`` when it runs out), so by default we send
``reasoning_effort: null``, which answers directly (about 1 s for one matter, 15-20 s for a
batch of a dozen matters at roughly 50 output tokens per second). Set
``SARVAM_REASONING_EFFORT=low|medium|high`` to let it think (much slower).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx

OUT_DIR = Path(__file__).resolve().parents[3] / "out"
DEFAULT_CACHE = OUT_DIR / "agent_cache.json"
TIMEOUT_S = 30.0
MAX_PARALLEL = 4

SARVAM_URL = "https://api.sarvam.ai/v1/chat/completions"
SARVAM_KEY_ENV = "SARVAM_API_KEY"
SARVAM_MODEL_ENV = "SARVAM_MODEL"
SARVAM_REASONING_ENV = "SARVAM_REASONING_EFFORT"
SARVAM_DEFAULT_MODEL = "sarvam-105b"

_warned: set[str] = set()


def warn_once(key: str, msg: str) -> None:
    if key not in _warned:
        _warned.add(key)
        print(f"[agents] {msg}", file=sys.stderr)


def prompt_hash(payload: Any) -> str:
    text = payload if isinstance(payload, str) else json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(text.encode()).hexdigest()[:24]


class ResponseCache:
    """JSON file of {key: response}. Only parsed response bodies are stored -- never headers."""

    def __init__(self, path: str | Path | None = None, read_only: bool = False):
        self.path = Path(path) if path else DEFAULT_CACHE
        self.read_only = read_only
        self._lock = threading.Lock()
        self._dirty = 0
        self.used: set[str] = set()      # keys read or written in this session (for demo recordings)
        try:
            self.data: dict[str, Any] = json.loads(self.path.read_text()) if self.path.exists() else {}
        except (OSError, json.JSONDecodeError):
            self.data = {}

    @staticmethod
    def key(engine: str, model: str, payload: Any) -> str:
        return f"{engine}:{model}:{prompt_hash(payload)}"

    def get(self, key: str) -> Any | None:
        v = self.data.get(key)
        if v is not None:
            self.used.add(key)
        return v

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self.data[key] = value
            self.used.add(key)
            self._dirty += 1
        self.flush()

    def flush(self) -> None:
        with self._lock:
            if not self._dirty or self.read_only:
                return
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                tmp = self.path.with_suffix(".tmp")
                tmp.write_text(json.dumps(self.data, indent=1, sort_keys=True))
                tmp.replace(self.path)
                self._dirty = 0
            except OSError as e:
                warn_once("cache-write", f"could not write agent cache: {e}")


_THINK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def parse_json_object(text: str | None) -> dict[str, Any] | None:
    """Pull the first JSON object out of model output (reasoning tags, code fences, prose)."""
    if not text:
        return None
    text = _THINK.sub("", text)
    text = re.sub(r"```(?:json)?", "", text)
    for s in (i for i, ch in enumerate(text) if ch == "{"):
        depth, in_str, esc = 0, False, False
        for i in range(s, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(text[s:i + 1])
                    except json.JSONDecodeError:
                        break
                    if isinstance(obj, dict):
                        return obj
                    break
    return None


class SarvamClient:
    engine = "sarvam"
    key_env = SARVAM_KEY_ENV

    def __init__(self, cache: ResponseCache, transport: httpx.BaseTransport | None = None,
                 model: str | None = None, max_tokens: int = 4000, reasoning_effort: str | None = None):
        self.cache = cache
        self.transport = transport
        self.model = model or os.environ.get(SARVAM_MODEL_ENV) or SARVAM_DEFAULT_MODEL
        self.max_tokens = max(2000, max_tokens)
        self.reasoning_effort = reasoning_effort or os.environ.get(SARVAM_REASONING_ENV) or None
        self._http: httpx.Client | None = None
        self._lock = threading.Lock()
        self.live_calls = 0
        self.cache_hits = 0
        self.errors = 0
        self.latencies: list[float] = []

    @property
    def available(self) -> bool:
        return bool(os.environ.get(self.key_env))

    def http(self) -> httpx.Client:
        with self._lock:
            if self._http is None:
                self._http = httpx.Client(timeout=TIMEOUT_S, transport=self.transport)
            return self._http

    def close(self) -> None:
        if self._http is not None:
            self._http.close()
            self._http = None
        self.cache.flush()

    def _count(self, attr: str, latency: float | None = None) -> None:
        with self._lock:
            setattr(self, attr, getattr(self, attr) + 1)
            if latency is not None:
                self.latencies.append(round(latency, 2))

    def ask(self, system: str, user: str) -> dict[str, Any] | None:
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        key = ResponseCache.key(self.engine, self.model, {"m": messages, "r": self.reasoning_effort})
        hit = self.cache.get(key)
        if hit is not None:
            self._count("cache_hits")
            return hit.get("json") if isinstance(hit, dict) else None
        if not self.available:
            return None
        body = {"model": self.model, "messages": messages, "max_tokens": self.max_tokens,
                "temperature": 0.2, "reasoning_effort": self.reasoning_effort}
        t0 = time.monotonic()
        try:
            r = self.http().post(SARVAM_URL, json=body, headers={"api-subscription-key": os.environ[self.key_env]})
            r.raise_for_status()
            content = r.json()["choices"][0]["message"].get("content")
        except Exception as e:  # noqa: BLE001 -- any failure falls back to rules
            self._count("errors")
            warn_once(f"sarvam-{type(e).__name__}", f"sarvam call failed ({type(e).__name__}); using rules for those cases")
            return None
        obj = parse_json_object(content)
        if obj is None:
            self._count("errors")
            warn_once("sarvam-json", "sarvam returned no parsable JSON; using rules for those cases")
            return None
        self._count("live_calls", time.monotonic() - t0)
        self.cache.put(key, {"json": obj})
        return obj

    def ask_many(self, prompts: list[tuple[str, str]]) -> list[dict[str, Any] | None]:
        """Run several prompts with at most ``MAX_PARALLEL`` requests in flight; order preserved."""
        if len(prompts) <= 1:
            return [self.ask(s, u) for s, u in prompts]
        with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as ex:
            return list(ex.map(lambda p: self.ask(*p), prompts))
