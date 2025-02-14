import { SlashCommandBuilder } from 'discord.js';
import { handleRegister } from './register';
import { handleHelp } from './help';

export const userCommands = [
    new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register your account')
        .addStringOption(option => 
            option.setName('nickname')
            .setDescription('Your preferred nickname in the game')
            .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands and features')
];

export {
    handleRegister,
    handleHelp
}; 