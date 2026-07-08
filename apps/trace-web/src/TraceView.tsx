import type { TraceCallNode, TraceGraph } from "@mev/trace-graph";
import { useEffect, useMemo, useState } from "react";

function short(address: string | null): string {
  if (!address) return "—";
  return `${address.slice(0, 8)}…${address.slice(-4)}`;
}

function CallNode({
  node,
  childrenOf,
  onSelectAddress,
}: {
  node: TraceCallNode;
  childrenOf: Map<string | null, TraceCallNode[]>;
  onSelectAddress: (address: string) => void;
}) {
  // deep chains auto-collapse; the user expands what they care about
  const [open, setOpen] = useState(node.depth < 3);
  const children = childrenOf.get(node.id) ?? [];

  return (
    <li className={node.error ? "call reverted" : "call"}>
      <div className="call-row">
        {children.length > 0 && (
          <button type="button" className="toggle" onClick={() => setOpen(!open)}>
            {open ? "▾" : "▸"}
          </button>
        )}
        <span className={`kind kind-${node.type.toLowerCase()}`}>{node.type}</span>
        <button type="button" className="addr" onClick={() => node.to && onSelectAddress(node.to)}>
          {short(node.to)}
        </button>
        {node.selector && <code className="selector">{node.selector}</code>}
        {node.valueWei && <span className="value">{Number(node.valueWei) / 1e18} ETH</span>}
        {node.gasUsed && <span className="gas">{Number(node.gasUsed).toLocaleString()} gas</span>}
        {node.logCount > 0 && <span className="logs">{node.logCount} logs</span>}
        {node.error && <span className="revert">{node.revertReason || node.error}</span>}
      </div>
      {open && children.length > 0 && (
        <ul>
          {children.map((child) => (
            <CallNode
              key={child.id}
              node={child}
              childrenOf={childrenOf}
              onSelectAddress={onSelectAddress}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TraceView({
  txHash,
  onSelectAddress,
}: {
  txHash: string;
  onSelectAddress: (address: string) => void;
}) {
  const [graph, setGraph] = useState<TraceGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGraph(null);
    setError(null);
    fetch(`/api/traces/${txHash}/graph`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
        return res.json() as Promise<TraceGraph>;
      })
      .then(setGraph)
      .catch((err) => setError(err.message));
  }, [txHash]);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, TraceCallNode[]>();
    for (const node of graph?.nodes ?? []) {
      if (!map.has(node.parentId)) map.set(node.parentId, []);
      map.get(node.parentId)?.push(node);
    }
    return map;
  }, [graph]);

  if (error) return <p className="error">{error}</p>;
  if (!graph) return <p>Loading trace…</p>;

  const root = graph.nodes.find((n) => n.id === "root");

  return (
    <section>
      <h2>
        Trace <code>{short(graph.transactionHash)}</code>
      </h2>
      <p className="meta">
        {graph.nodeCount} calls · depth {graph.maxDepth} · {graph.tokenTransfers.length} token
        transfers
      </p>
      {root && (
        <ul className="tree">
          <CallNode node={root} childrenOf={childrenOf} onSelectAddress={onSelectAddress} />
        </ul>
      )}
      {graph.tokenTransfers.length > 0 && (
        <>
          <h3>Token transfers</h3>
          <table>
            <thead>
              <tr>
                <th>call</th>
                <th>token</th>
                <th>from</th>
                <th>to</th>
                <th>amount (raw)</th>
              </tr>
            </thead>
            <tbody>
              {graph.tokenTransfers.map((t, i) => (
                <tr key={`${t.nodeId}-${i}`}>
                  <td>
                    <code>{t.nodeId}</code>
                  </td>
                  <td>
                    <button type="button" className="addr" onClick={() => onSelectAddress(t.token)}>
                      {short(t.token)}
                    </button>
                  </td>
                  <td>{short(t.from)}</td>
                  <td>{short(t.to)}</td>
                  <td>{t.amountRaw}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
