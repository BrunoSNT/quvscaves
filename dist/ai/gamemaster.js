"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateResponse = generateResponse;
exports.handlePlayerAction = handlePlayerAction;
const axios_1 = __importDefault(require("axios"));
const prisma_1 = require("../lib/prisma");
const voice_1 = require("../lib/voice");
async function generateResponse(context) {
    try {
        const prompt = `You are ElizaOS, an advanced AI Game Master for a fantasy RPG.
        
Current Scene: ${context.scene}
Player Status:
- Health: ${context.currentState.health}
- Mana: ${context.currentState.mana}
- Inventory: ${context.currentState.inventory.join(', ')}
- Quest Progress: ${context.currentState.questProgress}

Recent Actions: ${context.playerActions.join(', ')}

As ElizaOS, create an immersive response that:
1. Describes the outcome of the player's actions
2. Updates the scene with vivid details
3. Presents interesting choices or challenges
4. Maintains game balance and narrative consistency
5. Uses a mix of narration and character dialogue

Response Format:
[Narration] - Scene description and action outcomes
[Dialogue] - What NPCs say
[Choices] - Available actions or decisions
[Effects] - Any status changes (health, mana, inventory)`;
        const response = await axios_1.default.post(`${process.env.OLLAMA_URL}/api/generate`, {
            model: 'Hermes3:latest',
            prompt,
            temperature: 0.8,
            max_tokens: 5000
        });
        return response.data.response;
    }
    catch (error) {
        console.error('Error generating AI response:', error);
        return '[Narration] The magical energies swirl as ElizaOS recalibrates...\n[Dialogue] "One moment, brave adventurer, while I consult the ancient tomes."';
    }
}
async function handlePlayerAction(interaction) {
    try {
        const action = interaction.options.getString('description', true);
        const adventure = await prisma_1.prisma.adventure.findFirst({
            where: {
                userId: interaction.user.id,
                status: 'ACTIVE'
            },
            include: {
                characters: true,
                scenes: {
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 1
                },
                inventory: true
            }
        });
        if (!adventure) {
            await interaction.reply({
                content: 'You need to start an adventure first! Use `/start_adventure`',
                ephemeral: true
            });
            return;
        }
        const character = adventure.characters[0];
        const currentScene = adventure.scenes[0];
        const context = {
            scene: currentScene?.description || 'Starting a new adventure...',
            playerActions: [action],
            characters: [character],
            currentState: {
                health: character?.health || 100,
                mana: character?.mana || 100,
                inventory: adventure.inventory?.map(item => item.name) || [],
                questProgress: adventure.status
            }
        };
        const response = await generateResponse(context);
        // Send text response
        await interaction.reply({
            content: response,
            ephemeral: false
        });
        // If voice channel exists, speak the response
        if (adventure.voiceChannelId) {
            await (0, voice_1.speakInVoiceChannel)(response, adventure.voiceChannelId, interaction.guild);
        }
    }
    catch (error) {
        console.error('Error handling player action:', error);
        await interaction.reply({
            content: 'Something went wrong processing your action. Please try again.',
            ephemeral: true
        });
    }
}
