/**
 * Copyright (c) 2025 Freelens Authors
 *
 * Licensed under the MIT License
 */

import { ChatOpenAI } from "@langchain/openai";
import { Message, Ollama } from "ollama";
import { SUPPORTED_OLLAMA_MODELS } from "../../../common/constants/ollama-models";
import { HealthCheckResult, IAIService, OllamaServiceConfig } from "../../../common/interfaces/ai-service.interface";
import { generateSystemPromptWithHandbook, HandbookContent } from "../../../common/utils/kubectl-handbook-loader";
import { createLogger, Logger } from "../../../common/utils/logger/logger-service";

/**
 * Default Ollama configuration values.
 */
const DEFAULT_OLLAMA_CONFIG: OllamaServiceConfig = {
  host: "http://127.0.0.1",
  port: 9898,
  timeout: 60000,
};

/**
 * Default generation options for Ollama models.
 */
const DEFAULT_GENERATION_OPTIONS = {
  stream: true,
  temperature: 0,
  maxTokens: 4096,
};

/**
 * Service implementation for interacting with local Ollama instances.
 * Provides chat completion, health checking, and model listing capabilities.
 */
export class OllamaService implements IAIService {
  /**
   * The Ollama client instance for making API requests.
   */
  private readonly _client: Ollama;

  /**
   * The base URL for the Ollama API.
   */
  private readonly _baseUrl: string;

  /**
   * The loaded kubectl handbook content for context injection.
   */
  private _handbookContent: HandbookContent | null = null;

  /**
   * Logger instance for this service.
   */
  private readonly _log = createLogger("OllamaService").log;

  /**
   * Creates a new OllamaService instance.
   * @param config - Optional configuration for the Ollama connection
   */
  constructor(config?: Partial<OllamaServiceConfig>) {
    const fullConfig = { ...DEFAULT_OLLAMA_CONFIG, ...config };
    this._baseUrl = `${fullConfig.host}:${fullConfig.port}`;

    this._client = new Ollama({
      host: this._baseUrl,
      fetch: fullConfig.fetch,
    });

    this._log.debug(`OllamaService initialized with base URL: ${this._baseUrl}`);
  }

  /**
   * Sets the kubectl handbook content for context injection.
   * @param content - The handbook content to use
   */
  public setHandbookContent(content: HandbookContent): void {
    this._handbookContent = content;
    this._log.debug(`Handbook content set. Length: ${content.content.length} characters`);
  }

  /**
   * Generates a chat response using the specified Ollama model.
   * Injects kubectl handbook context when available.
   *
   * @param model - The model identifier to use for generation
   * @param messages - Array of conversation messages
   * @param options - Optional generation configuration
   * @returns AsyncGenerator yielding response chunks
   */
  public async *generateChatResponse(
    model: string,
    messages: Message[],
    options?: {
      stream?: boolean;
      temperature?: number;
      maxTokens?: number;
    },
  ): AsyncGenerator<string> {
    const effectiveOptions = { ...DEFAULT_GENERATION_OPTIONS, ...options };
    const shouldStream = effectiveOptions.stream ?? true;

    this._log.debug(`Generating response with model: ${model}, streaming: ${shouldStream}`);

    try {
      // Prepare messages with handbook context if available
      const processedMessages = this._prepareMessagesWithContext(messages);

      // Build chat request with proper typing for ollama 0.6.x
      const chatRequest = {
        model,
        messages: processedMessages,
        stream: shouldStream,
        options: {
          temperature: effectiveOptions.temperature,
          num_predict: effectiveOptions.maxTokens,
        },
      };

      // Execute the chat request - handle both streaming and non-streaming
      // When stream: true, ollama-js returns an async iterable
      if (shouldStream) {
        const response = (await this._client.chat(
          chatRequest as Parameters<typeof this._client.chat>[0],
        )) as unknown as AsyncIterable<{ message?: { content: string } }>;

        for await (const chunk of response) {
          if (chunk.message?.content) {
            yield chunk.message.content;
          }
        }
      } else {
        // Handle non-streaming response
        const response = (await this._client.chat(chatRequest as Parameters<typeof this._client.chat>[0])) as {
          message?: { content: string };
        };

        if (response.message?.content) {
          yield response.message.content;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      this._log.error(`Error generating chat response: ${errorMessage}`);

      // Provide more specific error messages
      if (errorMessage.includes("ECONNREFUSED")) {
        throw new Error(
          `Cannot connect to Ollama at ${this._baseUrl}. Please ensure Ollama is running with 'ollama serve'`,
        );
      } else if (errorMessage.includes("model not found")) {
        throw new Error(`Model '${model}' not found. Please pull the model first with 'ollama pull ${model}'`);
      } else if (errorMessage.includes("404")) {
        throw new Error(`Ollama API endpoint not found. Please check if Ollama is running on ${this._baseUrl}`);
      }

      throw new Error(`Failed to generate response from Ollama: ${errorMessage}`);
    }
  }

  /**
   * Prepares messages by injecting kubectl handbook context as a system message.
   * @param messages - The original messages
   * @returns Messages with handbook context prepended
   */
  private _prepareMessagesWithContext(messages: Message[]): Message[] {
    // If no handbook content, return original messages
    if (!this._handbookContent || !this._handbookContent.content) {
      return messages;
    }

    // Generate system prompt with handbook
    const systemPrompt = generateSystemPromptWithHandbook(this._handbookContent);

    // Check if there's already a system message
    const hasSystemMessage = messages.some((msg) => msg.role === "system");

    if (hasSystemMessage) {
      // Prepend handbook context to existing system message
      return messages.map((msg) => {
        if (msg.role === "system") {
          return {
            ...msg,
            content: `${systemPrompt}\n\n---\n\n${msg.content}`,
          };
        }
        return msg;
      });
    }

    // Add new system message at the beginning
    return [{ role: "system", content: systemPrompt }, ...messages];
  }

  /**
   * Checks if the Ollama service is available and responsive.
   * @returns Promise resolving to health check result
   */
  public async isServiceAvailable(): Promise<HealthCheckResult> {
    this._log.debug("Checking Ollama service availability...");

    try {
      const response = await this._client.version();
      return {
        isHealthy: true,
        version: response.version,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Connection failed";
      this._log.warn(`Ollama health check failed: ${errorMessage}`);

      return {
        isHealthy: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Gets the list of available models from the Ollama instance.
   * Filters to only return supported models for freelens-ai-extension.
   *
   * @returns Promise resolving to array of available model names
   */
  public async getAvailableModels(): Promise<string[]> {
    this._log.debug("Fetching available models from Ollama...");

    try {
      const response = await this._client.list();
      const availableModels = response.models.map((model) => model.name);

      this._log.debug(`Found ${availableModels.length} models available in Ollama`);

      // Filter to only supported models
      const supportedModels = availableModels.filter((model) => this._isModelSupported(model));

      this._log.debug(`${supportedModels.length} of ${availableModels.length} models are supported by freelens-ai`);

      return supportedModels;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to list models";
      this._log.error(`Failed to list models: ${errorMessage}`);

      // Return empty array on error
      return [];
    }
  }

  /**
   * Checks if a model name is in the supported models list.
   * Handles model name variations (with/without tags).
   *
   * @param modelName - The model name to check
   * @returns True if the model is supported
   */
  private _isModelSupported(modelName: string): boolean {
    // Normalize the model name (remove :latest if present)
    const normalizedName = modelName.replace(/:latest$/, "");

    return SUPPORTED_OLLAMA_MODELS.some((supported) => {
      // Exact match
      if (supported === normalizedName || supported === modelName) {
        return true;
      }

      // Check if the model name starts with a supported base
      const baseModel = normalizedName.split(":")[0];
      const supportedBase = supported.split(":")[0];

      return baseModel === supportedBase;
    });
  }

  /**
   * Pulls a model to the local Ollama instance.
   * Useful for ensuring models are available before use.
   *
   * @param model - The model to pull
   * @param onProgress - Optional callback for progress updates
   * @returns AsyncGenerator yielding progress percentage
   */
  public async *pullModel(
    model: string,
    onProgress?: (progress: number, status: string) => void,
  ): AsyncGenerator<{ progress: number; status: string }> {
    this._log.info(`Pulling model: ${model}`);

    try {
      const response = await this._client.pull({
        model,
        stream: true,
      });

      for await (const chunk of response) {
        const progress = chunk.completed ? Math.round((chunk.completed / chunk.total) * 100) : 0;

        if (onProgress) {
          onProgress(progress, chunk.status);
        }

        yield { progress, status: chunk.status };
      }

      this._log.info(`Model ${model} pulled successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to pull model";
      this._log.error(`Failed to pull model ${model}: ${errorMessage}`);
      throw new Error(`Failed to pull model: ${errorMessage}`);
    }
  }

  /**
   * Gets the current base URL for the Ollama API.
   * @returns The base URL string
   */
  public getBaseUrl(): string {
    return this._baseUrl;
  }

  /**
   * Validates that a model is available and supported before use.
   * @param model - The model to validate
   * @returns Promise resolving to true if model is available
   */
  public async isModelAvailable(model: string): Promise<boolean> {
    try {
      const availableModels = await this.getAvailableModels();
      return availableModels.some((m) => m === model || m.startsWith(model));
    } catch {
      return false;
    }
  }
}

/**
 * Type alias for the OllamaService instance.
 */
export type OllamaServiceType = InstanceType<typeof OllamaService>;

// Helper function to create a ChatOpenAI instance configured for Ollama's OpenAI-compatible API
export const createOpenAiCompatibleOllamaService = (
  selectedModel: string,
  ollamaHost: string,
  ollamaPort: string,
  log: Logger,
) => {
  // For Ollama models, use ChatOpenAI pointed at Ollama's OpenAI-compatible endpoint
  // This enables full LangChain agent + tool-calling support
  const baseURL = `${ollamaHost}:${ollamaPort}/v1`;
  log.debug(`Creating LangChain ChatOpenAI for Ollama model at ${baseURL}`);

  return new ChatOpenAI({
    model: selectedModel,
    configuration: {
      baseURL,
    },
    temperature: 0,
    apiKey: "freelens-ollama",
  });
};
