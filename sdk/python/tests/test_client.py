import ast
import hashlib
import hmac
import json
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from clawdmarket import (SDK_CONTRACT, ClawdMarketClient, ClawdMarketApiError,
                        ClawdMarketTransportError, ClawdMarketTimeoutError, verify_webhook_signature)

ID = "00000000-0000-4000-8000-000000000001"


class ClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.state = {}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def serve(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                call = {"method": self.command, "path": self.path, "headers": self.headers, "body": json.loads(raw) if raw else None}
                cls.state["calls"].append(call)
                reply = cls.state["reply"](call)
                if reply is None:  # Request may have committed before losing the reply.
                    self.close_connection = True
                    return
                status, content, headers = reply
                content = content if isinstance(content, bytes) else json.dumps(content).encode()
                self.send_response(status)
                for key, value in {"Content-Length": str(len(content)), **headers}.items():
                    self.send_header(key, value)
                self.end_headers()
                try:
                    self.wfile.write(content)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            do_GET = do_POST = do_DELETE = serve

        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.state.update(calls=[], reply=lambda _call: (200, {"ok": True}, {}))
        self.client = ClawdMarketClient("dummy-python-key", f"http://127.0.0.1:{self.server.server_port}")

    def test_planning_reservation_and_read_only_polling(self):
        request = {"client_reference": "saved-python-plan", "objective": "Review authentication", "required_capabilities": ["security-analysis"], "max_budget": {"amount": "1.00", "currency": "USD"}}
        self.client.plan_route(request)
        self.client.execute_route(ID, ID)
        self.client.cancel_route(ID)
        states = iter(["awaiting_buyer", "completed"])
        self.state["reply"] = lambda _call: (200, {"route": {"id": ID, "state": next(states)}}, {})
        self.assertEqual(self.client.wait_for_route(ID, poll_interval=.001)["route"]["state"], "completed")
        calls = self.state["calls"]
        self.assertEqual(calls[0]["body"], request)
        self.assertEqual(calls[1]["body"], {"mandate_id": ID})
        self.assertEqual([c["method"] for c in calls], ["POST", "POST", "DELETE", "GET", "GET"])
        self.assertTrue(all(c["headers"]["Authorization"] == "Bearer dummy-python-key" for c in calls))

    def test_conditional_cancellation_retains_original_order_and_legacy_no_body(self):
        self.client.cancel_route(ID)
        self.client.cancel_route(ID, precondition={"expected_service_order_id": None})
        self.client.cancel_route(ID, precondition={"expected_service_order_id": ID})
        self.assertEqual([call["body"] for call in self.state["calls"]], [None, {"expected_service_order_id": None}, {"expected_service_order_id": ID}])
        self.assertTrue(all(call["method"] == "DELETE" for call in self.state["calls"]))

    def test_lost_mutation_response_requires_explicit_original_replay(self):
        self.state["reply"] = lambda _call: None
        with self.assertRaises(ClawdMarketTransportError) as error:
            self.client.create_buyer_mpp_payment_intent(ID, ID)
        self.assertEqual(error.exception.funds_state, "unknown")
        self.assertEqual(len(self.state["calls"]), 1)
        self.state["reply"] = lambda _call: (200, {"intent": {"id": ID}, "created": False, "claim_required": True}, {})
        original = self.client.create_buyer_mpp_payment_intent(ID, ID)
        self.assertFalse(original["created"])
        self.assertEqual(self.state["calls"][0]["body"], self.state["calls"][1]["body"])

    def test_both_rails_recover_original_claims_and_hashes_without_broadcast(self):
        evm = {"buyer_operation_id": ID, "chain_id": 8453, "token_address": "0x" + "11" * 20, "payer_address": "0x" + "22" * 20}
        proof = {"tx_hash": "0x" + "33" * 32, "payer_address": evm["payer_address"]}
        claim = {"intent_id": ID, "mandate_id": ID, "buyer_operation_id": ID, "serialized_transaction": "0xaabb"}
        self.client.create_buyer_evm_payment_intent(ID, evm)
        self.client.get_buyer_evm_payment_intent(ID)
        self.client.claim_buyer_evm_payment(ID, {**claim, "payer_signature": "dummy-saved-signature"})
        self.client.verify_buyer_evm_funding(ID, {**proof, "intent_id": ID, "chain_id": 8453, "token_address": evm["token_address"], "payer_signature": "dummy-saved-signature"})
        self.client.create_buyer_mpp_payment_intent(ID, ID)
        self.client.get_buyer_mpp_payment_intent(ID)
        self.client.claim_buyer_mpp_payment(ID, claim)
        self.state["reply"] = lambda _call: (202, {"ok": True, "status": "late_payment_refund_processing", "trade": {"id": ID, "status": "cancelled"}}, {})
        self.assertEqual(self.client.verify_buyer_mpp_funding(ID, proof)["status"], "late_payment_refund_processing")
        self.assertEqual(self.state["calls"][-1]["body"], proof)
        self.assertEqual([c["path"].split("/fund/")[1] for c in self.state["calls"]], ["evm/intent", "evm/intent", "evm/claim", "evm", "mpp/intent", "mpp/intent", "mpp/claim", "mpp"])

    def test_typed_financial_errors_preserve_challenge_details_and_retry_after(self):
        payload = {"code": "PAYMENT_CONFIRMING", "message": "Resume original hash", "funds_state": "payment_unknown", "retryable": True, "details": {"tx_hash": "original"}}
        self.state["reply"] = lambda _call: (409, payload, {"Retry-After": "12"})
        with self.assertRaises(ClawdMarketApiError) as error:
            self.client.verify_buyer_mpp_funding(ID, {"tx_hash": "original", "payer_address": "saved"})
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(error.exception.code, "PAYMENT_CONFIRMING")
        self.assertEqual(error.exception.funds_state, "payment_unknown")
        self.assertTrue(error.exception.retryable)
        self.assertEqual(error.exception.payload, payload)
        self.assertEqual(error.exception.retry_after_seconds, 12)
        self.assertEqual(len(self.state["calls"]), 1)

    def test_redirect_cannot_forward_credentials_or_replay_mutation(self):
        self.state["reply"] = lambda _call: (307, {}, {"Location": "/api/another-operation"})
        with self.assertRaisesRegex(ClawdMarketTransportError, "Redirect"):
            self.client.execute_route(ID)
        self.assertEqual(len(self.state["calls"]), 1)

    def test_invalid_and_oversized_responses_preserve_uncertainty(self):
        for content in (b"not-json", b"[]", b"x" * 1_048_577):
            self.state["reply"] = lambda _call: (200, content, {})
            with self.assertRaises(ClawdMarketTransportError) as error:
                self.client.execute_route(ID)
            self.assertEqual(error.exception.funds_state, "unknown")
        self.assertEqual(len(self.state["calls"]), 3)

    def test_artifact_original_upload_replay_and_independent_private_integrity(self):
        content = "Private résumé".encode()
        artifact = {"id": ID, "trade_id": ID, "size_bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(), "download_path": "https://attacker.invalid/ignored"}
        upload = {"client_reference": "saved-python-upload", "name": "result.txt", "content_base64": "saved-original-content", "sha256": artifact["sha256"], "media_type": "text/plain"}
        self.client.upload_artifact(ID, upload)
        self.client.upload_artifact(ID, upload)
        self.client.list_artifacts(ID)
        self.assertEqual(self.state["calls"][0]["body"], self.state["calls"][1]["body"])
        self.state["reply"] = lambda _call: (200, content, {"X-Artifact-SHA256": artifact["sha256"]})
        self.assertEqual(self.client.download_artifact(artifact), content)
        self.assertEqual(self.state["calls"][-1]["path"], f"/api/trades/{ID}/artifacts/{ID}")
        for bad in (b"x" * len(content), content[:-1], content + b"x"):
            self.state["reply"] = lambda _call: (200, bad, {"X-Artifact-SHA256": artifact["sha256"]})
            with self.assertRaises(ClawdMarketTransportError):
                self.client.download_artifact(artifact)

    def test_webhook_and_lifecycle_recovery_use_authenticated_canonical_reads(self):
        self.client.list_webhooks()
        self.client.get_webhook_deliveries()
        self.client.get_work_order(ID)
        self.client.get_service_order(ID)
        self.client.disable_webhook(ID)
        self.client.inspect_route_lifecycle(ID)
        self.client.advance_route(ID, {"version": 1, "action": "observe"})
        self.client.get_route_result(ID)
        self.client.inspect_route_retry(ID)
        self.client.retry_route(ID, {"version": 1, "mandate_id": ID, "previous_trade_id": ID, "retry_operation_id": ID})
        self.client.get_spending_policy()
        self.client.get_route_mandate(ID)
        self.client.create_route_mandate(ID, {"client_reference": "saved-original-approval"})
        self.client.revoke_route_mandate(ID)
        self.client.deliver_trade(ID, {"summary": "Saved delivery", "artifact_ids": [ID]})
        self.assertEqual(len(self.state["calls"]), 15)
        self.assertEqual(self.state["calls"][6]["body"], {"version": 1, "action": "observe"})

    def test_poll_deadline_bounds_slow_http_requests(self):
        def slow(_call):
            time.sleep(.1)
            return 200, {"route": {"id": ID, "state": "planned"}}, {}
        self.state["reply"] = slow
        with self.assertRaises(ClawdMarketTimeoutError) as error:
            self.client.wait_for_route(ID, timeout=.02)
        self.assertEqual(error.exception.route_id, ID)
        self.assertEqual(error.exception.funds_state, "unknown")
        self.assertEqual(len(self.state["calls"]), 1)

    def test_rejects_unsafe_origins_paths_keys_and_poll_bounds_before_http(self):
        for origin in ("http://example.com", "https://user:pass@example.com", "https://example.com/api", "https://example.com?key=x", "https://example.com#x"):
            with self.assertRaises(ValueError):
                ClawdMarketClient("dummy", origin)
        for key in ("", " ", "dummy\r\nInjected: yes"):
            with self.assertRaises(ValueError):
                ClawdMarketClient(key)
        for bad_id in ("../wallet", "https://attacker.invalid", "-" * 36):
            with self.assertRaises(ValueError):
                self.client.get_route(bad_id)
        for bound in (0, -1, float("inf"), float("nan")):
            with self.assertRaises(ValueError):
                self.client.wait_for_route(ID, timeout=bound)
        self.assertEqual(self.state["calls"], [])

    def test_enterprise_generated_paths_scope_and_original_payment_bytes(self):
        key = 'cmos_' + 'ab' * 32
        client = ClawdMarketClient(key, self.client._base)
        scoped = client.organization_spending(ID)
        claim = {'intent_id': ID, 'mandate_id': ID, 'buyer_operation_id': ID, 'serialized_transaction': '0x76aabb'}
        evm = {'buyer_operation_id': ID, 'chain_id': 1, 'token_address': '0x' + '11' * 20, 'payer_address': '0x' + '22' * 20}
        proof = {'tx_hash': '0x' + '33' * 32, 'payer_address': evm['payer_address']}
        order = {'service_id': ID, 'order': {'client_reference': 'saved-checkout-reference', 'objective': 'Review the original approved input', 'payment_rail': 'mpp', 'purchasing_approval_id': ID}}
        scoped.order_service(order)
        scoped.get_order(ID)
        scoped.create_evm_payment_intent(ID, evm)
        scoped.get_evm_payment_intent(ID)
        scoped.claim_evm_payment(ID, {**claim, 'serialized_transaction': '0x02aabb', 'payer_signature': 'original-signature'})
        scoped.verify_evm_funding(ID, {**proof, 'intent_id': ID, 'chain_id': 1, 'token_address': evm['token_address'], 'payer_signature': 'original-signature'})
        scoped.create_tempo_payment_intent(ID, ID)
        scoped.get_tempo_payment_intent(ID)
        scoped.claim_tempo_payment(ID, claim)
        self.state['reply'] = lambda _call: (202, {'status': 'late_payment_refund_processing'}, {})
        self.assertEqual(scoped.verify_tempo_funding(ID, proof)['status'], 'late_payment_refund_processing')
        scoped.submit_original_tempo_credential(ID, 'Payment original.saved.credential')
        operations = ['spending_account_service_order', 'inspect_spending_account_order', 'spending_evm_intent', 'recover_spending_evm_intent', 'spending_evm_claim', 'spending_evm_proof', 'spending_mpp_intent', 'recover_spending_mpp_intent', 'spending_mpp_claim', 'spending_mpp_proof', 'spending_mpp_proof']
        calls = self.state['calls']
        self.assertEqual([(c['method'], c['path']) for c in calls], [(SDK_CONTRACT['operations'][operation]['method'], SDK_CONTRACT['operations'][operation]['path'].replace('{id}', ID).replace('{tradeId}', ID) + ('?order_id=' + ID if index == 1 else '')) for index, operation in enumerate(operations)])
        self.assertEqual(calls[0]['body'], order)
        self.assertEqual(calls[2]['body'], evm)
        self.assertEqual(calls[8]['body'], claim)
        self.assertEqual(calls[9]['body'], proof)
        self.assertTrue(all(c['headers']['Authorization'] == 'Bearer ' + key for c in calls))
        self.assertTrue(all(c['headers'].get('Payment-Authorization') is None for c in calls[:-1]))
        self.assertEqual(calls[-1]['headers']['Payment-Authorization'], 'Payment original.saved.credential')
        self.assertIsNone(calls[-1]['body'])
        for method in ['execute_route', 'create_spending_account', 'create_buyer_mpp_payment_intent', 'deliver_trade']:
            self.assertFalse(hasattr(scoped, method))

    def test_owner_sdk_original_review_and_once_only_replay(self):
        from urllib.parse import urlsplit, parse_qs
        request = {'version': 1, 'client_reference': 'original-reviewed-grant', 'name': 'Exact service grant', 'buyer_agent_id': 'original-buyer', 'team_id': None, 'cost_center': 'review', 'allowed_services': [{'service_id': ID, 'provider_share_id': None}], 'expires_at': '2026-10-11T00:00:00.000Z', 'max_purchase': '1.05', 'max_daily': '1.05', 'max_monthly': '1.05', 'max_lifetime': '1.05'}
        self.state['reply'] = lambda _call: (200, {'api_key': None, 'idempotent': True}, {})
        reference = 'original/?&= £ reference'
        self.client.inspect_spending_accounts(ID)
        self.client.inspect_spending_accounts(ID, reference)
        self.assertIsNone(self.client.create_spending_account(ID, request)['api_key'])
        self.client.revoke_spending_account(ID, ID)
        calls = self.state['calls']
        self.assertEqual(parse_qs(urlsplit(calls[1]['path']).query)['client_reference'], [reference])
        self.assertEqual(calls[2]['body'], request)
        self.assertEqual(calls[3]['body'], {'account_id': ID})
        self.assertEqual([c['method'] for c in calls], ['GET', 'GET', 'POST', 'DELETE'])

    def test_enterprise_sdk_rejects_read_credentials_substitution_and_headers_before_http(self):
        for key in ['cmo_read_only', 'ordinary-buyer-key', 'cmos_' + 'ab' * 31]:
            with self.assertRaises(ValueError):
                ClawdMarketClient(key).organization_spending(ID)
        client = ClawdMarketClient('cmos_' + 'ab' * 32, self.client._base)
        with self.assertRaises(ValueError):
            client.organization_spending('../foreign')
        scoped = client.organization_spending(ID)
        for method in [scoped.get_order, scoped.get_tempo_payment_intent, scoped.get_evm_payment_intent]:
            with self.assertRaises(ValueError):
                method('../foreign')
        for credential in ['', 'Bearer another-key', 'Payment x\r\ny', 'Payment ' + 'a' * 16_384]:
            with self.assertRaises(ValueError):
                scoped.submit_original_tempo_credential(ID, credential)
        with self.assertRaises(ValueError):
            client.inspect_spending_accounts(ID, ' short ')
        with self.assertRaises(ValueError):
            client.revoke_spending_account(ID, '../foreign')
        self.assertEqual(self.state['calls'], [])

    def test_enterprise_lost_mutation_requires_original_inspection_and_explicit_replay(self):
        scoped = ClawdMarketClient('cmos_' + 'ab' * 32, self.client._base).organization_spending(ID)
        self.state['reply'] = lambda _call: None
        with self.assertRaises(ClawdMarketTransportError) as error:
            scoped.create_tempo_payment_intent(ID, ID)
        self.assertEqual(error.exception.funds_state, 'unknown')
        self.assertEqual(len(self.state['calls']), 1)
        self.state['reply'] = lambda _call: (200, {'intent': {'id': ID}, 'created': False}, {})
        scoped.get_tempo_payment_intent(ID)
        self.assertFalse(scoped.create_tempo_payment_intent(ID, ID)['created'])
        self.assertEqual([c['body'] for c in self.state['calls']], [{'buyer_operation_id': ID}, None, {'buyer_operation_id': ID}])
        self.state['reply'] = lambda _call: (401, {'error_code': 'SPENDING_ACCOUNT_INACTIVE', 'state': 'payment_unknown', 'retryable': False}, {})
        with self.assertRaises(ClawdMarketApiError) as error:
            scoped.get_tempo_payment_intent(ID)
        self.assertFalse(error.exception.retryable)
        self.assertEqual(len(self.state['calls']), 4)

    def test_every_client_operation_exists_in_generated_contract(self):
        # Prevent a wrapper silently referring to a stale/renamed canonical operation.
        source = Path(__file__).resolve().parents[1] / "clawdmarket/client.py"
        tree = ast.parse(source.read_text() + "\n" + source.with_name("enterprise.py").read_text())
        operations = [node.args[0].value for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ("_call", "_path") and node.args and isinstance(node.args[0], ast.Constant)]
        self.assertGreaterEqual(len(operations), 30)
        for operation in operations:
            self.assertTrue(operation in SDK_CONTRACT["operations"], f"Unknown operation {operation}")

    def test_raw_webhook_signature_rejects_mutation_and_wrong_secret(self):
        body = json.dumps({"delivery_id": ID, "event": "work_order.ready", "data": {"label": "résumé"}}, ensure_ascii=False).encode()
        signature = "sha256=" + hmac.new(b"dummy-webhook-secret", body, hashlib.sha256).hexdigest()
        self.assertTrue(verify_webhook_signature("dummy-webhook-secret", body, signature))
        self.assertFalse(verify_webhook_signature("dummy-webhook-secret", body + b" ", signature))
        self.assertFalse(verify_webhook_signature("wrong", body, signature))
        self.assertFalse(verify_webhook_signature("", body, signature))
        self.assertFalse(verify_webhook_signature("dummy-webhook-secret", body, signature.upper()))


if __name__ == "__main__":
    unittest.main()
