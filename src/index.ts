import { 
    Client,
    Events, 
    SlashCommandBuilder,
    REST,
    IntentsBitField as Intents,
    BaseGuildTextChannel,
    EmbedBuilder
} from 'discord.js';
import { handleRegister } from './commands/register';
import { handleHelp } from './commands/help';
import { handleLinkWallet } from './commands/wallet';
import { handleCreateCharacter, handleCharacterSetting } from './commands/character';
import { handleStartAdventure } from './commands/adventure';
import { handleListCharacters, handleListAdventures } from './commands/list';
import { handleDeleteCharacter, handleDeleteAdventure } from './commands/delete';
import { 
    handleAddFriend, 
    handleRemoveFriend, 
    handleAcceptFriend, 
    handleListFriendRequests 
} from './commands/friend';
import { prisma } from './lib/prisma';
import { handleJoinAdventure } from './commands/adventure';
import { handleListFriends } from './commands/friend';
import { handlePlayerAction } from './commands/adventure';
import { handleAdventureSettings } from './commands/adventure';
import dotenv from 'dotenv';
import { handleDisconnectVoice } from './commands/adventure';
import { logger } from './utils/logger';
import { GameContext, SupportedLanguage, WorldStyle, ToneStyle, MagicLevel, VoiceType } from './types/game';
import { toGameCharacter, extractSuggestedActions, createActionButtons } from './commands/adventure/action';
import { getAdventureMemory } from './commands/adventure/action';
import { generateResponse } from './ai/gamemaster';
import { getMessages } from './utils/language';
import { sendFormattedResponse } from './utils/discord/embeds';
import { speakInVoiceChannel } from './lib/voice';
import chalk from 'chalk';

// Suppress punycode deprecation warning
process.removeAllListeners('warning');
process.on('warning', (warning) => {
    if (warning.name !== 'DeprecationWarning' || !warning.message.includes('punycode')) {
        console.warn(warning);
    }
});

dotenv.config();

const client = new Client({
    intents: [
        Intents.Flags.Guilds,
        Intents.Flags.GuildMessages,
        Intents.Flags.MessageContent,
        Intents.Flags.GuildVoiceStates,
    ]
});

// Add this line to verify env vars are loaded
console.log('Environment check:', {
    hasElevenLabsKey: !!process.env.ELEVENLABS_API_KEY,
    keyLength: process.env.ELEVENLABS_API_KEY?.length
});

// Types for our callbacks
type FriendRequest = {
    id: string;
    user: { 
        username: string;
        characters: any[];
    };
};

type Friend = {
    friend: { characters: any[] };
};

type FriendOf = {
    user: { characters: any[] };
};

type Character = {
    name: string;
    class: string;
    level: number;
    adventures: { adventure: { status: string } }[];
};

type Adventure = {
    id: string;
    name: string;
    user: { 
        id: string;
        username: string 
    };
    players: { character: { name: string } }[];
};

const commands = [
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands and features'),
    new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register your account')
        .addStringOption(option => 
            option.setName('nickname')
            .setDescription('Your preferred nickname in the game')
            .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('link_wallet')
        .setDescription('Link your Solana wallet')
        .addStringOption(option =>
            option.setName('address')
            .setDescription('Your Solana wallet address')
            .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('create_character')
        .setDescription('Create a new RPG character')
        .addStringOption(option => 
            option.setName('name')
            .setDescription('Your character name')
            .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('create_adventure')
        .setDescription('Create a new adventure')
        .addStringOption(option =>
            option
                .setName('players')
                .setDescription('Select characters to include (comma-separated)')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('action')
        .setDescription('Perform an action in your adventure')
        .addStringOption(option =>
            option
                .setName('description')
                .setDescription('What would you like to do?')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('list_characters')
        .setDescription('List all your characters'),
    new SlashCommandBuilder()
        .setName('list_adventures')
        .setDescription('List all your adventures'),
    new SlashCommandBuilder()
        .setName('delete_character')
        .setDescription('Delete a character')
        .addStringOption(option =>
            option.setName('character_id')
            .setDescription('Select the character to delete')
            .setRequired(true)
            .setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('delete_adventure')
        .setDescription('Delete an adventure and its channels')
        .addStringOption(option =>
            option.setName('adventure_id')
            .setDescription('Select the adventure to delete')
            .setRequired(true)
            .setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('add_friend')
        .setDescription('Send a friend request to another player')
        .addUserOption(option =>
            option.setName('user')
            .setDescription('The user to add as friend')
            .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('remove_friend')
        .setDescription('Remove a friend from your friend list')
        .addUserOption(option =>
            option.setName('user')
            .setDescription('The friend to remove')
            .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('accept_friend')
        .setDescription('Accept a friend request')
        .addStringOption(option =>
            option.setName('request_id')
            .setDescription('The friend request ID')
            .setRequired(true)
            .setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('list_friend_requests')
        .setDescription('List all pending friend requests'),
    new SlashCommandBuilder()
        .setName('join_adventure')
        .setDescription('Join an existing adventure')
        .addStringOption(option =>
            option.setName('adventure_id')
            .setDescription('The ID of the adventure to join')
            .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('character_name')
            .setDescription('Your character name to join with')
            .setRequired(true)
            .setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('list_friends')
        .setDescription('List all your friends'),
    new SlashCommandBuilder()
        .setName('adventure_settings')
        .setDescription('Change adventure settings')
        .addStringOption(option =>
            option.setName('adventure_id')
                .setDescription('The ID of the adventure')
                .setRequired(true)
                .setAutocomplete(true)),
    new SlashCommandBuilder()
        .setName('disconnect_voice')
        .setDescription('Disconnect the bot from voice channel'),
    new SlashCommandBuilder()
        .setName('character_setting')
        .setDescription('Change character settings')
        .addStringOption(option =>
            option.setName('character_id')
                .setDescription('The character to modify')
                .setRequired(true)
                .setAutocomplete(true)
        ),
].map(command => command.toJSON());

client.once(Events.ClientReady, async (c) => {
   logger.info(`Ready! Logged in as ${c.user.tag}`);
    
    const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
    try {
        await rest.put(
            `/applications/${client.user!.id}/commands`,
            { body: commands }
        );
        logger.info('Successfully registered application commands.');

    } catch (error) {
        logger.error('Error registering commands:', error);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isAutocomplete()) {
        try {
            const focusedOption = interaction.options.getFocused(true);
            const focusedValue = focusedOption.value.toString().toLowerCase();

            // Wrap the respond call in a try-catch
            const sendResponse = async (choices: { name: string, value: string }[]) => {
                try {
                    await interaction.respond(choices.slice(0, 25)); // Limit to 25 choices
                } catch (error: any) {
                    if (error.code === 10062) {
                        logger.warn('Interaction expired before autocomplete could respond');
                        return;
                    }
                    logger.error('Error in autocomplete response:', error);
                }
            };

            if (interaction.commandName === 'accept_friend') {
                const user = await prisma.user.findUnique({
                    where: { discordId: interaction.user.id }
                });

                if (!user) return await sendResponse([]);

                const requests = await prisma.friendship.findMany({
                    where: {
                        friendId: user.id,
                        status: 'PENDING'
                    },
                    include: { 
                        user: {
                            include: {
                                characters: true
                            }
                        }
                    },
                    take: 25
                });

                await sendResponse(
                    requests
                        .filter(req => req.user.username.toLowerCase().includes(focusedValue))
                        .map((req: FriendRequest) => ({
                            name: `From: ${req.user.username} (${req.user.characters.length} characters)`,
                            value: req.id
                        }))
                );
            }
            else if (interaction.commandName === 'create_adventure') {
                const user = await prisma.user.findUnique({
                    where: { discordId: interaction.user.id },
                    include: {
                        characters: true
                    }
                });

                if (!user) {
                    console.log('No user found');
                    return;
                }

                // Get current input value and split by commas
                const currentInput = focusedOption.value;
                const selectedCharacters = currentInput.split(/,\s*/).filter(Boolean);
                const searchTerm = selectedCharacters[selectedCharacters.length - 1]?.toLowerCase() || '';

                // Get only user's own characters
                const availableCharacters = user.characters.filter(char => {
                    const nameMatches = char.name.toLowerCase().includes(searchTerm);
                    // Don't show characters that are already selected
                    const isNotSelected = !selectedCharacters.slice(0, -1).map(name => name.toLowerCase()).includes(char.name.toLowerCase());
                    return nameMatches && isNotSelected;
                });

                await sendResponse(
                    availableCharacters.slice(0, 25).map(char => ({
                        name: `${char.name} (${char.class})`,
                        value: selectedCharacters.length > 0
                            ? [...selectedCharacters.slice(0, -1), char.name].join(', ')  // Keep all previous selections and add new one
                            : char.name  // First selection
                    }))
                );
            }
            else if (interaction.commandName === 'join_adventure') {
                const focusedOption = interaction.options.getFocused(true);
                const user = await prisma.user.findUnique({
                    where: { discordId: interaction.user.id },
                    include: {
                        characters: true
                    }
                });

                if (!user) return;

                if (focusedOption.name === 'character_name') {
                    const searchTerm = focusedOption.value.toLowerCase();
                    const availableCharacters = user.characters.filter(char => 
                        char.name.toLowerCase().includes(searchTerm)
                    );

                    await sendResponse(
                        availableCharacters.map(char => ({
                            name: `${char.name} (${char.class})`,
                            value: char.name
                        }))
                    );
                }
                else if (focusedOption.name === 'adventure_id') {
                    // Get only friend's active adventures
                    const adventures = await prisma.adventure.findMany({
                        where: {
                            status: 'ACTIVE',
                            user: {
                                OR: [
                                    {
                                        friends: {
                                            some: {
                                                friendId: user.id,
                                                status: 'ACCEPTED'
                                            }
                                        }
                                    },
                                    {
                                        friendOf: {
                                            some: {
                                                userId: user.id,
                                                status: 'ACCEPTED'
                                            }
                                        }
                                    }
                                ]
                            }
                        },
                        include: {
                            user: true,
                            players: {
                                include: {
                                    character: true
                                }
                            }
                        }
                    });

                    await sendResponse(
                        adventures.map((adv: Adventure) => ({
                            name: `${adv.name} - by ${adv.user.username} - Players: ${adv.players.map(p => p.character.name).join(', ')}`,
                            value: adv.id
                        }))
                    );
                }
            }
            else if (interaction.commandName === 'action') {
                const user = await prisma.user.findUnique({
                    where: { discordId: interaction.user.id },
                    include: {
                        adventures: {
                            where: { status: 'ACTIVE' },
                            include: {
                                players: {
                                    include: {
                                        character: true
                                    }
                                }
                            }
                        }
                    }
                });

                if (!user) return;

                await sendResponse(
                    user.adventures.map(adv => ({
                        name: `${adv.name} (Players: ${adv.players.map(p => p.character.name).join(', ')})`,
                        value: adv.id
                    }))
                );
            }
            else if (interaction.commandName === 'delete_character') {
                const user = await prisma.user.findUnique({
                    where: { discordId: interaction.user.id },
                    include: {
                        characters: {
                            include: {
                                adventures: {
                                    include: {
                                        adventure: true
                                    }
                                }
                            }
                        }
                    }
                });

                if (!user) return;

                // Filter out characters in active adventures
                const availableCharacters = user.characters.filter(char => 
                    !char.adventures.some(ap => ap.adventure.status === 'ACTIVE')
                );

                await sendResponse(
                    availableCharacters
                        .filter(char => char.name.toLowerCase().includes(focusedValue))
                        .map(char => ({
                            name: `${char.name} (${char.class}) - Level ${char.level}`,
                            value: char.id
                        }))
                );
            }
            else if (interaction.commandName === 'delete_adventure') {
                logger.debug('Handling delete_adventure autocomplete');
                const user = await prisma.user.findUnique({
                    where: { discordId: interaction.user.id },
                    include: {
                        adventures: {
                            include: {
                                players: {
                                    include: {
                                        character: true
                                    }
                                }
                            }
                        }
                    }
                });

                if (!user) {
                    logger.debug('No user found for delete_adventure autocomplete');
                    return await sendResponse([]);
                }

                logger.debug('Found adventures for autocomplete:', {
                    count: user.adventures.length,
                    adventures: user.adventures.map(a => ({ id: a.id, name: a.name }))
                });

                const choices = user.adventures
                    .filter(adv => {
                        const matchesSearch = adv.name.toLowerCase().includes(focusedValue);
                        logger.debug('Adventure filter:', {
                            name: adv.name,
                            matchesSearch,
                            searchValue: focusedValue
                        });
                        return matchesSearch;
                    })
                    .map(adv => ({
                        name: `${adv.name} (Players: ${adv.players.map(p => p.character.name).join(', ')})`,
                        value: adv.id
                    }));

                logger.debug('Sending autocomplete choices:', {
                    choicesCount: choices.length,
                    choices
                });

                await sendResponse(choices);
            }
            else if (interaction.commandName === 'adventure_settings') {
                const user = await prisma.user.findUnique({
                    where: { discordId: interaction.user.id },
                    include: {
                        adventures: {
                            include: {
                                players: {
                                    include: {
                                        character: true
                                    }
                                }
                            }
                        }
                    }
                });

                if (!user) return;

                const focusedValue = interaction.options.getFocused().toLowerCase();
                await sendResponse(
                    user.adventures
                        .filter(adv => adv.name.toLowerCase().includes(focusedValue))
                        .map(adv => ({
                            name: `${adv.name} (Players: ${adv.players.map(p => p.character.name).join(', ')})`,
                            value: adv.id
                        }))
                );
            }
            else if (interaction.commandName === 'character_setting') {
                const user = await prisma.user.findUnique({
                    where: { discordId: interaction.user.id },
                    include: {
                        characters: true
                    }
                });

                if (!user) return;

                const focusedValue = interaction.options.getFocused().toLowerCase();
                await sendResponse(
                    user.characters
                        .filter(char => char.name.toLowerCase().includes(focusedValue))
                        .map(char => ({
                            name: `${char.name} (${char.class}) - Level ${char.level}`,
                            value: char.id
                        }))
                );
            }
        } catch (error) {
            console.error('Error in autocomplete:', error);
            await interaction.respond([]);
        }
    }

    if (interaction.isButton()) {
        try {
            if (interaction.customId.startsWith('action:')) {
                await interaction.deferReply();
                const action = interaction.customId.replace('action:', '');
                
                // Get the user's active adventure
                const userAdventure = await prisma.adventure.findFirst({
                    where: { 
                        status: 'ACTIVE',
                        players: {
                            some: {
                                character: {
                                    user: {
                                        discordId: interaction.user.id
                                    }
                                }
                            }
                        }
                    },
                    include: {
                        players: {
                            include: {
                                character: {
                                    include: {
                                        user: true,
                                        spells: true,
                                        abilities: true,
                                        inventory: true
                                    }
                                }
                            }
                        }
                    }
                });

                if (!userAdventure) {
                    await interaction.editReply({
                        content: 'You need to be in an active adventure to perform actions.',
                    });
                    return;
                }

                // Find the user's character in this adventure
                const userCharacter = userAdventure.players.find(
                    p => p.character.user.discordId === interaction.user.id
                )?.character;

                if (!userCharacter) {
                    await interaction.editReply({
                        content: 'Character not found in this adventure.',
                    });
                    return;
                }

                // Create game context
                const context: GameContext = {
                    scene: '',  // Will be populated from memory
                    playerActions: [action],
                    characters: userAdventure.players.map(p => toGameCharacter(p.character)),
                    currentState: {
                        health: userCharacter.health,
                        mana: userCharacter.mana,
                        inventory: [],
                        questProgress: userAdventure.status
                    },
                    language: userAdventure.language as SupportedLanguage || 'en-US',
                    adventureSettings: {
                        worldStyle: userAdventure.worldStyle as WorldStyle,
                        toneStyle: userAdventure.toneStyle as ToneStyle,
                        magicLevel: userAdventure.magicLevel as MagicLevel,
                        setting: userAdventure.setting || undefined
                    },
                    memory: await getAdventureMemory(userAdventure.id)
                };

                // Generate AI response
                const response = await generateResponse(context);

                // Process the response using the existing handler
                const channel = interaction.channel;
                if (!channel || !(channel instanceof BaseGuildTextChannel)) {
                    await interaction.editReply({
                        content: 'This command can only be used in a server text channel.',
                    });
                    return;
                }

                // Send formatted response
                await sendFormattedResponse({
                    channel,
                    characterName: userCharacter.name,
                    action,
                    response,
                    language: userAdventure.language as SupportedLanguage,
                    voiceType: userAdventure.voiceType as 'none' | 'discord' | 'elevenlabs' | 'kokoro' | undefined,
                    guild: interaction.guild!,
                    categoryId: userAdventure.categoryId || undefined,
                    adventureId: userAdventure.id
                });

                await interaction.editReply({
                    content: '✨ Ação processada!'
                });
            }
        } catch (error) {
            logger.error('Error handling button interaction:', error);
            await interaction.reply({ 
                content: 'There was an error processing your action.', 
                ephemeral: true 
            });
        }
    }

    if (!interaction.isChatInputCommand()) return;

    try {
        switch (interaction.commandName) {
            case 'help':
                await handleHelp(interaction);
                break;
            case 'register':
                await handleRegister(interaction);
                break;
            case 'link_wallet':
                await handleLinkWallet(interaction);
                break;
            case 'create_character':
                await handleCreateCharacter(interaction);
                break;
            case 'create_adventure':
                await handleStartAdventure(interaction);
                break;
            case 'action':
                await handlePlayerAction(interaction);
                break;
            case 'list_characters':
                await handleListCharacters(interaction);
                break;
            case 'list_adventures':
                await handleListAdventures(interaction);
                break;
            case 'delete_character':
                await handleDeleteCharacter(interaction);
                break;
            case 'delete_adventure':
                await handleDeleteAdventure(interaction);
                break;
            case 'add_friend':
                await handleAddFriend(interaction);
                break;
            case 'remove_friend':
                await handleRemoveFriend(interaction);
                break;
            case 'accept_friend':
                await handleAcceptFriend(interaction);
                break;
            case 'list_friend_requests':
                await handleListFriendRequests(interaction);
                break;
            case 'join_adventure':
                await handleJoinAdventure(interaction);
                break;
            case 'list_friends':
                await handleListFriends(interaction);
                break;
            case 'adventure_settings':
                await handleAdventureSettings(interaction);
                break;
            case 'disconnect_voice':
                await handleDisconnectVoice(interaction);
                break;
            case 'character_setting':
                await handleCharacterSetting(interaction);
                break;
            default:
                // Handle unknown command
                break;
        }
    } catch (error) {
        console.error('Error handling command:', error);
        const errorMessage = 'There was an error executing this command.';
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
        }
    }
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received. Starting graceful shutdown...');
    try {
        await prisma.$disconnect();
        client.destroy();
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received. Starting graceful shutdown...');
    try {
        await prisma.$disconnect();
        client.destroy();
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
    }
});

client.login(process.env.DISCORD_TOKEN); 