# Akela — Architektur-Notizen

> Informelle Notizen zum Code: Grundidee, warum DiscoUI, die einzelnen
> Komponenten und der Datenfluss. Ergänzt (nicht ersetzt) `docs/ARCHITECTURE.md`
> und die ADRs in `docs/adr/`.

## 1. Die Grundidee

Die Plattform beantwortet für einen **Block oder eine Transaktion** drei Fragen:

1. **Was** wurde extrahiert? (welches MEV, welcher Typ)
2. **Wie** floss die Ausführung durch **welche Contracts**?
3. **Was bedeutet das?** — interaktiv, von einem LLM-Agenten beantwortet, der
   auf **denselben Daten** arbeitet, die auch die UI zeigt.

Dazu verschmelzen drei bewährte Bausteine: **MEV-Explorer** (Detection),
**DiscoUI** (Visualisierung), **Agentic AI** (Interpretation).

## 2. Warum DiscoUI?

DiscoUI ist der Contract-/Graph-Viewer aus dem L2BEAT-Projekt (Pakete `l2b` +
`protocolbeat` + `discovery`). Der Reiz: L2BEAT hat bereits gelöst, was wir
sonst monatelang selbst bauen müssten —

- **Contract Discovery**: von einer Adresse ausgehend automatisch verbundene
  Contracts, Proxies, Quellcode und ABIs einsammeln (`getDebugTrace()` über
  `debug_traceTransaction`).
- **Source-Browsing + Graph-Rendering**: eine ausgereifte React/Vite-Oberfläche,
  um Contract-Beziehungen als Node/Edge-Graph zu erkunden.

**Aber**: Wir übernehmen es nicht 1:1. ADR-004 ist hier der Schlüssel — die
Entscheidung war **nicht** „DiscoUI als Blackbox laufen lassen“ und **nicht**
„forken“, sondern **Option (c): eigene Apps bauen, die DiscoUIs Muster
adaptieren**. Gründe:

- Die DiscoUI-API ist **intern**: keine Versionierung, kein OpenAPI, Endpoints
  hinter `--readonly` gated, Typen zwischen Paketen dupliziert → instabile Basis.
- Deren Graph-Modell (`ApiProjectResponse`) hat **statische, adressbasierte
  Kanten** aus Contract-Feldern. Für **dynamischen Call-Flow** (eine Trace) ist
  das semantisch schlicht falsch → wir brauchen ein **eigenes Graph-Modell**
  (`@mev/trace-graph`).
- Adressen-Mismatch: L2BEAT nutzt `eth:0x…` (chain-spezifisch), rohe Traces
  nutzen `0x…`. Wird **einmal** an der Adapter-Grenze in `trace-api`
  normalisiert.

Der `l2beat/`-Submodule ist deshalb **read-only, gepinnt und temporär** — reine
Referenzdoku. Endzustand: alles Benötigte ist portiert (mit Provenance-Headern,
die auf den gepinnten Commit zeigen), Submodule fliegt raus.

## 3. Die Komponenten

### Apps (`apps/`, laufen als Container)

| App | Rolle |
|---|---|
| `explorer-api` | Express — MEV-Explorer-API; ruft den Inspector in-process auf, liest Detector-Tabellen, mergt alles zu einem `mev[]` pro Tx. Port des alten `mev-monitor/server.js`. |
| `explorer-web` | Vite-Frontend — Block-Explorer mit Value-over-time-Timeline (3 Serien: Arbitrage/Sandwich/Liquidation). |
| `trace-api` | Express — **die stabile eigene API** (`/api/traces/…/graph`, `/api/contracts/…/code`). Der Adapter-Layer zu DiscoUI-Konzepten; DiscoUI-Typen leaken hier **nicht** durch. |
| `trace-web` | Vite — eigenständiger Trace-Viewer (M2-Artefakt, aus Compose zurückgezogen zugunsten von `disco`). |
| `disco` | Der **protocolbeat-Klon** (gepinnter Commit, vendored `@l2beat/*`-Shims, Änderungen mit `DIVERGENCE(mev)` markiert). Nodes-Panel ist **route-aware**: im Discovery-Projekt = Dependency-Graph, auf Trace-Route = MEV-Execution-Trace über denselben Graph-Stack. |
| `agent-api` | Express — pi-Harness-Agent-Sessions (NDJSON-Streaming). Kein eingebautes Modell/Key — liest beides aus dem pi-Agent-Dir + `.pi/SYSTEM.md`. Treibt die Analyze-/Incident-Panels. |
| `decompiler-api` | Gebündelter Panoramix-Decompiler (bytecode-only), wenn kein verifizierter Quellcode vorliegt. |

### Packages (`packages/`, geteilte Libraries `@mev/*`)

| Package | Rolle |
|---|---|
| `@mev/inspect` | **Der native TS-Inspector** (ADR-010, ersetzt mev-inspect-py). Pipeline: `trace_block` → ABI-Decode (ethers) → Classifier-Spec-Registry (eine Datei pro Protokoll) → Pattern-Matcher → die 5 Custom-Detektoren → `writeBlock`. Wei = `bigint`. |
| `@mev/db` | Besitzt das **ganze Schema** + `migrate()` (läuft beim explorer-api-Boot, ersetzt `alembic`). |
| `@mev/rpc` | Ein **prozessweiter** RPC-Provider (`getProvider()`) — verhindert Socket-Hoarding am connection-gecappten Node. |
| `@mev/trace-graph` | Das **eigene** Trace→Graph-Modell (statt Retrofit von `ApiProjectResponse`). |
| `@mev/evidence` | ADR-016 — snapshot-adressierte Execution-/Contract-Evidence-Typen + Postgres-Adapter. Geteilte Beweisbasis. |
| `@mev/eth` | Aus dem alten `src/` absorbiert: EthClient, PriceOracle, ProfitabilityEngine. |
| `@mev/config` | Unified `.env`-Laden + zod-validiertes Config-Schema. |
| `@mev/flat-store` | Store-Abstraktion (aus dem l2beat-Discovery-Umfeld). |

## 4. Der Datenfluss (Kernprinzip: *decode, then pattern-match*)

```
reth/Erigon RPC (trace_block, debug_traceTransaction)
        │
        ▼
@mev/inspect  ──►  decode/classify  ──►  Pattern-Match + 5 Detektoren
        │                                      │
        ▼                                      ▼
   Postgres (klassifizierte Fakten: swaps, liquidations, …  +  mev_* Tabellen)
        │
   ┌────┴─────────────────────────────┐
   ▼                                  ▼
explorer-api (mev[] pro Tx)     trace-api (Graph + Evidence)
   ▼                                  ▼
explorer-web                       disco  ◄── agent-api (LLM-Verdicts, PoC)
```

Wichtig: Der Inspector läuft **in-process** (ADR-010, kein `docker run` pro Block
mehr). Zwei Hintergrund-Worker teilen sich **eine** serielle Queue am RPC-Node:
der Fill-Worker (füllt lückenlos ab `INSPECT_FLOOR_BLOCK` aufwärts) und der
Head-Follower.

## 5. Wichtige Design-Entscheidungen (ADR-Landkarte)

- **ADR-004** — DiscoUI adaptieren statt forken (siehe oben).
- **ADR-005** — WebGL-Trace-Visualisierung; Trace-Panel als route-aware Variante
  des Nodes-Panels (kein separates Panel).
- **ADR-007** — Trace-Graph mit MEV-Fakten overlayen (`swaps.trace_address` join
  auf Graph-Nodes).
- **ADR-008** — Full Trace Workspace: Hash → alle Legs des Incidents → eine
  gebundene Discovery in ein synthetisches Wegwerf-Projekt `trace-<hash8>`.
- **ADR-009** — Analyze-/Incident-Panel an agent-api; Verdicts,
  `flag_important_nodes`, stateless Follow-up-Chat.
- **ADR-010** — mev-inspect-py als Runtime **retired**, nativ in TS.
- **ADR-011** — Exhaustive Coverage + Value-Timeline.
- **ADR-016** — Shared Evidence + lazy Discovery + Flow-Overlays (`@mev/evidence`).
