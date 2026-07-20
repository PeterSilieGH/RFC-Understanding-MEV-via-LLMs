// Skill catalogue for the analyze panel (ADR-009). The panel renders these
// descriptions up front so the user knows what each run does before triggering
// it. The server is the source of truth; the frontend fetches this list.
import type { SkillId } from "./store.js";

export interface SkillMeta {
  id: SkillId;
  title: string;
  description: string;
  /** which panel's "copy panel context" the run draws its context from */
  context: "code" | "values" | "transcripts";
}

export const SKILLS: SkillMeta[] = [
  {
    id: "analyze-code",
    title: "Analyze code",
    description:
      "Review the selected nodes' contract source as an MEV expert. Only function " +
      "signatures are sent up front; the agent pulls individual function bodies on " +
      "demand. Marks each covered node with the code tick.",
    context: "code",
  },
  {
    id: "analyze-value",
    title: "Analyze value",
    description:
      "Review the selected nodes' on-chain state and ABI as an MEV expert. Marks each " +
      "covered node with the value tick.",
    context: "values",
  },
  {
    id: "build-preview",
    title: "Build verdict",
    description:
      "Combine the stored transcripts of prior analyses into a single verdict about " +
      "the transaction (or, for a multi-transaction incident, the whole bundle). " +
      "Also reads the incident's trace tree to flag important-but-unanalyzed " +
      "contracts. Triggered from the Incident panel.",
    context: "transcripts",
  },
];
