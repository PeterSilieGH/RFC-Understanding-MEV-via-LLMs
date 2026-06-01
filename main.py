from framework.pipeline.parser import Parser
from framework.pipeline.detector import Detector
from framework.pipeline.extractor import Extractor
from framework.pipeline.analyzer import Analyzer
from framework.pipeline.reporter import Reporter

class FrameworkPipeline:
    def __init__(self, web3provider, llm_client, vector_db, etherscan_api):
        self.parser = Parser(llm_client, vector_db)
        self.detector = Detector(web3provider)
        self.extractor = Extractor(llm_client, etherscan_api)
        self.analyzer = Analyzer()
        self.reporter = Reporter(llm_client)
        
    def forward(self, query: str) -> str:
        # Step 1: Parse the query
        target_scope = self.parser.parse(query)
        target_address = target_scope['contracts']['address']
        
        # Step 2: Detect relevant contracts
        logical_address = self.detector.resolve_implementation(target_address)
        traces = self.detector.fetch_transaction_traces(logical_address, target_scope=['time']['start_block'], target_scope=['time']['end_block'])
        
        # Step 3: Extract data from detected contracts
        extracted_data = self.extractor.get_code(logical_address)
        
        # Step 4: Analyze the extracted data
        call_tree = self.analyzer.build_call_tree(traces)
        suspicious_path = self._find_most_anomalous_path(call_tree)
        subgraph = self.analyzer.extract_k_hop_subgraph(suspicious_path, k=1)
        
        # Step 5: Generate a report based on the analysis
        print("Generating report...")
        report_prompt = (f"Analyze this blockchain security incident.\n"
                  f"Contract Code:\n{extracted_data}\n\n"
                  f"Anomaly Trace Subgraph:\n{subgraph}\n")
        
        report = self.llm.generate(report_prompt)
        
        return report
    
    def _find_most_anomalous_path(self, call_tree: List[CallNode]) -> List[CallNode]:
        """Helper to traverse the tree, score paths, and return the highest risk path."""
        # Implementation of the logistic regression scoring goes here
        pass