/**
 * Copyright (c) 2026 Freelens Authors
 *
 * Licensed under the MIT License
 */

import { Message } from "ollama";

/**
 * Interface defining the contract for AI service implementations.
 * Provides a unified interface for different AI providers (OpenAI, Google, Ollama, etc.)
 * NOTE: Usage is limited to Ollama for now, but with approval, we will merge all into one
 */
export interface IAIService {
  /**
   * Generates a chat response from the AI model.
   * @param model - The model identifier to use for generation
   * @param messages - Array of conversation messages including system context and user input
   * @param options - Optional configuration for generation (stream, temperature, etc.)
   * @returns AsyncGenerator yielding response chunks for streaming or a single response
   */
  generateChatResponse(
    model: string,
    messages: Message[],
    options?: {
      stream?: boolean;
      temperature?: number;
      maxTokens?: number;
    },
  ): AsyncGenerator<string> | Promise<string>;

  /**
   * Checks if the AI service is available and responsive.
   * @returns Promise resolving to health check result with availability status and version info
   */
  isServiceAvailable(): Promise<HealthCheckResult>;

  /**
   * Gets the list of available models from the service.
   * @returns Promise resolving to array of available model names
   */
  getAvailableModels(): Promise<string[]>;
}

/**
 * Result of a health check operation.
 */
export interface HealthCheckResult {
  /**
   * Whether the service is healthy and responsive.
   */
  isHealthy: boolean;

  /**
   * The Ollama version if available.
   */
  version?: string;

  /**
   * Error message if the health check failed.
   */
  error?: string;
}
