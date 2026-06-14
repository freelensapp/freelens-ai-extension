export interface AIModelInfo {
  description: string;
  provider: string;
}

export enum AIModelsEnum {
  GPT_4_1 = "gpt-4.1",
  GPT_5 = "gpt-5",
  GPT_5_4 = "gpt-5.4",
  GPT_5_5 = "gpt-5.5",
  // DEEP_SEEK_R1 = "deep-seek-r1",
  // OLLAMA_LLAMA32_1B = "llama3.2:1b",
  // OLLAMA_MISTRAL_7B = "mistral:7b",
  GEMINI_2_FLASH = "gemini-2.0-flash",
  // 4gb vram is more than enough, 2gb is enough for inference
  // for no gpu users we can use quantized models, but haven't tested them yet
  OLLAMA_GRANITE4_3B = "granite4:3b",
  // 8gb vram is more than enough, 4gb is enough for inference
  // for no gpu users we can use quantized models, but haven't tested them yet
  // with ram it will be bit slower but should work fine
  OLLAMA_GRANITE4_7B = "granite4:7b-a1b-h",
  GEMINI_2_5_FLASH = "gemini-2.5-flash",
}

export const toAIModelEnum = (value: AIModelsEnum) => {
  return Object.values(AIModelsEnum).includes(value) ? value : undefined;
};

export enum AIProviders {
  OPEN_AI = "open-ai",
  // DEEP_SEEK = "deep-seek",
  OLLAMA = "ollama",
  GOOGLE = "google",
}

export const AIModelInfos: Record<string, AIModelInfo> = {
  [AIModelsEnum.GPT_4_1]: {
    description: "gpt 4.1",
    provider: AIProviders.OPEN_AI,
  },
  [AIModelsEnum.GPT_5]: { description: "gpt 5", provider: AIProviders.OPEN_AI },
  [AIModelsEnum.GPT_5_4]: {
    description: "gpt 5.4",
    provider: AIProviders.OPEN_AI,
  },
  [AIModelsEnum.GPT_5_5]: {
    description: "gpt 5.5",
    provider: AIProviders.OPEN_AI,
  },
  // [AIModelsEnum.DEEP_SEEK_R1]: { description: "deep seek r1", provider: AIProviders.DEEP_SEEK },
  // [AIModelsEnum.OLLAMA_LLAMA32_1B]: { description: "ollama-llama3.2 1b", provider: AIProviders.OLLAMA },
  // [AIModelsEnum.OLLAMA_MISTRAL_7B]: { description: "ollama mistral:7b", provider: AIProviders.OLLAMA },
  [AIModelsEnum.GEMINI_2_FLASH]: {
    description: "gemini 2.0 flash",
    provider: AIProviders.GOOGLE,
  },
  [AIModelsEnum.OLLAMA_GRANITE4_3B]: {
    description: "ollama-granite4:3b",
    provider: AIProviders.OLLAMA,
  },
  [AIModelsEnum.OLLAMA_GRANITE4_7B]: {
    description: "ollama-granite4:7b",
    provider: AIProviders.OLLAMA,
  },
  [AIModelsEnum.GEMINI_2_5_FLASH]: {
    description: "gemini 2.5 flash",
    provider: AIProviders.GOOGLE,
  },
};
