import sys
import argparse
from src.db import init_db
from src.ingest import ingest_pdf
from src.generate import answer_query

def main():
    parser = argparse.ArgumentParser(description="Multi-Document RAG CLI")
    parser.add_argument("--init", action="store_true", help="Initialize the database schema")
    parser.add_argument("--ingest", type=str, help="Path to PDF file to ingest")
    parser.add_argument("--query", type=str, help="Question to ask the RAG system")
    
    args = parser.parse_args()
    
    if args.init:
        init_db()
    elif args.ingest:
        ingest_pdf(args.ingest)
    elif args.query:
        answer = answer_query(args.query)
        print("\n=== ANSWER ===")
        print(answer)
        print("==============\n")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()