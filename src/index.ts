import { config } from 'dotenv';
import { 
    Client, 
    GatewayIntentBits, 
    Events, 
    SlashCommandBuilder,
    REST,
    Routes
} from 'discord.js';
import { handleRegister } from './commands/register';
import { handleHelp } from './commands/help';
import { handleLinkWallet } from './commands/wallet';
import { handleCreateCharacter } from './commands/character';
import { handleStartAdventure } from './commands/adventure';
import { handleListCharacters, handleListAdventures } from './commands/list';
import { handleDeleteCharacter, handleDeleteAdventure } from './commands/delete';
import { 
    handleAddFriend, 
    handleRemoveFriend, 
    handleAcceptFriend, 
    handleListFriendRequests 
} from './commands/friend';
import { PrismaClient } from '@prisma/client';
import { handleJoinAdventure } from './commands/adventure';
import { handleListFriends } from './commands/friend';
import { handlePlayerAction } from './commands/adventure';
import { handleAdventureSettings } from './commands/adventure';
import dotenv from 'dotenv';
import { handleDisconnectVoice } from './commands/adventure';

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ]
});

const prisma = new PrismaClient();

// Add this line to verify env vars are loaded
console.log('Environment check:', {
    hasElevenLabsKey: !!process.env.ELEVENLABS_API_KEY,
    keyLength: process.env.ELEVENLABS_API_KEY?.length
});

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
        .setDescription('Create a new character')
        .addStringOption(option => 
            option.setName('name')
            .setDescription('Character name')
            .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('class')
            .setDescription('Character class')
            .setRequired(true)
            .addChoices(
                { name: 'Warrior', value: 'warrior' },
                { name: 'Mage', value: 'mage' },
                { name: 'Rogue', value: 'rogue' }
            )
        ),
    new SlashCommandBuilder()
        .setName('start_adventure')
        .setDescription('Start a new adventure')
        .addStringOption(option =>
            option
                .setName('players')
                .setDescription('Select characters to include')
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
            .setDescription('The ID of the character to delete')
            .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('delete_adventure')
        .setDescription('Delete an adventure and its channels')
        .addStringOption(option =>
            option.setName('adventure_id')
            .setDescription('The ID of the adventure to delete')
            .setRequired(true)
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
                .setRequired(true))
        .addStringOption(option =>
            option.setName('language')
                .setDescription('Select language')
                .setRequired(false)
                .addChoices(
                    { name: 'English (US)', value: 'English (US)' },
                    { name: 'Português (Brasil)', value: 'Português (Brasil)' }
                ))
        .addStringOption(option =>
            option.setName('voice')
                .setDescription('Select voice type')
                .setRequired(false)
                .addChoices(
                    { name: 'Discord TTS', value: 'discord' },
                    { name: 'ElevenLabs', value: 'elevenlabs' }
                )),
    new SlashCommandBuilder()
        .setName('disconnect_voice')
        .setDescription('Disconnect the bot from voice channel'),
].map(command => command.toJSON());

client.once(Events.ClientReady, async (c) => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
    
    const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
    try {
        await rest.put(
            Routes.applicationCommands(c.user.id),
            { body: commands }
        );
        console.log('Successfully registered application commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isAutocomplete()) {
        try {
            if (interaction.commandName === 'accept_friend') {
                const user = await prisma.user.findUnique({
                    where: { discordId: interaction.user.id }
                });

                if (!user) return;

                const requests = await prisma.friendship.findMany({
                    where: {
                        friendId: user.id,
                        status: 'PENDING'
                    },
                    include: { user: true },
                    take: 25
                });

                await interaction.respond(
                    requests.map(req => ({
                        name: `From: ${req.user.username}`,
                        value: req.id
                    }))
                );
            }
            else if (interaction.commandName === 'start_adventure') {
                const focusedValue = interaction.options.getFocused();
                console.log('Focused value:', focusedValue);
                
                const user = await prisma.user.findUnique({
                    where: { discordId: interaction.user.id },
                    include: {
                        characters: true,
                        // Friends that the user added
                        friends: {
                            where: { status: 'ACCEPTED' },
                            include: {
                                friend: {
                                    include: {
                                        characters: true
                                    }
                                }
                            }
                        },
                        // Friends that added the user
                        friendOf: {
                            where: { status: 'ACCEPTED' },
                            include: {
                                user: {
                                    include: {
                                        characters: true
                                    }
                                }
                            }
                        }
                    }
                });

                if (!user) {
                    console.log('No user found');
                    return;
                }

                // Get all available characters
                const allCharacters = [
                    ...user.characters,
                    ...user.friends.flatMap(f => f.friend.characters),
                    ...user.friendOf.flatMap(f => f.user.characters)
                ].filter(char => {
                    const nameMatches = char.name.toLowerCase().includes(focusedValue.toLowerCase());
                    return nameMatches;
                });

                await interaction.respond(
                    allCharacters.slice(0, 25).map(char => ({
                        // Show full info in the dropdown
                        name: `${char.name} (${char.class}) - ${char.userId === user.id ? 'Your Character' : 'Friend\'s Character'}`,
                        // But only use the name as the value
                        value: char.name
                    }))
                );
            }
            else if (interaction.commandName === 'join_adventure') {
                const focusedOption = interaction.options.getFocused(true);
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

                if (focusedOption.name === 'character_name') {
                    // Get characters not in active adventures
                    const availableCharacters = user.characters.filter(char => 
                        !char.adventures.some(ap => ap.adventure.status === 'ACTIVE')
                    );

                    await interaction.respond(
                        availableCharacters.map(char => ({
                            name: `${char.name} (${char.class}) - Level ${char.level}`,
                            value: char.name
                        }))
                    );
                }
                else if (focusedOption.name === 'adventure_id') {
                    // Get friend's active adventures
                    const friendAdventures = await prisma.adventure.findMany({
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

                    await interaction.respond(
                        friendAdventures.map(adv => ({
                            name: `${adv.name} - by ${adv.user.username} (Players: ${adv.players.map(p => p.character.name).join(', ')})`,
                            value: adv.id
                        }))
                    );
                }
            }
        } catch (error) {
            console.error('Error in autocomplete:', error);
            await interaction.respond([]);
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
            case 'start_adventure':
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

client.login(process.env.DISCORD_TOKEN); 