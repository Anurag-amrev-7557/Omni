"""Enterprise RAG verification tests for adaptive chunking and parent deduplication."""
import unittest
from unittest.mock import patch, MagicMock
from langchain_core.documents import Document

from src.ingestion.chunking import split_hierarchical_chunks
from src.retrieval.service import hybrid_search
from src.generation.service import prepare_context_and_prompt


class TestEnterpriseRAG(unittest.TestCase):
    def test_adaptive_chunking_single_page(self):
        """Single-page or brief document must preserve full page as unified parent."""
        doc_content = "Section 1: Introduction\n" + "A" * 1000 + "\nSection 2: Projects\nProject 1\nProject 2\nProject 3"
        page = Document(page_content=doc_content, metadata={"page": 1})
        parents, children = split_hierarchical_chunks([page], "Overview", "test.pdf", "user_1")

        self.assertEqual(len(parents), 1)
        self.assertIn("Project 1", parents[0].page_content)
        self.assertIn("Project 2", parents[0].page_content)
        self.assertIn("Project 3", parents[0].page_content)
        self.assertTrue(len(children) > 1)
        # Verify contextual enrichment
        self.assertIn("Document: test.pdf (Page 1)", children[0].page_content)

    def test_adaptive_chunking_large_document(self):
        """Large documents with multiple pages split cleanly into structured parents."""
        pages = [
            Document(page_content=f"Page {i} content: " + "data " * 600, metadata={"page": i})
            for i in range(1, 6)
        ]
        parents, children = split_hierarchical_chunks(pages, "Doc Overview", "manual.pdf", "user_1")
        self.assertTrue(len(parents) >= 5)
        self.assertTrue(len(children) > len(parents))

    @patch("src.retrieval.service.get_embeddings")
    @patch("src.retrieval.service.init_db")
    @patch("src.retrieval.service.get_qdrant_client")
    @patch("src.retrieval.service.QdrantVectorStore")
    def test_parent_window_deduplication_in_hybrid_search(self, mock_vstore, mock_get_client, mock_init_db, mock_get_emb):
        """Multiple matching child chunks pointing to the same parent must be deduplicated."""
        mock_docs = [
            (MagicMock(
                page_content="child 1 snippet",
                metadata={"parent_id": "parent_AAA", "parent_content": "Full Parent Content AAA", "filename": "doc.pdf", "page": 1}
            ), 0.9),
            (MagicMock(
                page_content="child 2 snippet",
                metadata={"parent_id": "parent_AAA", "parent_content": "Full Parent Content AAA", "filename": "doc.pdf", "page": 1}
            ), 0.85),
            (MagicMock(
                page_content="child 3 snippet",
                metadata={"parent_id": "parent_BBB", "parent_content": "Full Parent Content BBB", "filename": "doc.pdf", "page": 2}
            ), 0.8),
        ]

        mock_inst = MagicMock()
        mock_inst.similarity_search_with_score.return_value = mock_docs
        mock_vstore.return_value = mock_inst

        results = hybrid_search("test query", k=5, user_id="test-uid-12345")
        # Should have exactly 2 distinct parent windows, not duplicate AAA
        self.assertEqual(len(results), 2)
        parent_ids = [r["parent_id"] for r in results]
        self.assertEqual(parent_ids, ["parent_AAA", "parent_BBB"])

    def test_aggregation_query_retrieves_expanded_k(self):
        """Aggregation queries like 'what are the projects' request higher k."""
        with patch("src.generation.service.get_collection_stats", return_value={"files": ["doc.pdf"]}), \
             patch("src.generation.service.hybrid_search", return_value=[{"content": "c1", "filename": "doc.pdf", "page": 1}]) as mock_search:
            prepare_context_and_prompt("whtat are the projects?", user_id="test-user")
            self.assertTrue(mock_search.called)
            called_k = mock_search.call_args[1].get("k")
            self.assertEqual(called_k, 8)


if __name__ == "__main__":
    unittest.main()
