# RPG Discord Bot

## English
A Discord bot for managing text-based RPG adventures with friends.

### Features
- Create and manage characters with different classes (Warrior, Mage, Rogue)
- Start adventures and invite friends to join
- Each character gets their private action channel
- Adventure log to track all events
- Friend system to manage who can join your adventures
- Voice narration support (Discord TTS and ElevenLabs)
- Multi-language support (English and Portuguese)

### Commands
- `/help` - Show all available commands
- `/register` - Create your account
- `/create_character` - Create a new character
- `/create_adventure` - Start a new adventure
- `/join_adventure` - Join an existing adventure
- `/action` - Perform an action in your adventure
- `/adventure_settings` - Change adventure settings (language, voice type)
- `/list_characters` - View your characters
- `/list_adventures` - View available adventures
- `/add_friend` - Send a friend request
- `/list_friends` - View your friends list
- `/accept_friend` - Accept a friend request

### Setup
1. Install dependencies: `npm install`
2. Create a `.env` file with:
   ```
   DISCORD_TOKEN=your_bot_token
   ELEVENLABS_API_KEY=your_elevenlabs_key (optional)
   ```
3. Run the bot: `npm start`

# RPG Bot Memory System

This document describes the memory system architecture implemented for the RPG bot, following the design shown in the architecture diagram.

## Components

### 1. Core (LLM + Orchestrator)
- **LLM**: Main language model interface for generating responses
- **Orchestrator**: Coordinates between different memory components and manages the flow of information

### 2. Memory Types

#### Episodic Memory
- Stores interaction history between human and assistant
- Maintains chronological record of events
- Exports to JSONL format for future training

#### Semantic Memory
- **Private Knowledge Base**: Integration with external sources (Notion, etc.)
- **Grounding Context**: Contextual information for maintaining consistency
- Uses vector embeddings for semantic search

#### Procedural Memory
- **Prompt Registry**: Collection of system prompts
- **Tool Registry**: Available tools and their parameters
- Manages game rules and mechanics

#### Working Memory (Short-term)
- Current prompt structure
- Available tools
- Additional context
- Reasoning and action history

### 3. Vector Database
- ChromaDB for storing embeddings
- Approximate Nearest Neighbor (ANN) search
- Efficient similarity matching

## Usage

### Initialization
```typescript
// Initialize the memory system
const orchestrator = new Orchestrator(adventureId, {
    apiKey: 'notion-api-key',
    databaseId: 'notion-database-id'
});

// Sync knowledge base
await orchestrator.syncKnowledge();
```

### Processing Input
```typescript
// Process user input
await orchestrator.processInput(userInput, gameContext);

// Generate response
const response = await orchestrator.generateResponse(gameContext);
```

### Memory Operations
```typescript
// Export memories to JSONL
const filepath = await exportMemoriesToJsonl(adventureId, memories);

// Find similar memories
const similar = await findSimilarMemories(content, memories);

// Merge working memories
const merged = mergeWorkingMemories(memories);

// Get memory summary
const summary = summarizeMemories(memories);
```

## Database Schema

The system uses the following tables:
- `episodic_memories`
- `semantic_memories`
- `procedural_memories`
- `working_memories`
- `vector_indices`

See `prisma/schema.prisma` for detailed schema definitions.

## Vector Store

Uses ChromaDB with the following features:
- Embedding caching
- Similarity search
- Vector operations
- Metadata storage

## Future Extensions

The system is designed to support:
- AI NPCs and companions
- Advanced combat system
- Dynamic quest generation
- Multi-player interactions

## Development

### Prerequisites
- Node.js 16+
- PostgreSQL
- ChromaDB
- Ollama (for embeddings)

### Setup
1. Install dependencies: `pnpm install`
2. Set up environment variables
3. Initialize database: `pnpm prisma:push`
4. Start ChromaDB: `pnpm chroma:dev`
5. Run initialization: `pnpm dev`