import { useEffect, useState } from "react";

interface Meta {
  address: string;
  verified: boolean;
  name: string | null;
  compilerVersion: string | null;
  isProxy: boolean;
  implementation: string | null;
  abiEntryCount: number;
  sourceFileCount: number;
}

interface Code {
  address: string;
  entryName: string | null;
  sources: { name: string; code: string }[];
}

export function AddressView({ address }: { address: string }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [code, setCode] = useState<Code | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMeta(null);
    setCode(null);
    setSelected(0);
    setError(null);
    Promise.all([
      fetch(`/api/contracts/${address}/meta`).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
        return res.json() as Promise<Meta>;
      }),
      fetch(`/api/contracts/${address}/code`).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
        return res.json() as Promise<Code>;
      }),
    ])
      .then(([m, c]) => {
        setMeta(m);
        setCode(c);
      })
      .catch((err) => setError(err.message));
  }, [address]);

  if (error)
    return (
      <p className="error">
        {address}: {error}
      </p>
    );
  if (!meta || !code) return <p>Loading contract…</p>;

  return (
    <section>
      <h2>
        {meta.name ?? "Unverified contract"} <code>{meta.address}</code>
      </h2>
      <p className="meta">
        {meta.verified ? `verified · ${meta.compilerVersion}` : "not verified"}
        {meta.isProxy && meta.implementation && (
          <>
            {" "}
            · proxy → <code>{meta.implementation}</code>
          </>
        )}{" "}
        · {meta.abiEntryCount} ABI entries · {meta.sourceFileCount} source files
      </p>
      {code.sources.length > 0 && (
        <>
          <div className="file-tabs">
            {code.sources.map((s, i) => (
              <button
                type="button"
                key={s.name}
                className={i === selected ? "tab active" : "tab"}
                onClick={() => setSelected(i)}
              >
                {s.name.split("/").pop()}
              </button>
            ))}
          </div>
          <pre className="source">
            <code>{code.sources[selected]?.code}</code>
          </pre>
        </>
      )}
    </section>
  );
}
