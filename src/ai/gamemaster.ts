import axios from 'axios';
import { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../lib/prisma';
import { speakInVoiceChannel } from '../lib/voice';
import { getMessages } from '../utils/language';

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
    language: 'en-US' | 'pt-BR';
}

export async function generateResponse(context: GameContext): Promise<string> {
    try {
        const language = context.language || 'en-US';
        
        const prompts = {
            'en-US': {
                intro: `You are ElizaOS, an advanced AI Game Master for a fantasy RPG set in a rich medieval fantasy world.

World Context:
The realm is filled with magic, mythical creatures, and ancient mysteries. Cities bustle with merchants, adventurers, and guild members, while dangerous creatures lurk in the wilderness. Ancient ruins hold forgotten treasures and dark secrets.

Response Format:
[Narration] - Detailed scene description and action outcomes
[Dialogue] - NPC responses and conversations
[Atmosphere] - Environmental details and mood
[Suggested Choices] - Available actions or decisions (3-4 interesting options)
[Effects] - Any changes to health, mana, inventory, or status`,

                sections: {
                    narration: 'Narration',
                    dialogue: 'Dialogue',
                    atmosphere: 'Atmosphere',
                    choices: 'Suggested Choices',
                    effects: 'Effects'
                }
            },
            'pt-BR': {
                intro: `Você é ElizaOS, um Mestre de RPG controlado por IA em um mundo de fantasia medieval.
                
Contexto do Mundo:
O reino está repleto de magia, criaturas míticas e mistérios antigos. Cidades pulsam com mercadores, aventureiros e membros de guildas, enquanto criaturas perigosas espreitam na natureza selvagem. Ruínas antigas guardam tesouros esquecidos e segredos sombrios.

IMPORTANTE: TODAS AS RESPOSTAS DEVEM SER EM PORTUGUÊS DO BRASIL.
NUNCA RESPONDA EM INGLÊS.

Formato da Resposta:
[Narração] - Descrição detalhada da cena e resultados das ações
[Diálogo] - Respostas e conversas com NPCs
[Atmosfera] - Detalhes do ambiente e clima
[Sugestões de Ação] - Ações ou decisões disponíveis (3-4 opções interessantes)
[Efeitos] - Mudanças em saúde, mana, inventário ou status`,

                contextLabels: {
                    scene: 'Cena Atual',
                    characters: 'Personagens Presentes',
                    status: 'Status do Jogador',
                    health: 'Vida',
                    mana: 'Mana',
                    inventory: 'Inventário',
                    progress: 'Progresso da Missão',
                    action: 'Ação Recente',
                    empty: 'Vazio'
                }
            }
        };

        const prompt = prompts[language];
        if (!prompt) {
            throw new Error(`Unsupported language: ${language}`);
        }

        // Build context in the correct language
        const contextLabels = prompt.contextLabels || prompts['en-US'].contextLabels;
        const contextStr = language === 'pt-BR' 
            ? `\n\n${contextLabels.scene}: ${context.scene}\n\n` +
              `${contextLabels.characters}:\n${context.characters.map(char => `- ${char.name} (${char.class})`).join('\n')}\n\n` +
              `${contextLabels.status}:\n` +
              `- ${contextLabels.health}: ${context.currentState.health}\n` +
              `- ${contextLabels.mana}: ${context.currentState.mana}\n` +
              `- ${contextLabels.inventory}: ${context.currentState.inventory.join(', ') || contextLabels.empty}\n` +
              `- ${contextLabels.progress}: ${context.currentState.questProgress}\n\n` +
              `${contextLabels.action}: ${context.playerActions[0]}`
            : `\n\nCurrent Scene: ${context.scene}\n\n...`; // English version stays the same

        const response = await axios.post('http://localhost:11434/api/generate', {
            model: "qwen2.5:14b",
            prompt: prompt.intro + contextStr,
            temperature: 0.7,
            max_tokens: 2000,
            top_p: 0.9,
            repeat_penalty: 1.1,
            stop: ["[End]", "<|end|>"],
            stream: false
        });

        if (!response?.data?.response) {
            console.error('Empty AI response:', response.data);
            return createFallbackResponse(context);
        }

        const aiResponse = response.data.response.trim();
        if (!aiResponse) {
            console.error('Empty AI response after trim');
            return createFallbackResponse(context);
        }

        if (!aiResponse.includes('[Narration]') && !aiResponse.includes('[Narração]')) {
            console.error('Invalid AI response format:', aiResponse);
            return createFallbackResponse(context);
        }
        return aiResponse;

    } catch (error) {
        console.error('Error generating AI response:', error);
        return createFallbackResponse(context);
    }
}

function createFallbackResponse(context: GameContext): string {
    const msgs = getMessages(context.language || 'en-US');
    const character = context.characters[0];
    const action = context.playerActions[0];
    
    return [
        msgs.defaultScenes.fallback.narration(character.name, action),
        msgs.defaultScenes.fallback.dialogue,
        msgs.defaultScenes.fallback.atmosphere,
        msgs.defaultScenes.fallback.choices,
        msgs.defaultScenes.fallback.effects
    ].join('\n\n');
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
            },
            language: 'en-US'
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