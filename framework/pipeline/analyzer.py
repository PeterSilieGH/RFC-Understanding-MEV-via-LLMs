from typing import List, Dict
from framework.data_types import TraceEvent, CallNode

class Analyzer:
    def reconstruct_call_tree(self, flat_traces):
        """
        Implementation of TraceLLM Algorithm 1: 
        Reconstruction of call trees from flat EVM traces.
        """
        if not flat_traces:
            return []

        calls = [CallNode(t) for t in flat_traces]
        forest = []
        stack = []

        for i, call in enumerate(calls):
            # Rule 1: New root if stack empty or caller doesn't match previous callee
            if i == 0 or (stack and call.from_addr != calls[i-1].to_addr):
                forest.append(call)
                stack = [call]
            else:
                # Pop stack until we find the parent where parent.to == call.from
                while stack and call.from_addr != stack[-1].to_addr:
                    stack.pop()
                
                if stack:
                    parent = stack[-1]
                    parent.children.append(call)
                    stack.append(call)
                else:
                    # Fallback for orphaned traces
                    forest.append(call)
                    stack.append(call)
                    
        return forest

    def extract_execution_paths(self, tree_nodes):
        """Extracts root-to-leaf paths for feature extraction & LLM prompting."""
        all_paths = []
        
        def dfs(node, current_path):
            current_path.append(f"{node.to_addr[:8]}::{node.method}")
            if not node.children:
                all_paths.append(list(current_path))
            else:
                for child in node.children:
                    dfs(child, current_path)
            current_path.pop()

        for root in tree_nodes:
            dfs(root, [])
            
        return all_paths