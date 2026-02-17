import unittest

from server.telemetry import redact_text


class TelemetryRedactionTests(unittest.TestCase):
    def test_redacts_assignment_style_secrets(self):
        sample = "token=abc123 password:letmein SECRET = topsecret api-key=mykey api_key=other"
        redacted = redact_text(sample)

        self.assertNotIn("abc123", redacted)
        self.assertNotIn("letmein", redacted)
        self.assertNotIn("topsecret", redacted)
        self.assertNotIn("mykey", redacted)
        self.assertNotIn("other", redacted)
        self.assertGreaterEqual(redacted.count("[REDACTED]"), 5)

    def test_redacts_bearer_tokens_with_whitespace(self):
        sample = "Authorization: Bearer abc.DEF_123-xyz"
        redacted = redact_text(sample)

        self.assertNotIn("abc.DEF_123-xyz", redacted)
        self.assertIn("Authorization: [REDACTED]", redacted)

    def test_leaves_non_secret_text_intact(self):
        sample = "normal text with no credentials"
        self.assertEqual(redact_text(sample), sample)


if __name__ == '__main__':
    unittest.main()
