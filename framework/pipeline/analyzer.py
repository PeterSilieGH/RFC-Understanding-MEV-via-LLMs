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

class Analyzer:
    def reconstruct_call_tree(self, flat_traces: List[Any]) -> List[CallNode]:
        """
        Reconstructs the hierarchical call tree from a flat list of trace events.
        """
        if not flat_traces:
            return []
            
        trees = []
        stack = []
        
        for trace in flat_traces:
            node = CallNode(trace)
            
            if not stack:
                trees.append(node)
                stack.append(node)
            else:
                while stack and stack[-1].to_addr != node.from_addr:
                    stack.pop()
                    
                if stack:
                    parent = stack[-1]
                    parent.children.append(node)
                    stack.append(node)
                else:
                    trees.append(node)
                    stack.append(node)
                    
        return trees

    def extract_execution_paths(self, call_tree: List[CallNode]) -> List[List[CallNode]]:
        """
        Extracts all root-to-leaf paths using Depth First Search (DFS).
        """
        paths = []
        
        def dfs(node: CallNode, current_path: List[CallNode]):
            current_path.append(node)
            
            if not node.children:
                paths.append(list(current_path))
            else:
                for child in node.children:
                    dfs(child, current_path)
                    
            current_path.pop()

        for root in call_tree:
            dfs(root, [])
            
        return paths