import unittest
from fastapi.testclient import TestClient
from src.api.app import app


class TestApiContracts(unittest.TestCase):
    """Verifies API endpoints contract compliance in-memory."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()

    def test_root_endpoint(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("service"), "Omni RAG")
        self.assertEqual(data.get("version"), "2.0.0")

    def test_health_endpoint(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn(data.get("status"), ["healthy", "ok"])
        self.assertIn("pipeline", data)
        pipeline = data["pipeline"]
        self.assertIn("qdrant", pipeline)
        self.assertIn("llm", pipeline)

    def test_stats_endpoint(self):
        response = self.client.get("/api/stats")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("total_chunks", data)
        self.assertIn("files", data)
        self.assertIsInstance(data["files"], list)

    def test_documents_endpoint(self):
        headers = {"x-user-id": "10d2f529-3fae-4a29-9a5e-312876700ff9"}
        response = self.client.get("/api/documents", headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("documents", data)
        self.assertIsInstance(data["documents"], list)

    def test_sessions_endpoint(self):
        headers = {"x-user-id": "10d2f529-3fae-4a29-9a5e-312876700ff9"}
        response = self.client.get("/api/sessions", headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("sessions", data)
        self.assertIsInstance(data["sessions"], list)

    def test_graph_communities_endpoint(self):
        headers = {"x-user-id": "10d2f529-3fae-4a29-9a5e-312876700ff9"}
        response = self.client.get("/api/graph/communities", headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("communities", data)
        self.assertIsInstance(data["communities"], list)


if __name__ == "__main__":
    unittest.main()
