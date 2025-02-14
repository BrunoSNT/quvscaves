import { 
    Client,
    Events, 
    SlashCommandBuilder,
    REST,
    IntentsBitField as Intents,
    BaseGuildTextChannel,
    ChatInputCommandInteraction,
    MessageFlags,
} from 'discord.js';
import dotenv from 'dotenv';
import { prisma } from './core/prisma';
import { WorldStyle, ToneStyle, MagicLevel } from './shared/game/types';
import { generateResponse } from './ai/gamemaster';
import { sendFormattedResponse } from './shared/discord/embeds';
import { Character } from './features/character/types';
import { handleCreateCharacter } from './features/character/commands/create';
import { handleCharacterSettings } from './features/character/commands/settings';
import { handleListCharacters } from './features/character/commands/list';
import { handleDeleteCharacter } from './features/character/commands/delete';
import { handleAddFriend } from './features/social/commands/add';
import { handleRemoveFriend } from './features/social/commands/remove';
import { handleAcceptFriend } from './features/social/commands/accept';
import { handleListFriends } from './features/social/commands/list';
import { handleJoinAdventure } from './features/adventure/commands/join';
import { handlePlayerAction } from './features/adventure/commands/action';
import { handleListAdventures } from './features/adventure/commands/index';
import { handleAdventureSettings } from './features/adventure/commands/settings';
import { handleDeleteAdventure } from './features/adventure/commands/delete';
import { handleCreateAdventure } from './features/adventure/commands/create';
import { AdventureSettings } from './features/adventure/types';
import { handleRegister } from './features/user/commands/register';
import { handleHelp } from './features/user/commands/help';
import { handleLinkWallet } from './features/wallet/commands/link';
import { logger } from './shared/logger';
import { SupportedLanguage } from './shared/i18n/types';
import { GameContext } from './shared/game/types';


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

type Adventure = {
    id: string;
    name: string;
    user: { 
        id: string;
        username: string 
    };
    players: { character: { name: string } }[];
};
// Define an extended adventure type that includes the relations.
interface ExtendedAdventure extends Adventure {
  user: { id: string; username: string };
  players: { character: { name: string } }[];
  status: string;
}

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
                    logger.warn(`No user found for Discord ID: ${interaction.user.id}`);
                    await sendResponse([]);
                    return;
                }

                // Get current input value and split by commas
                const currentInput = focusedOption.value;
                const selectedCharacters = currentInput.split(/,\s*/).filter(Boolean);
                const searchTerm = selectedCharacters[selectedCharacters.length - 1]?.toLowerCase() || '';

                logger.debug('Create adventure autocomplete:', {
                    currentInput,
                    selectedCharacters,
                    searchTerm,
                    availableCharacters: user.characters.length
                });

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
                            ? [...selectedCharacters.slice(0, -1), char.id].join(', ')  // Use character ID instead of name
                            : char.id  // Use character ID for first selection
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
                            user: {
                                OR: [
                                    {
                                        friendRequestsSent: {
                                            some: {
                                                friendId: user.id,
                                                status: 'ACCEPTED'
                                            }
                                        }
                                    },
                                    {
                                        friendRequestsReceived: {
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
                        (adventures as Adventure[]).map(adv => ({
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

                if (!user || user.adventures.length === 0) {
                    return interaction.respond([]);
                }

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
                                        CharacterSpell: true,
                                        CharacterAbility: true
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
                    scene: '',
                    playerActions: [action],
                    characters: userAdventure.players.map(p => ({
                        id: p.character.id,
                        name: p.character.name,
                        class: p.character.class,
                        race: p.character.race,
                        level: p.character.level,
                        experience: p.character.experience,
                        health: p.character.health,
                        maxHealth: p.character.maxHealth,
                        mana: p.character.mana,
                        maxMana: p.character.maxMana,
                        stats: p.character.stats as any,
                        skills: p.character.skills as any,
                        inventory: [],
                        effects: [],
                        userId: p.character.userId,
                        createdAt: p.character.createdAt,
                        updatedAt: p.character.updatedAt,
                        strength: p.character.strength,
                        dexterity: p.character.dexterity,
                        constitution: p.character.constitution,
                        intelligence: p.character.intelligence,
                        wisdom: p.character.wisdom,
                        charisma: p.character.charisma,
                        proficiencies: p.character.proficiencies as string[],
                        languages: p.character.languages as string[],
                        spells: p.character.CharacterSpell.map(s => ({
                            id: s.id,
                            name: s.name,
                            level: s.level,
                            school: s.school,
                            description: s.description,
                            characterId: s.characterId
                        })),
                        abilities: p.character.CharacterAbility.map(a => ({
                            id: a.id,
                            name: a.name,
                            type: a.type,
                            description: a.description,
                            uses: a.uses || undefined,
                            recharge: a.recharge || undefined,
                            characterId: a.characterId
                        })),
                        background: p.character.background || undefined
                    })) as Character[],
                    currentState: {
                        health: userCharacter.health,
                        mana: userCharacter.mana,
                        inventory: [],
                        questProgress: userAdventure.status
                    },
                    language: userAdventure.language as SupportedLanguage,
                    adventureSettings: {
                        worldStyle: userAdventure.worldStyle as WorldStyle,
                        toneStyle: userAdventure.toneStyle as ToneStyle,
                        magicLevel: userAdventure.magicLevel as MagicLevel,
                        language: userAdventure.language as SupportedLanguage,
                        useVoice: userAdventure.voiceType !== 'NONE'
                    },
                    memory: {
                        recentScenes: [],
                        activeQuests: [],
                        knownCharacters: [],
                        discoveredLocations: [],
                        importantItems: []
                    },
                    adventure: {
                        id: userAdventure.id,
                        name: userAdventure.name,
                        description: userAdventure.description || undefined,
                        status: userAdventure.status,
                        language: userAdventure.language,
                        voiceType: userAdventure.voiceType,
                        privacy: userAdventure.privacy,
                        worldStyle: userAdventure.worldStyle as WorldStyle,
                        toneStyle: userAdventure.toneStyle as ToneStyle,
                        magicLevel: userAdventure.magicLevel as MagicLevel,
                        categoryId: userAdventure.categoryId || undefined,
                        textChannelId: userAdventure.textChannelId || undefined,
                        settings: userAdventure.settings as unknown as AdventureSettings,
                        players: userAdventure.players.map(p => ({
                            id: p.id,
                            adventureId: p.adventureId,
                            characterId: p.characterId,
                            userId: p.userId,
                            username: p.username,
                            joinedAt: p.joinedAt,
                            characterName: p.character.name
                        })),
                        createdAt: userAdventure.createdAt,
                        updatedAt: userAdventure.updatedAt,
                        userId: userAdventure.userId
                    }
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
                await sendFormattedResponse(interaction as unknown as ChatInputCommandInteraction, {
                    channel,
                    characterName: userCharacter.name,
                    action,
                    response,
                    language: userAdventure.language as SupportedLanguage,
                    voiceType: userAdventure.voiceType as 'none' | 'discord' | 'elevenlabs' | 'kokoro' | undefined,
                    guild: interaction.guild!,
                    categoryId: userAdventure.categoryId || undefined,
                    adventureId: userAdventure.id,
                    title: '',
                    description: ''
                });

                await interaction.editReply({
                    content: '✨ Ação processada!'
                });
            }
        } catch (error) {
            logger.error('Error handling button interaction:', error);
            await interaction.reply({ 
                content: 'There was an error processing your action.', 
                flags: MessageFlags.Ephemeral
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
                await handleCreateAdventure(interaction);
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
            case 'join_adventure':
                await handleJoinAdventure(interaction);
                break;
            case 'list_friends':
                await handleListFriends(interaction);
                break;
            case 'adventure_settings':
                await handleAdventureSettings(interaction);
                break;
            case 'character_setting':
                await handleCharacterSettings(interaction);
                break;
            default:
                // Handle unknown command
                break;
        }
    } catch (error) {
        console.error('Error handling command:', error);
        const errorMessage = 'There was an error executing this command.';
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
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