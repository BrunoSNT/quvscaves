import { SlashCommandBuilder } from 'discord.js';
import { handleCreateAdventure } from './create';
import { handleJoinAdventure } from './join';
import { handlePlayerAction } from './action';
import { handleAdventureSettings } from './settings';
import { handleDeleteAdventure } from './delete';
import { handleListAdventures } from './list';

export const adventureCommands = [
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
        .setName('action')
        .setDescription('Perform an action in your adventure')
        .addStringOption(option =>
            option
                .setName('description')
                .setDescription('What would you like to do?')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('adventure_settings')
        .setDescription('Change adventure settings')
        .addStringOption(option =>
            option.setName('adventure_id')
                .setDescription('The ID of the adventure')
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
];

export {
    handleCreateAdventure,
    handleJoinAdventure,
    handlePlayerAction,
    handleAdventureSettings,
    handleDeleteAdventure,
    handleListAdventures,
}; 