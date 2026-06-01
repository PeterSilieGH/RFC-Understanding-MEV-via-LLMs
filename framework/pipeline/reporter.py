class Reporter:
    def __init__(self, llm_client):
        self.llm_client = llm_client

    def create_report(self, contract_code: str, subgraph_context: str) -> str:
        prompt = f"Analyze this blockchain security incident.\n"f"Contract Code:\n{contract_code}\n\n"f"Anomaly Trace Subgraph:\n{subgraph_context}\n"
        response = self.llm_client.generate(prompt)
        return response