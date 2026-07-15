#!/usr/bin/env python3
"""Agente host: aplica peers WireGuard deseados desde NugaCore a wg0.

Escucha POST /apply con JSON:
  { "peers": [ { "publicKey": "...", "allocatedIp": "10.70.0.2", "name": "..." } ] }

Auth: Authorization: Bearer <token> (archivo o env WIREGUARD_HOST_APPLY_TOKEN).

No imprime claves privadas. Reconoce y elimina peers viejos (full reconcile).
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

WG_CONF = Path(os.environ.get("WG_CONF", "/etc/wireguard/wg0.conf"))
SERVER_KEY_FILE = Path(
    os.environ.get("WG_SERVER_KEY_FILE", "/root/.wireguard/nugacore-server.key")
)
TOKEN_FILE = Path(
    os.environ.get("WG_HOST_APPLY_TOKEN_FILE", "/root/.wireguard/host-apply.token")
)
LISTEN_HOST = os.environ.get("WG_HOST_APPLY_LISTEN", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("WG_HOST_APPLY_PORT", "18765"))
WG_PORT = os.environ.get("WG_PORT", "13231")
WG_SERVER_IP = os.environ.get("WG_SERVER_IP", "10.70.0.1")

IP_RE = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")


def log(msg: str) -> None:
    print(f"[wg-host-apply] {msg}", flush=True)


def load_token() -> str:
    env = (os.environ.get("WIREGUARD_HOST_APPLY_TOKEN") or "").strip()
    if env:
        return env
    if TOKEN_FILE.is_file():
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    return ""


def is_wg_key(value: str) -> bool:
    if not isinstance(value, str) or len(value) != 44 or not value.endswith("="):
        return False
    try:
        raw = base64.b64decode(value, validate=True)
    except Exception:
        return False
    return len(raw) == 32


def validate_peers(peers: list[dict[str, Any]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen_keys: set[str] = set()
    seen_ips: set[str] = set()
    for p in peers:
        pub = str(p.get("publicKey") or "").strip()
        ip = str(p.get("allocatedIp") or "").strip().split("/")[0]
        name = str(p.get("name") or "").strip() or pub[:8]
        if not is_wg_key(pub):
            raise ValueError(f"publicKey inválida: {pub[:16]}…")
        if not IP_RE.match(ip):
            raise ValueError(f"allocatedIp inválida: {ip}")
        if pub in seen_keys:
            raise ValueError("publicKey duplicada en payload")
        if ip in seen_ips:
            raise ValueError(f"allocatedIp duplicada: {ip}")
        # Evitar IP del servidor
        if ip == WG_SERVER_IP:
            raise ValueError("allocatedIp no puede ser la IP del servidor")
        seen_keys.add(pub)
        seen_ips.add(ip)
        out.append({"publicKey": pub, "allocatedIp": ip, "name": name})
    return out


def build_conf(peers: list[dict[str, str]]) -> str:
    if not SERVER_KEY_FILE.is_file():
        raise FileNotFoundError(f"falta clave servidor: {SERVER_KEY_FILE}")
    server_key = SERVER_KEY_FILE.read_text(encoding="utf-8").strip()
    if not server_key:
        raise ValueError("clave servidor vacía")

    lines = [
        "[Interface]",
        f"Address = {WG_SERVER_IP}/16",
        f"ListenPort = {WG_PORT}",
        f"PrivateKey = {server_key}",
        "SaveConfig = false",
        "",
    ]
    for p in peers:
        lines += [
            f"# {p['name']}",
            "[Peer]",
            f"PublicKey = {p['publicKey']}",
            f"AllowedIPs = {p['allocatedIp']}/32",
            "PersistentKeepalive = 25",
            "",
        ]
    return "\n".join(lines)


def apply_conf(contents: str) -> None:
    WG_CONF.parent.mkdir(parents=True, exist_ok=True)
    # Escritura atómica
    fd, tmp_name = tempfile.mkstemp(prefix="wg0.", suffix=".conf", dir=str(WG_CONF.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(contents)
        os.chmod(tmp_name, 0o600)
        os.replace(tmp_name, WG_CONF)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise

    # Preferir syncconf (sin tumbar túneles). Fallback: wg-quick restart.
    strip = subprocess.run(
        ["wg-quick", "strip", "wg0"],
        check=False,
        capture_output=True,
        text=True,
    )
    if strip.returncode == 0 and strip.stdout.strip():
        sync = subprocess.run(
            ["wg", "syncconf", "wg0", "/dev/stdin"],
            input=strip.stdout,
            check=False,
            capture_output=True,
            text=True,
        )
        if sync.returncode == 0:
            return
        log(f"wg syncconf falló ({sync.stderr.strip() or sync.returncode}); reiniciando wg-quick")

    # Asegurar iface arriba
    subprocess.run(["wg-quick", "down", "wg0"], check=False, capture_output=True)
    up = subprocess.run(["wg-quick", "up", "wg0"], check=False, capture_output=True, text=True)
    if up.returncode != 0:
        raise RuntimeError(up.stderr.strip() or "wg-quick up failed")


class Handler(BaseHTTPRequestHandler):
    server_version = "NugaCoreWgHostApply/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        log(f"{self.address_string()} {fmt % args}")

    def _send(self, code: int, body: dict[str, Any]) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self) -> bool:
        expected = load_token()
        if not expected:
            log("ERROR: token host-apply no configurado")
            return False
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            return auth[7:].strip() == expected
        return False

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/health":
            self._send(200, {"ok": True, "service": "wg-host-apply"})
            return
        self._send(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/apply":
            self._send(404, {"ok": False, "error": "not_found"})
            return
        if not self._authorized():
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
            raw = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
            peers_in = payload.get("peers")
            if not isinstance(peers_in, list):
                raise ValueError("peers debe ser una lista")
            peers = validate_peers(peers_in)
            conf = build_conf(peers)
            apply_conf(conf)
            log(f"aplicados {len(peers)} peers activos (reconcile completo)")
            self._send(200, {"ok": True, "peers": len(peers)})
        except Exception as exc:  # noqa: BLE001
            log(f"ERROR apply: {exc}")
            self._send(400, {"ok": False, "error": str(exc)})


def main() -> int:
    if os.geteuid() != 0:
        log("ERROR: ejecutar como root")
        return 1
    if not SERVER_KEY_FILE.is_file():
        log(f"ERROR: falta {SERVER_KEY_FILE}")
        return 1
    if not load_token():
        log(f"ERROR: configura token en {TOKEN_FILE} o WIREGUARD_HOST_APPLY_TOKEN")
        return 1

    httpd = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    log(f"listening on {LISTEN_HOST}:{LISTEN_PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("shutting down")
    return 0


if __name__ == "__main__":
    sys.exit(main())
