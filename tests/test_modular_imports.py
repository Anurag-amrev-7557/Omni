"""Verification Tests for Modular Package Architecture and Public Symbol Exports."""
import unittest


class TestModularImports(unittest.TestCase):
    """Verifies that all domain packages expose their expected public APIs."""

    def test_retrieval_package(self):
        import src.retrieval as r
        self.assertTrue(callable(r.hybrid_search))
        self.assertTrue(callable(r.get_embeddings))
        self.assertTrue(callable(r.get_reranker))

    def test_generation_package(self):
        import src.generation as g
        self.assertTrue(callable(g.reformulate_query))
        self.assertTrue(callable(g.decompose_query))
        self.assertTrue(callable(g.prepare_context_and_prompt))
        self.assertTrue(callable(g.answer_query_stream))
        self.assertTrue(callable(g.invoke_groq_with_fallback))

    def test_ingestion_package(self):
        import src.ingestion as i
        self.assertTrue(callable(i.load_pages_with_pymupdf))
        self.assertTrue(callable(i.load_pages_from_bytes))
        self.assertTrue(callable(i.render_pdf_page_image))
        self.assertTrue(callable(i.get_pdf_page_count))
        self.assertTrue(callable(i.ingest_pdf))
        self.assertTrue(callable(i.ingest_file))

    def test_storage_package(self):
        import src.storage.vector_store as db
        self.assertTrue(callable(db.get_qdrant_client))
        self.assertTrue(callable(db.init_db))
        self.assertTrue(callable(db.get_collection_stats))

        import src.storage.chat_db as cdb
        self.assertTrue(callable(cdb.init_chat_db))
        self.assertTrue(callable(cdb.create_session))
        self.assertTrue(callable(cdb.get_all_sessions))
        self.assertTrue(callable(cdb.get_session_messages))

        import src.storage.docs_db as ddb
        self.assertTrue(callable(ddb.init_docs_db))
        self.assertTrue(callable(ddb.upsert_document_record))
        self.assertTrue(callable(ddb.get_user_documents))

        import src.storage.file_storage as s
        self.assertTrue(callable(s.upload_file))
        self.assertTrue(callable(s.download_file))

    def test_core_auth_package(self):
        import src.core.auth as a
        self.assertTrue(callable(a.get_current_user))
        self.assertTrue(callable(a.require_user))

    def test_graph_package(self):
        import src.graph as graph
        self.assertTrue(callable(graph.get_user_graph))
        self.assertTrue(callable(graph.init_graph_db))
        self.assertTrue(callable(graph.sync_and_prune_graph))
        self.assertTrue(callable(graph.extract_and_cluster))
        self.assertTrue(callable(graph.run_community_detection_and_summaries))
        self.assertTrue(callable(graph.extract_entities_and_relations))
        self.assertTrue(callable(graph.traverse_subgraph))

    def test_api_entrypoint(self):
        import src.api as api
        self.assertTrue(hasattr(api, "app"))


if __name__ == "__main__":
    unittest.main()
