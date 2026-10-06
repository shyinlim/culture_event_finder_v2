from django.test import SimpleTestCase, Client

class HealthCheckTests(SimpleTestCase):
    def setUp(self):
        self.client = Client()

    def test_health_check_returns_200_json(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_health_check_with_trailing_slash(self):
        response = self.client.get("/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_root_endpoint_returns_200(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        if "application/json" in response.get("Content-Type", ""):
            data = response.json()
            self.assertEqual(data["status"], "ok")
            self.assertEqual(data["service"], "culture-event-finder-backend")
            self.assertIn("endpoints", data)
        else:
            self.assertIn("text/html", response.get("Content-Type", ""))

