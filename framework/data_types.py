from dataclasses import dataclass
from typing import List, Dict, Any, Optional



@dataclass
class TraceEvent:
    """Represents a single event in the execution trace of a smart contract call."""
    from_address: str # the address that initiates this sub-call
    to_address: str # the destination address that receives this sub-call
    method: str # the specific function that is called in this sub-call, corresponds to first 4 bytes of the call data
    value: int
    call_type: str # EVM opcode used to make the call (e.g., CALL, DELEGATECALL, etc.)
    
class CallNode:
    def __init__(self, trace_dict):
        # Handle both dicts and objects (like TraceEvent dataclass) for maximum compatibility
        if isinstance(trace_dict, dict):
            self.from_addr = trace_dict.get('from_address', trace_dict.get('from'))
            self.to_addr = trace_dict.get('to_address', trace_dict.get('to'))
            self.method = trace_dict.get('method')
            self.call_type = trace_dict.get('call_type', trace_dict.get('type'))
            self.value = trace_dict.get('value', 0)
        else:
            self.from_addr = getattr(trace_dict, 'from_address', getattr(trace_dict, 'from', None))
            self.to_addr = getattr(trace_dict, 'to_address', getattr(trace_dict, 'to', None))
            self.method = getattr(trace_dict, 'method', None)
            self.call_type = getattr(trace_dict, 'call_type', getattr(trace_dict, 'type', None))
            self.value = getattr(trace_dict, 'value', 0)
            
        self.children = []
        self.parent = None  # CRITICAL: Added to support upstream k-hop traversal

    def to_dict(self):
        return {
            "from": self.from_addr,
            "to": self.to_addr,
            "method": self.method,
            "type": self.call_type,
            "value": self.value,
            "children": [c.to_dict() for c in self.children]
        }