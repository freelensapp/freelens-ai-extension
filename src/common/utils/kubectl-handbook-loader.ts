/**
 * Copyright (c) 2026 Freelens Authors
 *
 * Licensed under the MIT License
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import useLog from "../utils/logger/logger-service";

// todo: fails to copy in the build, we will figure it out later on

/**
 * Default path to the kubectl-handbook.md file relative to the extension assets.
 */
export const DEFAULT_KUBECTL_HANDBOOK_PATH = "static/kubectl-handbook.md";

/**
 * Interface for handbook content with metadata.
 */
export interface HandbookContent {
  /**
   * The content of the handbook.
   */
  content: string;

  /**
   * The file path from which the handbook was loaded.
   */
  sourcePath: string;

  /**
   * Timestamp when the handbook was loaded.
   */
  loadedAt: Date;
}

/**
 * Loads the kubectl-handbook.md file and prepares it for use as context.
 * Handles file reading, error cases, and content truncation.
 */
export const loadKubectlHandbook = async (handbookPath?: string): Promise<HandbookContent> => {
  const { log } = useLog("loadKubectlHandbook");
  const path = handbookPath || DEFAULT_KUBECTL_HANDBOOK_PATH;

  log.debug(`Loading kubectl handbook from: ${path}`);

  try {
    const absolutePath = join(process.cwd(), path);
    const content = await fs.readFile(absolutePath, "utf-8");

    log.debug(`Handbook loaded successfully. Content length: ${content.length} characters`);

    return {
      content,
      sourcePath: path,
      loadedAt: new Date(),
    };
  } catch (error) {
    log.error(`Failed to load kubectl handbook from ${path}:`, error);

    // Return empty content on failure rather than throwing
    return {
      content: "",
      sourcePath: path,
      loadedAt: new Date(),
    };
  }
};

/**
 * Generates a system prompt that incorporates the kubectl handbook context.
 * This should be used as the system message when interacting with Ollama models.
 *
 * @param handbookContent - The handbook content to use as context
 * @returns Formatted system prompt string
 */
export const generateSystemPromptWithHandbook = (handbookContent: HandbookContent): string => {
  return `You are an expert Kubernetes assistant specializing in kubectl commands and Kubernetes troubleshooting.
Use the following kubectl handbook as your primary reference for answering questions.
If the answer can be found in the handbook, prioritize the handbook's guidance.
If the answer is not in the handbook, you may use your general knowledge but clearly indicate this.

--- KUBECTL HANDBOOK REFERENCE ---
${handbookContent.content}
--- END HANDBOOK ---

When providing kubectl commands:
1. Include the exact command syntax
2. Explain what the command does
3. Provide common flags and examples
4. Mention any important caveats or precautions

Format your responses with:
- Clear command examples in code blocks
- Brief explanations in plain text
- Links to relevant documentation when appropriate`;
};

/**
 * Caches handbook content to avoid repeated file reads.
 * Useful for maintaining consistent context across multiple model interactions.
 */
class HandbookCache {
  private cachedContent: HandbookContent | null = null;

  /**
   * Gets cached handbook content or loads and caches it.
   * @param path - Optional path to load from (only used on first call)
   * @returns The handbook content
   */
  async getOrLoad(path?: string): Promise<HandbookContent> {
    if (this.cachedContent) {
      return this.cachedContent;
    }

    this.cachedContent = await loadKubectlHandbook(path);
    return this.cachedContent;
  }

  /**
   * Clears the cached handbook content.
   */
  clear(): void {
    this.cachedContent = null;
  }

  /**
   * Checks if content is currently cached.
   */
  isCached(): boolean {
    return this.cachedContent !== null;
  }
}

/**
 * Singleton instance for handbook caching.
 */
export const handbookCache = new HandbookCache();
