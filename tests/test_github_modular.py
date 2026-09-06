"""Unit tests for modular GitHub client, sync, and backward-compatible shim."""
import unittest
from unittest.mock import patch, MagicMock

from src.github.client import parse_github_repo_url, IGNORED_PATTERNS
from src.github.sync import sync_github_files
import src.github as gh_pkg


class TestGitHubModular(unittest.TestCase):
    def test_parse_github_repo_url(self):
        self.assertEqual(parse_github_repo_url("owner/repo"), ("owner", "repo"))
        self.assertEqual(parse_github_repo_url("https://github.com/owner/repo"), ("owner", "repo"))
        self.assertEqual(parse_github_repo_url("https://github.com/owner/repo.git"), ("owner", "repo"))
        self.assertEqual(parse_github_repo_url("github.com/owner/repo"), ("owner", "repo"))
        with self.assertRaises(ValueError):
            parse_github_repo_url("invalid_url")

    def test_github_package_exports(self):
        self.assertTrue(callable(gh_pkg.parse_github_repo_url))
        self.assertTrue(callable(gh_pkg.get_repo_details))
        self.assertTrue(callable(gh_pkg.fetch_repo_tree))
        self.assertTrue(callable(gh_pkg.fetch_raw_file_content))
        self.assertTrue(callable(gh_pkg.sync_github_files))
        self.assertTrue(callable(gh_pkg.sync_github_files_stream))
        self.assertIn(".git", gh_pkg.IGNORED_PATTERNS)

    @patch("src.github.sync.fetch_repo_tree")
    def test_sync_github_files_empty_handling(self, mock_tree):
        mock_tree.return_value = {"files": []}
        res = sync_github_files("testowner", "testrepo")
        self.assertFalse(res["success"])
        self.assertEqual(res["ingested_count"], 0)


if __name__ == "__main__":
    unittest.main()
