export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/** Whether the old "Base URL" preference points at OpenAI itself rather than a custom endpoint. */
export const isDefaultOpenAIBaseUrl = (baseUrl: string): boolean => {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed === "" || trimmed === DEFAULT_OPENAI_BASE_URL;
};
