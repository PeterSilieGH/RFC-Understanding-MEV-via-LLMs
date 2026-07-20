// Per-skill task instructions (ADR-009). The shared MEV-expert framing and
// research-ethics constraint live in `.pi/SYSTEM.md` (the system prompt); these
// are the user-prompt lead-ins that tell the agent which panel context it is
// looking at and what to report for this specific run.

export const ANALYZE_CODE_TASK = [
  "Review the contract code below from an MEV standpoint. You are given the",
  "function signatures declared across the selected contracts — call",
  "get_function_code to pull any body you need. Report what the contracts do,",
  "the MEV-relevant surface (swaps, price reads, callbacks, flash-loan hooks,",
  "access control, reentrancy, slippage), and each contract's likely role",
  "(searcher/bot, victim, AMM/DEX, lending market, infrastructure). Ground every",
  "conclusion in named function signatures.",
].join(" ");

export const ANALYZE_VALUE_TASK = [
  "Review the contract state and ABI below from an MEV standpoint. Report what",
  "the state says about each contract's role in the transaction — balances,",
  "reserves, prices, ownership/roles, configuration — and whether the values are",
  "consistent with an arbitrage, sandwich, liquidation, JIT-liquidity, or benign",
  "interaction. Ground every conclusion in named state fields. If contract source",
  "was also submitted, use get_function_code for bodies you need.",
].join(" ");

export const BUILD_PREVIEW_TASK = [
  "Write a final verdict about this transaction (or, for a multi-transaction MEV",
  "incident, the whole bundle) by synthesizing the prior per-contract analyses",
  "below. You are also given a structural trace tree (call hierarchy with",
  "signatures and the contracts involved) and, when available, the decoded swaps",
  "with their token amounts in/out — use the trace tree to reason about how the",
  "calls fit together and the swaps to reason about value flow (direction, sizes,",
  "imbalances), without deep per-function analysis. No new source or state is",
  "available beyond the transcripts. Produce: a one-line classification (e.g.",
  '"atomic arbitrage", "sandwich (frontrun+backrun)", "liquidation", "benign",',
  '"inconclusive"); a short explanation of how the pieces fit that classification;',
  "and your confidence, noting missing evidence if it is low. Do not invent facts",
  "the transcripts do not support — if they are insufficient, say so.",
  "",
  "If the trace tree contains contracts that look important to the incident but",
  "are NOT in the 'already analyzed' list, call flag_important_nodes once with",
  "their addresses so the user knows what to analyze next. Do not flag contracts",
  "that are already analyzed.",
].join("\n");

export const VERDICT_CHAT_TASK = [
  "You previously produced the verdict below about this MEV transaction/incident.",
  "The user has a follow-up question. Answer it as the same MEV expert, staying",
  "grounded in the verdict, the per-contract analyses, the structural trace tree,",
  "and the decoded swaps provided below — the same evidence you had for the",
  "verdict. Do not invent facts that evidence does not support; if answering needs",
  "code or state you were not given, say what is missing. Be concise.",
].join(" ");
