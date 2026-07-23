#!/usr/bin/env python3
"""Tests del agente host-apply v2 (funciones puras, sin root/nft/wg).

Correr:
    python3 scripts/vps/test-wg-host-apply-agent.py
    # o
    python3 -m unittest discover -s scripts/vps -p 'test-*.py'

No requiere dependencias externas (solo stdlib) ni nft/wg/root: sólo ejercita
render y validación puras. Los side-effects (nft/ip/wg/disco) no se tocan aquí.
"""
import base64
import importlib.util
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# El archivo del agente tiene guiones → se carga por ruta con importlib.
_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENT_PATH = os.path.join(_HERE, "wg-host-apply-agent.py")
_INSTALLER_PATH = os.path.join(_HERE, "install-wg-host-apply-agent.sh")
_spec = importlib.util.spec_from_file_location("wg_host_apply_agent", _AGENT_PATH)
agent = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(agent)


def key(seed: int) -> str:
    """Clave/PSK WireGuard válida y determinista (base64 de 32 bytes)."""
    return base64.b64encode(bytes([seed % 256]) * 32).decode("ascii")


PUB1, PUB2, PUB3 = key(1), key(2), key(3)
PSK1, PSK2 = key(101), key(102)


class TestValidatePayloadV2(unittest.TestCase):
    def _valid_payload(self):
        return {
            "schemaVersion": 2,
            "revision": 10,
            "peers": [
                {
                    "publicKey": PUB1,
                    "presharedKey": PSK1,
                    "allocatedIp": "10.70.1.2",
                    "tenantSubnet": "10.70.1.0/24",
                    "name": "r1",
                },
                {
                    "publicKey": PUB2,
                    "presharedKey": PSK2,
                    "allocatedIp": "10.70.2.2",
                    "tenantSubnet": "10.70.2.0/24",
                    "name": "r2",
                },
            ],
            "tenantSubnets": ["10.70.1.0/24", "10.70.2.0/24"],
        }

    def test_valid_v2(self):
        d = agent.validate_payload(self._valid_payload())
        self.assertEqual(d.schema_version, 2)
        self.assertEqual(d.revision, 10)
        self.assertEqual(d.subnets, ["10.70.1.0/24", "10.70.2.0/24"])
        self.assertEqual(len(d.peers), 2)
        self.assertEqual(d.peers[0]["presharedKey"], PSK1)
        # el auxiliar interno _ipInt no debe filtrarse al estado
        self.assertNotIn("_ipInt", d.peers[0])

    def test_reject_non_24_mask(self):
        p = self._valid_payload()
        p["tenantSubnets"] = ["10.70.0.0/16"]
        with self.assertRaises(ValueError):
            agent.validate_payload(p)

    def test_reject_non_canonical_subnet(self):
        p = self._valid_payload()
        p["tenantSubnets"] = ["10.70.1.5/24", "10.70.2.0/24"]
        with self.assertRaises(ValueError):
            agent.validate_payload(p)

    def test_reject_subnet_outside_supernet(self):
        p = self._valid_payload()
        p["tenantSubnets"] = ["192.168.1.0/24"]
        with self.assertRaises(ValueError):
            agent.validate_payload(p)

    def test_reject_duplicate_overlapping_subnet(self):
        p = self._valid_payload()
        p["tenantSubnets"] = ["10.70.1.0/24", "10.70.1.0/24"]
        with self.assertRaises(ValueError):
            agent.validate_payload(p)

    def test_reject_ip_outside_any_declared_subnet(self):
        # IP huérfana: cae en 10.70.9.0/24 que no está declarada.
        p = self._valid_payload()
        p["peers"][0]["allocatedIp"] = "10.70.9.2"
        p["peers"][0]["tenantSubnet"] = "10.70.9.0/24"
        with self.assertRaises(ValueError):
            agent.validate_payload(p)

    def test_reject_tenantsubnet_mismatch(self):
        # allocatedIp en bloque 1 pero tenantSubnet declara bloque 2.
        p = self._valid_payload()
        p["peers"][0]["tenantSubnet"] = "10.70.2.0/24"
        with self.assertRaises(ValueError):
            agent.validate_payload(p)

    def test_reject_bad_psk(self):
        p = self._valid_payload()
        p["peers"][0]["presharedKey"] = "no-es-base64-de-32-bytes"
        with self.assertRaises(ValueError):
            agent.validate_payload(p)

    def test_reject_missing_psk_and_tenant_subnet(self):
        for missing_field in ("presharedKey", "tenantSubnet"):
            with self.subTest(missing_field=missing_field):
                p = self._valid_payload()
                del p["peers"][0][missing_field]
                with self.assertRaisesRegex(ValueError, missing_field):
                    agent.validate_payload(p)

    def test_reject_bad_pubkey(self):
        p = self._valid_payload()
        p["peers"][0]["publicKey"] = "xxx"
        with self.assertRaises(ValueError):
            agent.validate_payload(p)

    def test_reject_duplicate_ip(self):
        p = self._valid_payload()
        p["peers"][1]["allocatedIp"] = "10.70.1.2"
        p["peers"][1]["tenantSubnet"] = "10.70.1.0/24"
        with self.assertRaises(ValueError):
            agent.validate_payload(p)

    def test_reject_missing_tenantsubnets(self):
        p = self._valid_payload()
        del p["tenantSubnets"]
        with self.assertRaises(ValueError):
            agent.validate_payload(p)

    def test_reject_bad_revision(self):
        p = self._valid_payload()
        p["revision"] = "173"  # debe ser int
        with self.assertRaises(ValueError):
            agent.validate_payload(p)


class TestValidatePayloadV1(unittest.TestCase):
    def test_valid_v1_no_schema(self):
        payload = {
            "peers": [
                {"publicKey": PUB1, "allocatedIp": "10.70.0.2", "name": "lab"},
            ]
        }
        d = agent.validate_payload(payload)
        self.assertEqual(d.schema_version, 1)
        self.assertIsNone(d.revision)
        self.assertEqual(d.subnets, [])
        self.assertEqual(d.peers[0]["allocatedIp"], "10.70.0.2")
        self.assertNotIn("_ipInt", d.peers[0])

    def test_v1_rejects_server_ip(self):
        payload = {"peers": [{"publicKey": PUB1, "allocatedIp": "10.70.0.1"}]}
        with self.assertRaises(ValueError):
            agent.validate_payload(payload)

    def test_name_is_single_line_allowlisted_and_bounded(self):
        payload = {
            "peers": [
                {
                    "publicKey": PUB1,
                    "allocatedIp": "10.70.0.2",
                    "name": "router\n[Peer]\nPublicKey = evil\t" + "x" * 100,
                }
            ]
        }
        peer = agent.validate_payload(payload).peers[0]
        self.assertNotRegex(peer["name"], r"[\r\n\t]")
        self.assertIsNone(re.search(agent.NAME_ALLOWED_RE, peer["name"]))
        self.assertLessEqual(len(peer["name"]), agent.NAME_MAX_LEN)
        conf = agent.render_wg_conf("SERVERKEY==", [peer])
        self.assertEqual(conf.count("[Peer]"), 1)


class TestRevisionMonotonic(unittest.TestCase):
    def test_older_is_stale(self):
        self.assertTrue(agent.is_stale_revision(5, 10))

    def test_equal_not_stale(self):
        # igual revisión se re-aplica (corrección de drift), no se rechaza
        self.assertFalse(agent.is_stale_revision(10, 10))

    def test_newer_not_stale(self):
        self.assertFalse(agent.is_stale_revision(11, 10))

    def test_no_prior_not_stale(self):
        self.assertFalse(agent.is_stale_revision(1, None))

    def test_equal_revision_with_different_digest_conflicts(self):
        self.assertTrue(agent.revision_conflict(10, "new", 10, "old"))
        self.assertFalse(agent.revision_conflict(10, "same", 10, "same"))

    def test_equal_revision_different_digest_rejected_before_side_effects(self):
        first = {
            "schemaVersion": 2,
            "revision": 10,
            "peers": [
                {
                    "publicKey": PUB1,
                    "presharedKey": PSK1,
                    "allocatedIp": "10.70.1.2",
                    "tenantSubnet": "10.70.1.0/24",
                    "name": "r1",
                }
            ],
            "tenantSubnets": ["10.70.1.0/24"],
        }
        conflicting = {
            **first,
            "peers": [{**first["peers"][0], "allocatedIp": "10.70.1.3"}],
        }
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(agent, "STATE_FILE", Path(tmp) / "state.json"), \
             mock.patch.object(agent, "load_server_key", return_value="SERVERKEY=="), \
             mock.patch.object(agent, "apply_nft") as apply_nft, \
             mock.patch.object(agent, "drain_conntrack"), \
             mock.patch.object(agent, "sync_peers") as sync_peers:
            agent.handle_apply(first)
            apply_nft.reset_mock()
            sync_peers.reset_mock()
            with self.assertRaisesRegex(ValueError, "distinto digest"):
                agent.handle_apply(conflicting)
            apply_nft.assert_not_called()
            sync_peers.assert_not_called()


class TestRenderWgConf(unittest.TestCase):
    def test_includes_psk(self):
        peers = [
            {"publicKey": PUB1, "allocatedIp": "10.70.1.2", "name": "r1", "presharedKey": PSK1},
        ]
        conf = agent.render_wg_conf("SERVERKEY==", peers)
        self.assertIn("PresharedKey = " + PSK1, conf)
        self.assertIn("PublicKey = " + PUB1, conf)
        self.assertIn("AllowedIPs = 10.70.1.2/32", conf)
        self.assertIn("ListenPort = 13231", conf)

    def test_omits_psk_when_absent(self):
        peers = [{"publicKey": PUB1, "allocatedIp": "10.70.1.2", "name": "r1"}]
        conf = agent.render_wg_conf("SERVERKEY==", peers)
        self.assertNotIn("PresharedKey", conf)


class TestRenderNft(unittest.TestCase):
    def test_one_accept_per_subnet_plus_infra(self):
        nft = agent.render_nft(["10.70.1.0/24", "10.70.2.0/24"])
        # infra (bloque 0) siempre presente + las dos declaradas = 3 intra-accept
        accepts = [
            ln for ln in nft.splitlines()
            if "oifname \"wg0\"" in ln and "ip saddr" in ln and "ip daddr" in ln and "accept" in ln
        ]
        self.assertEqual(len(accepts), 3)
        self.assertIn("ip saddr 10.70.0.0/24 ip daddr 10.70.0.0/24 accept", nft)
        self.assertIn("ip saddr 10.70.1.0/24 ip daddr 10.70.1.0/24 accept", nft)
        self.assertIn("ip saddr 10.70.2.0/24 ip daddr 10.70.2.0/24 accept", nft)

    def test_atomic_replace_header(self):
        nft = agent.render_nft([])
        self.assertIn("add table inet nugacore_wg", nft)
        self.assertIn("delete table inet nugacore_wg", nft)
        self.assertIn("table inet nugacore_wg {", nft)

    def test_has_drops_and_hooks(self):
        nft = agent.render_nft([])
        self.assertIn("type filter hook forward priority -10", nft)
        self.assertIn("type filter hook input priority -10", nft)
        self.assertIn('iifname "wg0" oifname "wg0" drop', nft)
        self.assertIn('iifname "wg0" oifname != "wg0" drop', nft)
        self.assertIn('iifname "wg0" udp dport 13231 accept', nft)
        self.assertIn('iifname "wg0" drop', nft)
        # app → peers
        self.assertIn("ip saddr 10.0.1.0/24 accept", nft)

    def test_established_app_return_precedes_peer_to_non_wg_drop(self):
        nft = agent.render_nft([])
        established_return = (
            'iifname "wg0" oifname != "wg0" ip daddr 10.0.1.0/24 '
            'ct state established,related accept'
        )
        peer_egress_drop = 'iifname "wg0" oifname != "wg0" drop'
        self.assertIn(established_return, nft)
        self.assertLess(nft.index(established_return), nft.index(peer_egress_drop))

    def test_empty_state_still_has_infra_accept(self):
        # fail-closed conservador: sin subredes, sigue el intra bloque 0
        nft = agent.render_nft([])
        self.assertIn("ip saddr 10.70.0.0/24 ip daddr 10.70.0.0/24 accept", nft)


class TestDigest(unittest.TestCase):
    def test_deterministic_and_order_independent(self):
        peers_a = [
            {"publicKey": PUB1, "allocatedIp": "10.70.1.2", "presharedKey": PSK1},
            {"publicKey": PUB2, "allocatedIp": "10.70.2.2", "presharedKey": PSK2},
        ]
        peers_b = list(reversed(peers_a))
        d1 = agent.compute_digest(peers_a, ["10.70.1.0/24", "10.70.2.0/24"])
        d2 = agent.compute_digest(peers_b, ["10.70.2.0/24", "10.70.1.0/24"])
        self.assertEqual(d1, d2)

    def test_changes_with_peer(self):
        base = agent.compute_digest(
            [{"publicKey": PUB1, "allocatedIp": "10.70.1.2"}], ["10.70.1.0/24"]
        )
        changed = agent.compute_digest(
            [{"publicKey": PUB1, "allocatedIp": "10.70.1.3"}], ["10.70.1.0/24"]
        )
        self.assertNotEqual(base, changed)


class TestApplyPersistence(unittest.TestCase):
    def test_v2_to_v1_then_restart_preserves_preshared_key(self):
        v2 = {
            "schemaVersion": 2,
            "revision": 10,
            "peers": [
                {
                    "publicKey": PUB1,
                    "presharedKey": PSK1,
                    "allocatedIp": "10.70.1.2",
                    "tenantSubnet": "10.70.1.0/24",
                    "name": "r1",
                }
            ],
            "tenantSubnets": ["10.70.1.0/24"],
        }
        v1 = {
            "peers": [
                {"publicKey": PUB1, "allocatedIp": "10.70.1.2", "name": "r1"}
            ]
        }
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(agent, "STATE_FILE", Path(tmp) / "state.json"), \
             mock.patch.object(agent, "load_server_key", return_value="SERVERKEY=="), \
             mock.patch.object(agent, "apply_nft"), \
             mock.patch.object(agent, "drain_conntrack"), \
             mock.patch.object(agent, "ensure_sysctl"), \
             mock.patch.object(agent, "ensure_interface"), \
             mock.patch.object(agent, "sync_peers") as sync_peers:
            v2_result = agent.handle_apply(v2)
            v1_result = agent.handle_apply(v1)
            persisted = agent.read_state()

            self.assertEqual(persisted["peers"][0]["presharedKey"], PSK1)
            self.assertEqual(v1_result["revision"], v2_result["revision"])
            self.assertEqual(v1_result["digest"], persisted["digest"])

            sync_peers.reset_mock()
            agent.startup_reconcile()
            restored_conf = sync_peers.call_args.args[0]
            self.assertIn("PresharedKey = " + PSK1, restored_conf)


class TestFirewallHealth(unittest.TestCase):
    HEALTHY_RULESET = """
table inet nugacore_wg {
    chain forward {
        type filter hook forward priority filter - 10; policy accept;
        iifname \"wg0\" oifname \"wg0\" ip saddr 10.70.0.0/24 ip daddr 10.70.0.0/24 accept
        iifname \"wg0\" oifname \"wg0\" drop
        iifname \"wg0\" oifname != \"wg0\" ip daddr 10.0.1.0/24 ct state established,related accept
        iifname \"wg0\" oifname != \"wg0\" drop
        oifname \"wg0\" iifname != \"wg0\" ip saddr 10.0.1.0/24 accept
        oifname \"wg0\" iifname != \"wg0\" ct state established,related accept
        oifname \"wg0\" iifname != \"wg0\" drop
    }
    chain input {
        type filter hook input priority filter - 10; policy accept;
        iifname \"wg0\" drop
    }
}
"""

    def test_accepts_real_nft_chain_hook_priority_format(self):
        self.assertTrue(agent.parse_firewall_health(self.HEALTHY_RULESET))

    def test_accepts_rendered_negative_priority_format(self):
        rendered_priority = self.HEALTHY_RULESET.replace("filter - 10", "-10")
        self.assertTrue(agent.parse_firewall_health(rendered_priority))

    def test_uses_requested_app_subnet(self):
        custom_ruleset = self.HEALTHY_RULESET.replace(
            "10.0.1.0/24", "10.20.30.0/24"
        )
        self.assertTrue(
            agent.parse_firewall_health(
                custom_ruleset,
                app_subnet="10.20.30.0/24",
            )
        )
        self.assertFalse(agent.parse_firewall_health(custom_ruleset))

    def test_negative_when_input_chain_is_missing(self):
        without_input = self.HEALTHY_RULESET.replace(
            """    chain input {
        type filter hook input priority filter - 10; policy accept;
        iifname \"wg0\" drop
    }
""",
            "",
        )
        self.assertFalse(agent.parse_firewall_health(without_input))

    def test_negative_when_drop_is_not_in_each_chain(self):
        input_without_drop = self.HEALTHY_RULESET.replace(
            '        iifname "wg0" drop\n', ""
        )
        self.assertFalse(agent.parse_firewall_health(input_without_drop))

    def test_negative_when_wg_to_wg_drop_is_missing(self):
        without_wg_to_wg_drop = self.HEALTHY_RULESET.replace(
            '        iifname "wg0" oifname "wg0" drop\n', ""
        )
        self.assertFalse(agent.parse_firewall_health(without_wg_to_wg_drop))

    def test_negative_when_established_app_return_is_missing(self):
        without_established_return = self.HEALTHY_RULESET.replace(
            '        iifname "wg0" oifname != "wg0" ip daddr 10.0.1.0/24 '
            'ct state established,related accept\n',
            "",
        )
        self.assertFalse(agent.parse_firewall_health(without_established_return))

    def test_negative_when_app_to_peer_allow_is_missing(self):
        without_app_to_peer_allow = self.HEALTHY_RULESET.replace(
            '        oifname "wg0" iifname != "wg0" ip saddr 10.0.1.0/24 accept\n',
            "",
        )
        self.assertFalse(agent.parse_firewall_health(without_app_to_peer_allow))

    def test_negative_when_wg_to_bridge_drop_precedes_established_return(self):
        canonical = (
            '        iifname "wg0" oifname != "wg0" ip daddr 10.0.1.0/24 '
            'ct state established,related accept\n'
            '        iifname "wg0" oifname != "wg0" drop\n'
        )
        reordered = (
            '        iifname "wg0" oifname != "wg0" drop\n'
            '        iifname "wg0" oifname != "wg0" ip daddr 10.0.1.0/24 '
            'ct state established,related accept\n'
        )
        self.assertFalse(
            agent.parse_firewall_health(
                self.HEALTHY_RULESET.replace(canonical, reordered)
            )
        )

    def test_negative_when_final_wg_drop_precedes_app_to_peer_allow(self):
        canonical = (
            '        oifname "wg0" iifname != "wg0" ip saddr '
            '10.0.1.0/24 accept\n'
            '        oifname "wg0" iifname != "wg0" ct state '
            'established,related accept\n'
            '        oifname "wg0" iifname != "wg0" drop\n'
        )
        reordered = (
            '        oifname "wg0" iifname != "wg0" drop\n'
            '        oifname "wg0" iifname != "wg0" ip saddr '
            '10.0.1.0/24 accept\n'
            '        oifname "wg0" iifname != "wg0" ct state '
            'established,related accept\n'
        )
        self.assertFalse(
            agent.parse_firewall_health(
                self.HEALTHY_RULESET.replace(canonical, reordered)
            )
        )

    def test_negative_when_final_wg_drop_is_missing(self):
        without_final_drop = self.HEALTHY_RULESET.replace(
            '        oifname "wg0" iifname != "wg0" drop\n',
            "",
        )
        self.assertFalse(agent.parse_firewall_health(without_final_drop))

    def test_health_reports_effective_revision_and_digest(self):
        state = {"revision": 17, "digest": "abc123"}
        completed = mock.Mock(returncode=0, stdout="13231\n")
        with mock.patch.object(agent, "read_state", return_value=state), \
             mock.patch.object(agent, "interface_exists", return_value=True), \
             mock.patch.object(agent, "firewall_healthy", return_value=True), \
             mock.patch.object(agent.subprocess, "run", return_value=completed):
            snap = agent.health_snapshot()
        self.assertEqual(snap["revision"], 17)
        self.assertEqual(snap["digest"], "abc123")


class TestConntrackDrain(unittest.TestCase):
    def test_missing_conntrack_warns_without_aborting(self):
        with mock.patch.object(
            agent.subprocess, "run", side_effect=FileNotFoundError("conntrack")
        ), mock.patch.object(agent, "log") as log:
            agent.drain_conntrack(["10.70.1.0/24"])
        log.assert_called_once()
        self.assertIn("conntrack no instalado", log.call_args.args[0])


class TestInstallerDockerForwarding(unittest.TestCase):
    def test_installer_persists_docker_user_accept_for_wg_forwarding(self):
        installer = Path(_INSTALLER_PATH).read_text(encoding="utf-8")
        self.assertIn("After=network-online.target docker.service", installer)
        self.assertIn("PartOf=docker.service", installer)
        self.assertIn(
            "ExecStartPre=-/usr/sbin/iptables -D DOCKER-USER -i wg0 -o wg0 -j ACCEPT",
            installer,
        )
        self.assertIn(
            "ExecStartPost=/usr/sbin/iptables -I DOCKER-USER 1 -i wg0 -o wg0 -j ACCEPT",
            installer,
        )


class TestSubnetParsing(unittest.TestCase):
    def test_parse_valid(self):
        self.assertEqual(agent.parse_tenant_subnet("10.70.5.0/24"), agent.ip_to_int("10.70.5.0"))

    def test_reject_bad_octet(self):
        with self.assertRaises(ValueError):
            agent.ip_to_int("10.70.300.0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
