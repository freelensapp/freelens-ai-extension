/**
 * Copyright (c) 2026 Freelens Authors
 *
 * Licensed under the MIT License
 */

export const OLLAMA_GRANITE4_3B = "granite4:3b";

/**
 * Hardcoded list of supported Ollama models for freelens-ai-extension.
 * These models have been verified to work with Kubernetes-related tool calling
 * and are optimized for minimal hardware configurations.
 */
export const SUPPORTED_OLLAMA_MODELS: string[] = [OLLAMA_GRANITE4_3B] as const;
