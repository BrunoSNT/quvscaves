import { SlashCommandBuilder } from 'discord.js';
import { handleCreateCharacter } from './create';
import { handleListCharacters } from './list';
import { handleDeleteCharacter } from './delete';
import { handleCharacterSettings } from './settings';

export const characterCommands = [
    new SlashCommandBuilder()
        .setName('create_character')
        .setDescription('Create a new RPG character')
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('Your character name')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('list_characters')
        .setDescription('List all your characters'),
    new SlashCommandBuilder()
        .setName('delete_character')
        .setDescription('Delete a character')
        .addStringOption(option =>
            option
                .setName('character_id')
                .setDescription('Select the character to delete')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('character_settings')
        .setDescription('Change character settings')
        .addStringOption(option =>
            option.setName('character_id')
            .setDescription('The character to modify')
            .setRequired(true)
            .setAutocomplete(true)
        )
];

export {
    handleCreateCharacter,
    handleListCharacters,
    handleDeleteCharacter,
    handleCharacterSettings
}; 