export interface AIModelInfo {
  description: string;
  provider: string;
}

export enum AIModelsEnum {
  GPT_3_5_TURBO = "gpt-3.5-turbo",
  O3_MINI = "o3-mini",
  GPT_4_1 = "gpt-4.1",
  GPT_4_O = "gpt-4o",
  GPT_5 = "gpt-5",
  // DEEP_SEEK_R1 = "deep-seek-r1",
  // OLLAMA_LLAMA32_1B = "llama3.2:1b",
  // OLLAMA_MISTRAL_7B = "mistral:7b",
  GEMINI_2_FLASH = "gemini-2.0-flash",
}

export const toAIModelEnum = (value: AIModelsEnum) => {
  return Object.values(AIModelsEnum).includes(value) ? value : undefined;
};

export enum AIProviders {
  OPEN_AI = "open-ai",
  // DEEP_SEEK = "deep-seek",
  // OLLAMA = "ollama",
  GOOGLE = "google",
}

export const AIModelInfos: Record<string, AIModelInfo> = {
  [AIModelsEnum.GPT_3_5_TURBO]: { description: "gpt 3.5 turbo", provider: AIProviders.OPEN_AI },
  [AIModelsEnum.O3_MINI]: { description: "o3 mini", provider: AIProviders.OPEN_AI },
  [AIModelsEnum.GPT_4_1]: { description: "gpt 4.1", provider: AIProviders.OPEN_AI },
  [AIModelsEnum.GPT_4_O]: { description: "gpt 4o", provider: AIProviders.OPEN_AI },
  [AIModelsEnum.GPT_5]: { description: "gpt 5", provider: AIProviders.OPEN_AI },
  // [AIModelsEnum.DEEP_SEEK_R1]: { description: "deep seek r1", provider: AIProviders.DEEP_SEEK },
  // [AIModelsEnum.OLLAMA_LLAMA32_1B]: { description: "ollama-llama3.2 1b", provider: AIProviders.OLLAMA },
  // [AIModelsEnum.OLLAMA_MISTRAL_7B]: { description: "ollama mistral:7b", provider: AIProviders.OLLAMA },
  [AIModelsEnum.GEMINI_2_FLASH]: { description: "gemini 2.0 flash", provider: AIProviders.GOOGLE },
};
