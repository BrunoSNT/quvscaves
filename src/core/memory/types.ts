import { GameContext } from '../../shared/game/types';

// Episodic Memory Types
export interface EpisodicMemory {
  id: string;
  type: 'human' | 'assistant';
  content: string;
  metadata: Record<string, any>;
  timestamp: Date;
  embedding?: number[];
}

export interface EpisodicMemoryInput {
  type: 'human' | 'assistant';
  content: string;
  metadata: Record<string, any>;
  timestamp: Date;
}

// Semantic Memory Types
export interface SemanticMemory {
  id: string;
  type: 'knowledge' | 'grounding';
  content: string;
  source: string;
  metadata: Record<string, any>;
  embedding?: number[];
}

export interface SemanticMemoryInput {
  type: 'knowledge' | 'grounding';
  content: string;
  source: string;
  metadata: Record<string, any>;
}

// Working Memory Types
export interface WorkingMemory {
  promptStructure: string;
  availableTools: string[];
  additionalContext: string[];
  reasoningHistory: string[];
  currentContext?: GameContext;
}

// Procedural Memory Types
export interface ProceduralMemory {
  id: string;
  type: 'prompt' | 'tool';
  name: string;
  description: string;
  parameters: Record<string, any>;
  metadata: Record<string, any>;
}

export interface ProceduralMemoryInput {
  type: 'prompt' | 'tool';
  name: string;
  description: string;
  parameters: Record<string, any>;
  metadata: Record<string, any>;
}

// Vector Types
export interface VectorEntry {
  id: string;
  vector: number[];
  metadata: Record<string, any>;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: Record<string, any>;
}

// Memory Manager Types
export interface MemoryManager {
  episodic: EpisodicMemoryManager;
  semantic: SemanticMemoryManager;
  working: WorkingMemoryManager;
  procedural: ProceduralMemoryManager;
}

export interface EpisodicMemoryManager {
  add(memory: EpisodicMemoryInput): Promise<void>;
  search(query: string, limit?: number): Promise<EpisodicMemory[]>;
  getRecent(limit?: number): Promise<EpisodicMemory[]>;
}

export interface SemanticMemoryManager {
  addKnowledge(memory: SemanticMemoryInput): Promise<void>;
  addGrounding(memory: SemanticMemoryInput): Promise<void>;
  search(query: string, limit?: number): Promise<SemanticMemory[]>;
}

export interface WorkingMemoryManager {
  update(memory: Partial<WorkingMemory>): void;
  get(): WorkingMemory;
  clear(): void;
  updateContext(context: GameContext): void;
  addReasoning(reasoning: string): void;
  getRecentReasoning(limit?: number): string[];
}

export interface ProceduralMemoryManager {
  registerPrompt(prompt: ProceduralMemoryInput): Promise<void>;
  registerTool(tool: ProceduralMemoryInput): Promise<void>;
  getPrompts(): Promise<ProceduralMemory[]>;
  getTools(): Promise<ProceduralMemory[]>;
} 