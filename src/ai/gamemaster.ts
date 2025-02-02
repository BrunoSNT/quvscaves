import axios from 'axios';
import { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../lib/prisma';
import { speakInVoiceChannel } from '../lib/voice';

interface GameContext {
    scene: string;
    playerActions: string[];
    characters: any[];
    currentState: {
        health: number;
        mana: number;
        inventory: string[];
        questProgress: string;
    };
}

export async function generateResponse(context: GameContext): Promise<string> {
    try {
        const response = await axios.post('http://localhost:11434/api/generate', {
            model: "Hermes3:latest",
            prompt: `You are ElizaOS, an advanced AI Game Master for a fantasy RPG.
            \nCurrent Scene: ${context.scene}
            \nPlayer Status:
            \n- Health: ${context.currentState.health}
            \n- Mana: ${context.currentState.mana}
            \n- Inventory: ${context.currentState.inventory.join(', ')}
            \n- Quest Progress: ${context.currentState.questProgress}
            \n\nRecent Actions: ${context.playerActions.join('\n')}
            \n\nAs ElizaOS, create an immersive response that:
            \n1. Describes the outcome of the player's actions
            \n2. Updates the scene with vivid details
            \n3. Presents interesting choices or challenges
            \n4. Maintains game balance and narrative consistency
            \n5. Uses a mix of narration and character dialogue
            \n\nResponse Format:
            \n[Narration] - Scene description and action outcomes
            \n[Dialogue] - What NPCs say
            \n[Choices] - Available actions or decisions
            \n[Effects] - Any status changes (health, mana, inventory)`,
            temperature: 0.8,
            max_tokens: 5000
        });

        return response.data.response;
    } catch (error) {
        console.error('Error generating AI response:', error);
        return '[Narration] You stand at the beginning of your journey, ready for adventure.\n[Dialogue] "Welcome, brave adventurers! What would you like to do?"\n[Choices] - Explore the area\n- Talk to nearby NPCs\n- Check your equipment';
    }
}

export async function handlePlayerAction(interaction: ChatInputCommandInteraction) {
    try {
        const action = interaction.options.getString('description', true);
        const adventure = await prisma.adventure.findFirst({
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

        const context: GameContext = {
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
            await speakInVoiceChannel(
                response,
                adventure.voiceChannelId,
                interaction.guild!
            );
        }

    } catch (error) {
        console.error('Error handling player action:', error);
        await interaction.reply({
            content: 'Something went wrong processing your action. Please try again.',
            ephemeral: true
        });
    }
} 