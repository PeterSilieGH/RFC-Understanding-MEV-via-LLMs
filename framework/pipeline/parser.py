from typing import Dict

class Parser:
    def __init__(self, llm_client, vector_db):
        self.llm_client = llm_client
        self.vector_db = vector_db
        
    def parse(self, query: str) -> Dict:
        """Parse the natural language query into a machine-readable format. Uses its vector database to find relevant context and the LLM to generate a structured representation."""
        context = self.vector_db.search(query)
        prompt = f"Normalize the following query: '{query}' with respect to the context: '{context}'"
        return self.llm_client.generate_json(prompt)        