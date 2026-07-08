import { isTxHash, normalizeAddress } from "@mev/trace-graph";
import { useState } from "react";
import { AddressView } from "./AddressView.js";
import { TraceView } from "./TraceView.js";

type Target = { kind: "tx"; txHash: string } | { kind: "address"; address: string } | null;

export function App() {
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<Target>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (isTxHash(value)) {
      setError(null);
      setTarget({ kind: "tx", txHash: value.toLowerCase() });
      return;
    }
    const address = normalizeAddress(value);
    if (address) {
      setError(null);
      setTarget({ kind: "address", address });
      return;
    }
    setError("Enter a transaction hash (0x…, 32 bytes) or an address (0x… / eth:0x…)");
  }

  return (
    <main>
      <h1>MEV Trace Explorer</h1>
      <form onSubmit={submit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Transaction hash or contract address"
          spellCheck={false}
        />
        <button type="submit">Load</button>
      </form>
      {error && <p className="error">{error}</p>}
      {target?.kind === "tx" && (
        <TraceView
          txHash={target.txHash}
          onSelectAddress={(a) => setTarget({ kind: "address", address: a })}
        />
      )}
      {target?.kind === "address" && <AddressView address={target.address} />}
    </main>
  );
}
