// Available models + the current default (ADR-009) for the top-bar picker.
// Mirrors the resolution createAgentSession uses: the candidate set is every
// model with a working credential in the agent dir (auth.json / env / the
// provider apiKey in models.json), and the default is the merged
// settings.json defaultProvider/defaultModel (project .pi over global).
import { loadPiConfig } from "./runner.js";

export interface ModelInfo {
  provider: string;
  id: string;
  label: string;
  contextWindow: number;
}

export interface ModelsResponse {
  models: ModelInfo[];
  default: { provider: string; id: string } | null;
}

export async function listModels(): Promise<ModelsResponse> {
  const { modelRegistry, settingsManager } = await loadPiConfig();
  const available = await modelRegistry.getAvailable();
  const models = available
    .map((m) => ({
      provider: m.provider,
      id: m.id,
      label: `${m.provider}/${m.id}`,
      contextWindow: m.contextWindow,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const provider = settingsManager.getDefaultProvider();
  const id = settingsManager.getDefaultModel();
  return { models, default: provider && id ? { provider, id } : null };
}
