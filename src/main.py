import os
import sys
import argparse

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

try:
    from src.db import init_db
    from src.ingest import ingest_file
    from src.generate import answer_query
except ImportError:
    from db import init_db
    from ingest import ingest_file
    from generate import answer_query

def main():
    parser = argparse.ArgumentParser(description="Multi-Document RAG CLI")
    parser.add_argument("--init", action="store_true", help="Initialize the database schema")
    parser.add_argument("--ingest", type=str, help="Path to PDF file to ingest")
    parser.add_argument("--query", type=str, help="Question to ask the RAG system")
    
    args = parser.parse_args()
    
    if args.init:
        init_db()
    elif args.ingest:
        ingest_file(args.ingest)
    elif args.query:
        answer = answer_query(args.query)
        print("\n=== ANSWER ===")
        print(answer)
        print("==============\n")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()