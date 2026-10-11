// Provider abstraction — nothing in index.ts should know which AI
// service is actually behind this interface, so swapping providers
// later never touches safety/FAQ/guided-action logic.
export interface AiProvider {
  generate(params: { systemPrompt: string; userMessage: string }): Promise<{ rawText: string }>;
}
