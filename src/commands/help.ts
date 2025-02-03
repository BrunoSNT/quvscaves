import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

export async function handleHelp(interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('🎮 RPG Bot Help Guide')
        .setDescription('Welcome to the AI-driven RPG experience! Here are all the commands you can use:')
        .addFields(
            { 
                name: '📝 Getting Started',
                value: [
                    '`/register [nickname]` - Create your account',
                    '`/create_character [name] [class]` - Create a new character',
                    '`/link_wallet [address]` - Link your Solana wallet'
                ].join('\n')
            },
            {
                name: '👥 Friend System',
                value: [
                    '`/add_friend [@user]` - Send a friend request',
                    '`/accept_friend [request_id]` - Accept a friend request',
                    '`/list_friend_requests` - View pending friend requests',
                    '`/list_friends` - View all your friends',
                    '`/remove_friend [@user]` - Remove a friend'
                ].join('\n')
            },
            {
                name: '🎲 Adventure Commands',
                value: [
                    '`/start_adventure [player_names]` - Begin a new adventure with friends',
                    '`/action [description]` - Perform an action in your adventure',
                    'Example: `/action I search the room for treasure`'
                ].join('\n')
            },
            {
                name: '📋 Management Commands',
                value: [
                    '`/list_characters` - View all your characters',
                    '`/list_adventures` - View all your adventures',
                    '`/delete_character [character_id]` - Delete a character',
                    '`/delete_adventure [adventure_id]` - Delete an adventure'
                ].join('\n')
            },
            {
                name: '🎭 Character Classes',
                value: [
                    '**Warrior** - Strong melee fighter with high health',
                    '**Mage** - Powerful spellcaster with high mana',
                    '**Rogue** - Agile character with stealth abilities'
                ].join('\n')
            },
            {
                name: '🤖 AI Game Master',
                value: [
                    'ElizaOS responds to your actions with:',
                    '- [Narration] Scene descriptions',
                    '- [Dialogue] NPC conversations',
                    '- [Suggested Choices] Available options',
                    '- [Effects] Status changes'
                ].join('\n')
            },
            {
                name: '🔊 Voice & 💰 Payment Features',
                value: [
                    '• AI Game Master speaks in voice channels',
                    '• Use Solana wallet for:',
                    '  - Adventure sessions',
                    '  - Special items',
                    '  - Character upgrades'
                ].join('\n')
            }
        )
        .setFooter({ 
            text: 'Tip: Add friends to invite them to your adventures!' 
        });

    await interaction.reply({
        embeds: [embed],
        ephemeral: true
    });
} 