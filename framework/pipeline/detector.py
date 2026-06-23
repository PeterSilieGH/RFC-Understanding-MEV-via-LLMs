from web3 import Web3


class Detector:
    def __init__(self, web3_instance):
        self.w3 = web3_instance

    def get_transaction_trace(self, tx_hash):
        """
        Extracts execution traces using the local node.
        Uses debug_traceTransaction to capture CALL, DELEGATECALL, etc.
        """
        try:
            # Make the raw RPC request using the older Web3 v5/v6 syntax
            response = self.w3.provider.make_request(
                "debug_traceTransaction", 
                [tx_hash, {"tracer": "callTracer"}]
            )
            # make_request returns the full JSON-RPC response, so we extract 'result'
            return response.get('result')
        except Exception as e:
            print(f"Error fetching trace: {e}")
            return None
            
    def parse_flat_traces(self, raw_trace):
        """Flattens a nested callTracer output into a list of calls for the Analyzer."""
        flat_list = []
        
        def traverse(node):
            if not node: return
            flat_list.append({
                "from": node.get("from", ""),
                "to": node.get("to", ""),
                "method": node.get("input", "0x")[:10], # Extract 4-byte selector
                "value": node.get("value", "0x0"),
                "type": node.get("type", "CALL")
            })
            for call in node.get("calls", []):
                traverse(call)
                
        traverse(raw_trace)
        return flat_list