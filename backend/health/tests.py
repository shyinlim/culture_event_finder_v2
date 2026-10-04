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
