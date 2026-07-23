#!/usr/bin/env python3
"""Agente host: aplica el estado deseado de WireGuard desde NugaCore a wg0.

Contrato v2 (multi-tenant). El agente es **dueño único de wg0**: crea la
interfaz, gestiona el firewall nftables y persiste el último estado validado
para arrancar fail-closed sin depender de la app.

POST /apply — JSON:
  v2:
    {
      "schemaVersion": 2,
      "revision": 173,                       # monotónica; se rechaza < aplicada
      "peers": [
        { "publicKey": "...", "presharedKey": "...", "allocatedIp": "10.70.1.2",
          "tenantSubnet": "10.70.1.0/24", "name": "..." }
      ],
      "tenantSubnets": ["10.70.0.0/24", "10.70.1.0/24"]
    }
  v1 (app vieja, sin schemaVersion):
    { "peers": [ { "publicKey": "...", "allocatedIp": "10.70.0.2", "name": "..." } ] }
    → se aplican peers pero se CONSERVA el firewall vigente.

Auth: Authorization: Bearer <token> (archivo o env WIREGUARD_HOST_APPLY_TOKEN).

GET /health — reporta capacidad real (interfaz, dirección, puerto, chain nft,
revisión aplicada). Es negativo si falta cualquier pieza; no basta el proceso vivo.

Diseño: las funciones de render/validación son **puras** (testeables sin root,
sin nft ni wg); los side-effects (nft, ip, wg, estado en disco) están aislados.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

# ── Config (env) ──────────────────────────────────────────────────────────
WG_CONF = Path(os.environ.get("WG_CONF", "/etc/wireguard/wg0.conf"))
SERVER_KEY_FILE = Path(
    os.environ.get("WG_SERVER_KEY_FILE", "/root/.wireguard/nugacore-server.key")
)
TOKEN_FILE = Path(
    os.environ.get("WG_HOST_APPLY_TOKEN_FILE", "/root/.wireguard/host-apply.token")
)
STATE_FILE = Path(
    os.environ.get("WG_STATE_FILE", "/var/lib/nugacore-wg/state.json")
)
# El agente ya no escucha en 0.0.0.0: se liga a la gateway `docker0` del host,
# la misma IP que deploy-coolify-staging publica para el contenedor. El installer
# detecta la IP real; 172.17.0.1 es solo el fallback convencional. WG_APP_SUBNET
# (10.0.1.0/24) es la red ORIGEN de la app y no la IP de bind.
LISTEN_HOST = os.environ.get("WG_HOST_APPLY_LISTEN", "172.17.0.1")
LISTEN_PORT = int(os.environ.get("WG_HOST_APPLY_PORT", "18765"))
WG_IFACE = os.environ.get("WG_IFACE", "wg0")
WG_PORT = os.environ.get("WG_PORT", "13231")
WG_SERVER_IP = os.environ.get("WG_SERVER_IP", "10.70.0.1")
# Red donde vive la app (Coolify) que puede iniciar tráfico hacia los peers.
APP_SUBNET = os.environ.get("WG_APP_SUBNET", "10.0.1.0/24")

# ── Constantes de dominio ─────────────────────────────────────────────────
WG_SUPERNET = "10.70.0.0/16"
WG_SUPERNET_BASE = 0x0A460000          # 10.70.0.0
WG_SUPERNET_MASK = 0xFFFF0000          # /16
INFRA_SUBNET = "10.70.0.0/24"          # bloque 0: servidor .1 + lab .0.2
NFT_TABLE = "nugacore_wg"

IP_RE = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")
# Allowlist para `name`: se renderiza como comentario en wg0.conf (proceso root),
# así que se elimina cualquier carácter fuera de este set (previene inyección de
# líneas/directivas). Cualquier otro carácter se descarta.
NAME_ALLOWED_RE = re.compile(r"[^A-Za-z0-9 ._@:#()\-/]")
NAME_MAX_LEN = 64

# Serializa /apply: ThreadingHTTPServer permite POSTs concurrentes.
APPLY_LOCK = threading.Lock()


def log(msg: str) -> None:
    print(f"[wg-host-apply] {msg}", flush=True)


# ==========================================================================
# Funciones puras (sin side-effects) — testeables sin root/nft/wg
# ==========================================================================


def ip_to_int(value: str) -> int:
    parts = value.split(".")
    if len(parts) != 4:
        raise ValueError(f"IP inválida: {value}")
    n = 0
    for part in parts:
        if not part.isdigit():
            raise ValueError(f"IP inválida: {value}")
        octet = int(part)
        if octet < 0 or octet > 255:
            raise ValueError(f"IP inválida: {value}")
        n = (n << 8) | octet
    return n


def sanitize_name(raw: Any) -> str:
    """Normaliza `name` a una sola línea segura para renderizar como comentario
    en wg0.conf: colapsa espacios, descarta caracteres fuera de la allowlist
    (incluye saltos de línea y control) y acota la longitud."""
    text = str(raw or "")
    # Colapsa cualquier whitespace (incl. \n, \r, \t) a un solo espacio.
    text = re.sub(r"\s+", " ", text)
    text = NAME_ALLOWED_RE.sub("", text).strip()
    return text[:NAME_MAX_LEN]


def is_wg_key(value: Any) -> bool:
    """Clave/PSK WireGuard: base64 de 32 bytes (44 chars, termina en '=')."""
    if not isinstance(value, str) or len(value) != 44 or not value.endswith("="):
        return False
    try:
        raw = base64.b64decode(value, validate=True)
    except Exception:
        return False
    return len(raw) == 32


def parse_tenant_subnet(cidr: str) -> int:
    """Valida un /24 canónico dentro de 10.70.0.0/16 y devuelve su base entera."""
    if not isinstance(cidr, str) or "/" not in cidr:
        raise ValueError(f"subred inválida: {cidr!r}")
    addr, _, mask = cidr.partition("/")
    if mask != "24":
        raise ValueError(f"subred no es /24: {cidr}")
    base = ip_to_int(addr)
    if base & 0xFF != 0:
        raise ValueError(f"subred /24 no canónica: {cidr}")
    if (base & WG_SUPERNET_MASK) != WG_SUPERNET_BASE:
        raise ValueError(f"subred fuera de {WG_SUPERNET}: {cidr}")
    return base


class DesiredState:
    """Estado deseado ya validado (resultado puro de validate_payload)."""

    def __init__(
        self,
        schema_version: int,
        revision: int | None,
        peers: list[dict[str, str]],
        subnets: list[str],
    ) -> None:
        self.schema_version = schema_version
        self.revision = revision
        self.peers = peers
        self.subnets = subnets


def _validate_peers_common(peers_in: Any) -> tuple[list[dict[str, str]], set[str], set[str]]:
    if not isinstance(peers_in, list):
        raise ValueError("peers debe ser una lista")
    peers: list[dict[str, str]] = []
    seen_keys: set[str] = set()
    seen_ips: set[str] = set()
    for p in peers_in:
        if not isinstance(p, dict):
            raise ValueError("cada peer debe ser un objeto")
        pub = str(p.get("publicKey") or "").strip()
        ip = str(p.get("allocatedIp") or "").strip().split("/")[0]
        name = sanitize_name(p.get("name")) or pub[:8]
        if not is_wg_key(pub):
            raise ValueError(f"publicKey inválida: {pub[:16]}…")
        if not IP_RE.match(ip):
            raise ValueError(f"allocatedIp inválida: {ip}")
        # normaliza/valida rango del octeto
        ip_int = ip_to_int(ip)
        if pub in seen_keys:
            raise ValueError("publicKey duplicada en payload")
        if ip in seen_ips:
            raise ValueError(f"allocatedIp duplicada: {ip}")
        if ip == WG_SERVER_IP:
            raise ValueError("allocatedIp no puede ser la IP del servidor")
        seen_keys.add(pub)
        seen_ips.add(ip)
        peer: dict[str, str] = {"publicKey": pub, "allocatedIp": ip, "name": name}
        tenant_subnet = str(p.get("tenantSubnet") or "").strip()
        if tenant_subnet:
            peer["tenantSubnet"] = tenant_subnet
        psk = p.get("presharedKey")
        if psk is not None and str(psk).strip():
            psk = str(psk).strip()
            if not is_wg_key(psk):
                raise ValueError("presharedKey inválida")
            peer["presharedKey"] = psk
        peer["_ipInt"] = str(ip_int)  # auxiliar interno para chequeo de subred
        peers.append(peer)
    return peers, seen_keys, seen_ips


def validate_payload(payload: Any) -> DesiredState:
    """Valida el payload completo (puro). Lanza ValueError si algo falla —
    el llamador NO debe tocar estado si esto lanza."""
    if not isinstance(payload, dict):
        raise ValueError("payload debe ser un objeto JSON")

    raw_schema = payload.get("schemaVersion")
    peers, _, _ = _validate_peers_common(payload.get("peers"))

    # ── v1: sin schemaVersion → peers sueltos, sin subredes ni revisión ──
    if raw_schema is None:
        for peer in peers:
            peer.pop("_ipInt", None)
        return DesiredState(schema_version=1, revision=None, peers=peers, subnets=[])

    # ── v2 ──
    try:
        schema = int(raw_schema)
    except (TypeError, ValueError):
        raise ValueError(f"schemaVersion inválido: {raw_schema!r}")
    if schema < 2:
        raise ValueError(f"schemaVersion no soportado: {schema}")

    raw_rev = payload.get("revision")
    if not isinstance(raw_rev, int) or isinstance(raw_rev, bool) or raw_rev < 0:
        raise ValueError(f"revision inválida: {raw_rev!r}")

    subnets_in = payload.get("tenantSubnets")
    if not isinstance(subnets_in, list) or not subnets_in:
        raise ValueError("tenantSubnets debe ser una lista no vacía")

    subnet_bases: dict[int, str] = {}
    for cidr in subnets_in:
        base = parse_tenant_subnet(str(cidr))
        if base in subnet_bases:
            raise ValueError(f"subred duplicada/solapada: {cidr}")
        subnet_bases[base] = str(cidr)

    # Cada peer v2 EXIGE presharedKey y tenantSubnet (cierra B-01/CR-06: un peer
    # sin PSK que sí la recibió en el MikroTik nunca haría handshake). La IP debe
    # caer en exactamente una subred declarada y coincidir con su tenantSubnet.
    for peer in peers:
        ip_int = int(peer.pop("_ipInt"))
        ip_base = ip_int & 0xFFFFFF00
        if "presharedKey" not in peer:
            raise ValueError(
                f"peer {peer['allocatedIp']} sin presharedKey (obligatoria en v2)"
            )
        declared = str(peer.get("tenantSubnet") or "").strip()
        if not declared:
            raise ValueError(
                f"peer {peer['allocatedIp']} sin tenantSubnet (obligatoria en v2)"
            )
        matches = [c for b, c in subnet_bases.items() if b == ip_base]
        if len(matches) != 1:
            raise ValueError(
                f"allocatedIp {peer['allocatedIp']} no cae en exactamente una tenantSubnet declarada"
            )
        declared_base = parse_tenant_subnet(declared)
        if declared_base != ip_base:
            raise ValueError(
                f"tenantSubnet {declared} no contiene a {peer['allocatedIp']}"
            )
        if declared_base not in subnet_bases:
            raise ValueError(f"tenantSubnet {declared} no está en tenantSubnets")

    subnets = [subnet_bases[b] for b in sorted(subnet_bases)]
    return DesiredState(schema_version=schema, revision=raw_rev, peers=peers, subnets=subnets)


def render_wg_conf(server_key: str, peers: list[dict[str, str]]) -> str:
    """Renderiza wg0.conf con PSK por peer (puro)."""
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
        lines.append(f"# {p['name']}")
        lines.append("[Peer]")
        lines.append(f"PublicKey = {p['publicKey']}")
        if p.get("presharedKey"):
            lines.append(f"PresharedKey = {p['presharedKey']}")
        lines.append(f"AllowedIPs = {p['allocatedIp']}/32")
        lines.append("PersistentKeepalive = 25")
        lines.append("")
    return "\n".join(lines)


def firewall_subnets(tenant_subnets: list[str]) -> list[str]:
    """Conjunto de subredes intra-accept del firewall: siempre incluye el
    bloque de infraestructura (fail-closed conservador: intra bloque 0 + drop)."""
    merged = {INFRA_SUBNET}
    merged.update(tenant_subnets or [])
    return sorted(merged, key=parse_tenant_subnet)


def render_nft(
    tenant_subnets: list[str],
    app_subnet: str = APP_SUBNET,
    wg_iface: str = WG_IFACE,
    wg_port: str = WG_PORT,
) -> str:
    """Renderiza el ruleset nft (puro), con reemplazo atómico de la tabla.

    forward hook prio -10: intra-tenant ACCEPT, resto wg0→wg0 DROP,
    wg0→otras DROP, app→peers ACCEPT + established, resto DROP.
    input hook prio -10: solo puerto WG + ICMP echo; peers no tocan el host.
    """
    subnets = firewall_subnets(tenant_subnets)
    fwd = [
        f'\t\ttype filter hook forward priority -10; policy accept;',
    ]
    for s in subnets:
        fwd.append(
            f'\t\tiifname "{wg_iface}" oifname "{wg_iface}" ip saddr {s} ip daddr {s} accept'
        )
    fwd += [
        f'\t\tiifname "{wg_iface}" oifname "{wg_iface}" drop',
        # Retorno del tráfico que la app (bridge) inició hacia un peer: la
        # respuesta entra por wg0 y sale al bridge. Se acepta SOLO si está
        # established/related y va hacia APP_SUBNET; el INICIO peer→app (estado
        # new) sigue cayendo en el drop siguiente.
        f'\t\tiifname "{wg_iface}" oifname != "{wg_iface}" ip daddr {app_subnet} ct state established,related accept',
        f'\t\tiifname "{wg_iface}" oifname != "{wg_iface}" drop',
        f'\t\toifname "{wg_iface}" iifname != "{wg_iface}" ip saddr {app_subnet} accept',
        f'\t\toifname "{wg_iface}" iifname != "{wg_iface}" ct state established,related accept',
        f'\t\toifname "{wg_iface}" iifname != "{wg_iface}" drop',
    ]
    inp = [
        f'\t\ttype filter hook input priority -10; policy accept;',
        f'\t\tiifname "{wg_iface}" udp dport {wg_port} accept',
        f'\t\tiifname "{wg_iface}" icmp type echo-request accept',
        f'\t\tiifname "{wg_iface}" drop',
    ]
    body = "\n".join(
        [
            f"table inet {NFT_TABLE} {{",
            "\tchain forward {",
            *fwd,
            "\t}",
            "\tchain input {",
            *inp,
            "\t}",
            "}",
        ]
    )
    # Reemplazo atómico: 'add' garantiza que exista para poder borrarla, luego
    # se redefine completa. Todo en un solo `nft -f` es una transacción atómica.
    return "\n".join(
        [
            f"add table inet {NFT_TABLE}",
            f"delete table inet {NFT_TABLE}",
            body,
            "",
        ]
    )


def compute_digest(peers: list[dict[str, str]], subnets: list[str]) -> str:
    """Hash determinista del estado deseado (puro)."""
    canon = {
        "peers": sorted(
            (
                {
                    "publicKey": p["publicKey"],
                    "allocatedIp": p["allocatedIp"],
                    "presharedKey": p.get("presharedKey", ""),
                }
                for p in peers
            ),
            key=lambda x: x["publicKey"],
        ),
        "subnets": sorted(subnets),
    }
    raw = json.dumps(canon, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def is_stale_revision(desired_rev: int | None, applied_rev: int | None) -> bool:
    """True si la revisión entrante es más vieja que la aplicada (rechazable).
    Igual revisión se acepta SOLO si el digest coincide (ver revision_conflict)."""
    if desired_rev is None or applied_rev is None:
        return False
    return desired_rev < applied_rev


def revision_conflict(
    desired_rev: int | None,
    desired_digest: str,
    applied_rev: int | None,
    applied_digest: str | None,
) -> bool:
    """True si la MISMA revisión trae un digest distinto al aplicado (CR-08):
    una revisión monotónica no puede cambiar de contenido. Igual revisión con
    igual digest se re-aplica idempotentemente (corrección de drift)."""
    if desired_rev is None or applied_rev is None or applied_digest is None:
        return False
    return desired_rev == applied_rev and desired_digest != applied_digest


def merge_psk_from_prev(
    peers: list[dict[str, str]], prev_peers: list[dict[str, Any]]
) -> list[dict[str, str]]:
    """Enriquece peers (p.ej. de un payload v1 sin PSK) con la presharedKey del
    estado previo, indexada por publicKey (CR-01: un downgrade v2→v1 no debe
    borrar las PSK persistidas y romper el handshake de todos los peers)."""
    prev_psk = {
        p.get("publicKey"): p.get("presharedKey")
        for p in prev_peers
        if isinstance(p, dict) and p.get("publicKey") and p.get("presharedKey")
    }
    for peer in peers:
        if "presharedKey" not in peer:
            psk = prev_psk.get(peer.get("publicKey"))
            if psk:
                peer["presharedKey"] = psk
    return peers


# ==========================================================================
# Side-effects (nft / ip / wg / disco) — requieren root en el VPS
# ==========================================================================


def load_token() -> str:
    env = (os.environ.get("WIREGUARD_HOST_APPLY_TOKEN") or "").strip()
    if env:
        return env
    if TOKEN_FILE.is_file():
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    return ""


def load_server_key() -> str:
    if not SERVER_KEY_FILE.is_file():
        raise FileNotFoundError(f"falta clave servidor: {SERVER_KEY_FILE}")
    key = SERVER_KEY_FILE.read_text(encoding="utf-8").strip()
    if not key:
        raise ValueError("clave servidor vacía")
    return key


def _atomic_write(path: Path, contents: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(contents)
        os.chmod(tmp_name, mode)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def read_state() -> dict[str, Any]:
    if not STATE_FILE.is_file():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8") or "{}")
    except Exception as exc:  # noqa: BLE001
        log(f"WARN: estado ilegible ({exc}); se ignora")
        return {}


def write_state(state: dict[str, Any]) -> None:
    _atomic_write(STATE_FILE, json.dumps(state, sort_keys=True), mode=0o600)


def apply_nft(ruleset: str) -> None:
    """Aplica el ruleset con `nft -f -` (transacción atómica). Lanza si falla."""
    proc = subprocess.run(
        ["nft", "-f", "-"], input=ruleset, capture_output=True, text=True, check=False
    )
    if proc.returncode != 0:
        raise RuntimeError(f"nft falló: {proc.stderr.strip() or proc.returncode}")


def drain_conntrack(subnets: list[str]) -> None:
    """Dren selectivo de flujos wg0→wg0 inter-subred (que un flujo establecido
    antes del cambio de reglas no sobreviva). Best-effort: si `conntrack` no
    está instalado NO se aborta el apply (CR-12), solo se advierte una vez."""
    full = firewall_subnets(subnets)
    for a in full:
        for b in full:
            if a == b:
                continue
            try:
                subprocess.run(
                    ["conntrack", "-D", "-s", a, "-d", b],
                    capture_output=True,
                    check=False,
                )
            except FileNotFoundError:
                log("WARN: conntrack no instalado; se omite el dren (best-effort)")
                return


def ensure_sysctl() -> None:
    """ip_forward=1 persistente (necesario para intra-tenant)."""
    try:
        _atomic_write(
            Path("/etc/sysctl.d/99-nugacore-wg.conf"),
            "net.ipv4.ip_forward=1\n",
            mode=0o644,
        )
    except Exception as exc:  # noqa: BLE001
        log(f"WARN: no se pudo persistir sysctl ({exc})")
    subprocess.run(
        ["sysctl", "-w", "net.ipv4.ip_forward=1"], capture_output=True, check=False
    )


def interface_exists() -> bool:
    return (
        subprocess.run(
            ["ip", "link", "show", WG_IFACE], capture_output=True, check=False
        ).returncode
        == 0
    )


def ensure_interface() -> None:
    """Crea wg0 si no existe y garantiza clave, puerto, dirección y up.
    El agente es dueño único de la interfaz."""
    if not interface_exists():
        subprocess.run(
            ["ip", "link", "add", WG_IFACE, "type", "wireguard"],
            capture_output=True,
            check=True,
        )
    # Clave privada + puerto de escucha (idempotente; deja la iface funcional
    # incluso sin peers, para que /health reporte capacidad correcta).
    try:
        key_fd, key_tmp = tempfile.mkstemp(prefix="wg-key.")
        try:
            with os.fdopen(key_fd, "w", encoding="utf-8") as fh:
                fh.write(load_server_key())
            os.chmod(key_tmp, 0o600)
            subprocess.run(
                ["wg", "set", WG_IFACE, "listen-port", str(WG_PORT), "private-key", key_tmp],
                capture_output=True,
                check=False,
            )
        finally:
            try:
                os.unlink(key_tmp)
            except OSError:
                pass
    except Exception as exc:  # noqa: BLE001
        log(f"WARN: no se pudo fijar clave/puerto de {WG_IFACE} ({exc})")
    addr = subprocess.run(
        ["ip", "-4", "addr", "show", "dev", WG_IFACE],
        capture_output=True,
        text=True,
        check=False,
    )
    if WG_SERVER_IP not in (addr.stdout or ""):
        subprocess.run(
            ["ip", "addr", "add", f"{WG_SERVER_IP}/16", "dev", WG_IFACE],
            capture_output=True,
            check=False,
        )
    subprocess.run(
        ["ip", "link", "set", WG_IFACE, "up"], capture_output=True, check=False
    )


def sync_peers(conf: str) -> None:
    """Escribe wg0.conf y aplica peers con `wg syncconf` (sin tumbar túneles)."""
    _atomic_write(WG_CONF, conf, mode=0o600)
    ensure_interface()
    strip = subprocess.run(
        ["wg-quick", "strip", WG_IFACE], capture_output=True, text=True, check=False
    )
    if strip.returncode == 0 and strip.stdout.strip():
        sync = subprocess.run(
            ["wg", "syncconf", WG_IFACE, "/dev/stdin"],
            input=strip.stdout,
            capture_output=True,
            text=True,
            check=False,
        )
        if sync.returncode == 0:
            return
        log(f"wg syncconf falló ({sync.stderr.strip() or sync.returncode}); wg-quick up")
    # Último recurso: rehacer la interfaz vía wg-quick (el agente sigue siendo dueño).
    subprocess.run(["wg-quick", "down", WG_IFACE], capture_output=True, check=False)
    up = subprocess.run(
        ["wg-quick", "up", WG_IFACE], capture_output=True, text=True, check=False
    )
    if up.returncode != 0:
        raise RuntimeError(up.stderr.strip() or "wg-quick up falló")


def parse_firewall_health(nft_output: str) -> bool:
    """(Puro) True solo si el ruleset listado acredita AMBAS base chains con su
    hook/prioridad y un drop en cada una (CR-09). Una tabla vacía o sin hooks
    no basta: no habría aislamiento aunque exista el nombre de la tabla."""
    text = nft_output or ""

    def healthy_chain(name: str, hook: str) -> bool:
        match = re.search(
            rf"\bchain\s+{re.escape(name)}\s*\{{(?P<body>.*?)\}}",
            text,
            flags=re.DOTALL,
        )
        if not match:
            return False
        body = match.group("body")
        # `nft list` puede imprimir -10 como `filter - 10`; ambas formas son
        # equivalentes al priority -10 que instala render_nft.
        priority = r"(?:-\s*10|filter\s*-\s*10)"
        base_chain = re.search(
            rf"\btype\s+filter\s+hook\s+{re.escape(hook)}\s+"
            rf"priority\s+{priority}\s*;",
            body,
        )
        return bool(base_chain and re.search(r"\bdrop\b", body))

    return healthy_chain("forward", "forward") and healthy_chain("input", "input")


def firewall_healthy() -> bool:
    """Lista la tabla real y verifica base chains+hook+drop (no solo presencia)."""
    proc = subprocess.run(
        ["nft", "list", "table", "inet", NFT_TABLE],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return False
    return parse_firewall_health(proc.stdout or "")


def health_snapshot() -> dict[str, Any]:
    """Estado real de capacidad para /health. ok=False si falta cualquier pieza."""
    state = read_state()
    iface = interface_exists()
    addr_ok = False
    port_ok = False
    if iface:
        addr = subprocess.run(
            ["ip", "-4", "addr", "show", "dev", WG_IFACE],
            capture_output=True,
            text=True,
            check=False,
        )
        addr_ok = WG_SERVER_IP in (addr.stdout or "")
        wgshow = subprocess.run(
            ["wg", "show", WG_IFACE, "listen-port"],
            capture_output=True,
            text=True,
            check=False,
        )
        port_ok = wgshow.returncode == 0 and (wgshow.stdout or "").strip() == str(WG_PORT)
    fw_ok = firewall_healthy()
    revision = state.get("revision")
    snap = {
        "service": "wg-host-apply",
        "schemaVersion": 2,
        "revision": revision,
        "digest": state.get("digest"),
        "interface": iface,
        "address": addr_ok,
        "port": port_ok,
        "firewall": fw_ok,
    }
    snap["ok"] = bool(iface and addr_ok and port_ok and fw_ok)
    return snap


# ==========================================================================
# Orquestación del apply
# ==========================================================================


def handle_apply(payload: Any) -> dict[str, Any]:
    """Valida (puro, rechazo total sin tocar estado) y aplica. Serializado."""
    desired = validate_payload(payload)  # lanza antes de cualquier side-effect
    with APPLY_LOCK:
        server_key = load_server_key()
        prev = read_state()
        prev_rev = prev.get("revision") if isinstance(prev.get("revision"), int) else None

        if desired.schema_version >= 2:
            # Digest ANTES de tocar estado: la revisión monotónica no puede
            # cambiar de contenido (CR-08) y una revisión vieja se rechaza.
            digest = compute_digest(desired.peers, desired.subnets)
            if is_stale_revision(desired.revision, prev_rev):
                raise ValueError(
                    f"revisión {desired.revision} < aplicada {prev_rev} (rechazada)"
                )
            if revision_conflict(desired.revision, digest, prev_rev, prev.get("digest")):
                raise ValueError(
                    f"revisión {desired.revision} ya aplicada con distinto digest "
                    f"(esperado {str(prev.get('digest'))[:12]}…, recibido {digest[:12]}…)"
                )
            new_fw = firewall_subnets(desired.subnets)
            old_fw = firewall_subnets(prev.get("tenantSubnets") or [])
            apply_nft(render_nft(desired.subnets))
            if new_fw != old_fw:
                drain_conntrack(desired.subnets)
            sync_peers(render_wg_conf(server_key, desired.peers))
            write_state(
                {
                    "schemaVersion": 2,
                    "revision": desired.revision,
                    "peers": desired.peers,
                    "tenantSubnets": desired.subnets,
                    "digest": digest,
                }
            )
            log(
                f"v2 aplicado: rev={desired.revision} peers={len(desired.peers)} "
                f"subredes={len(desired.subnets)}"
            )
            return {
                "ok": True,
                "schemaVersion": 2,
                "revision": desired.revision,
                "digest": digest,
                "peers": len(desired.peers),
            }

        # ── v1: aplica peers, CONSERVA el firewall vigente ──
        # CR-01: un downgrade v2→v1 (rollback del flag) NO debe borrar las PSK
        # que ya recibieron los MikroTik. Se fusiona la PSK del estado previo por
        # publicKey antes de renderizar/persistir.
        peers_v1 = merge_psk_from_prev(desired.peers, prev.get("peers") or [])
        sync_peers(render_wg_conf(server_key, peers_v1))
        # Persiste peers para arranque; conserva subredes/revisión previas.
        merged = dict(prev)
        merged["peers"] = peers_v1
        merged.setdefault("tenantSubnets", prev.get("tenantSubnets") or [])
        digest = compute_digest(peers_v1, merged.get("tenantSubnets") or [])
        merged["digest"] = digest
        write_state(merged)
        log(f"v1 aplicado: peers={len(peers_v1)} (firewall conservado)")
        return {
            "ok": True,
            "schemaVersion": 1,
            "peers": len(peers_v1),
            "revision": prev_rev,
            "digest": digest,
        }


def startup_reconcile() -> None:
    """Arranque fail-closed desde estado persistido (sin depender de la app)."""
    state = read_state()
    subnets = state.get("tenantSubnets") or []
    # 1) Firewall primero. Sin estado → solo bloque 0 (infra) + DROPs.
    apply_nft(render_nft(subnets))
    ensure_sysctl()
    log(f"firewall instalado ({len(firewall_subnets(subnets))} subred(es) intra-accept)")
    # 2) Interfaz + peers conocidos.
    ensure_interface()
    peers = state.get("peers") or []
    if peers:
        try:
            server_key = load_server_key()
            sync_peers(render_wg_conf(server_key, peers))
            log(f"wg0 restaurado con {len(peers)} peer(s) desde estado")
        except Exception as exc:  # noqa: BLE001
            log(f"WARN: no se restauraron peers en arranque ({exc})")
    else:
        log("sin peers persistidos; wg0 arriba sin peers")


# ==========================================================================
# HTTP
# ==========================================================================


class Handler(BaseHTTPRequestHandler):
    server_version = "NugaCoreWgHostApply/2.0"

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
            snap = health_snapshot()
            self._send(200 if snap["ok"] else 503, snap)
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
            result = handle_apply(payload)
            self._send(200, result)
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

    # Fail-closed: firewall + interfaz ANTES de escuchar. Si el firewall no
    # se puede instalar, no servimos (systemd reintenta).
    try:
        startup_reconcile()
    except Exception as exc:  # noqa: BLE001
        log(f"FATAL: arranque fail-closed falló: {exc}")
        return 1

    try:
        httpd = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    except OSError as exc:
        # p.ej. la IP del bridge aún no existe tras el boot: systemd reintenta.
        log(f"FATAL: no se pudo ligar {LISTEN_HOST}:{LISTEN_PORT}: {exc}")
        return 1
    log(f"listening on {LISTEN_HOST}:{LISTEN_PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("shutting down")
    return 0


if __name__ == "__main__":
    sys.exit(main())
