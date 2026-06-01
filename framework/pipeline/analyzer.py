from typing import List, Dict
from framework.data_types import TraceEvent, CallNode

class Analyzer:
    def construct_call_graph(self, flat_events: List[TraceEvent]) -> List[str, CallNode]:
        call_graph = {}
        return call_graph
    
    def extract_features(self, path: List[CallNode]) -> Dict:
        pass
    
    def extract_k_hop_subgraph(self, path: List[CallNode], k: int=1):
        pass