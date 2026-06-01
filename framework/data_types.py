from dataclasses import dataclass
from typing import List, Dict, Optional

@dataclass
class TraceEvent:
    """Represents a single event in the execution trace of a smart contract call."""
    from_address: str #the adress that initiates this sub-call
    to_address: str #the destination adress that receives this sub-call
    method: str #the specific function that is called in this sub-call, corresponds to first 4 bytes of the call data
    value: int
    call_type: str #EVM opcode used to make the call (e.g., CALL, DELEGATECALL, etc.)
    
class CallNode:
    """Represents a node in the call tree of a smart contract execution."""
    def __init__(self, trace: TraceEvent):
        self.event = trace
        self.children: List['CallNode'] = []
    
    def __repr__(self):
        return f"CallNode({self.trace.method} : {self.trace.from_addr[:6]} -> {self.trace.to_addr[:6]})"