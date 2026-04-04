import type {
  AIVideoProvider,
  AIImageProvider,
  ProviderType,
} from "./types";
import { EvolinkProvider } from "./providers/evolink";
import { EvolinkImageProvider } from "./providers/evolink-image";
import { KieProvider } from "./providers/kie";
import { ApimartProvider } from "./providers/apimart";
import {
  getConfiguredAIProvider,
  requireProviderApiKey,
} from "./provider-config";

const providers: Map<ProviderType, AIVideoProvider> = new Map();

export function getProvider(type: ProviderType): AIVideoProvider {
  if (providers.has(type)) return providers.get(type)!;

  let provider: AIVideoProvider;
  switch (type) {
    case "evolink":
      provider = new EvolinkProvider(requireProviderApiKey("evolink"));
      break;
    case "kie":
      provider = new KieProvider(requireProviderApiKey("kie"));
      break;
    case "apimart":
      provider = new ApimartProvider(requireProviderApiKey("apimart"));
      break;
    default:
      throw new Error(`Unknown provider: ${type}`);
  }

  providers.set(type, provider);
  return provider;
}

export function getDefaultProvider(): AIVideoProvider {
  const type = getConfiguredAIProvider() || "evolink";
  return getProvider(type);
}

export function getImageProvider(provider: ProviderType): AIImageProvider {
  switch (provider) {
    case "evolink":
      return new EvolinkImageProvider(requireProviderApiKey("evolink"));
    default:
      throw new Error(`Unsupported image provider: ${provider}`);
  }
}

export * from "./types";
export * from "./provider-config";
