from typing import List 
from framework.data_types import TraceEvent

class Detector:
    def __init__(self, web3_provider):
        self.w3 = web3_provider

    def resolve_implementation(self, proxy_address: str) -> str:
        pass

    def get_creator(self, address: str) -> str:
        pass

    def fetch_transaction_traces(self, address: str, start_block: int, end_block: int) -> List[TraceEvent]:
        pass