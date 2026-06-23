from dataclasses import dataclass
from typing import List, Dict, Any, Optional



@dataclass
class TraceEvent:
    """Represents a single event in the execution trace of a smart contract call."""
    from_address: str #the adress that initiates this sub-call
    to_address: str #the destination adress that receives this sub-call
    method: str #the specific function that is called in this sub-call, corresponds to first 4 bytes of the call data
    value: int
    call_type: str #EVM opcode used to make the call (e.g., CALL, DELEGATECALL, etc.)
    
class CallNode:
    def __init__(self, trace_dict):
        self.from_addr = trace_dict['from']
        self.to_addr = trace_dict['to']
        self.method = trace_dict['method']
        self.call_type = trace_dict['type']
        self.children = []

    def to_dict(self):
        return {
            "from": self.from_addr,
            "to": self.to_addr,
            "method": self.method,
            "type": self.call_type,
            "children": [c.to_dict() for c in self.children]
        }