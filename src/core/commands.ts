import { Client, REST, Routes } from 'discord.js';
import { logger } from '../shared/logger';
import { adventureCommands } from '../features/adventure/commands';
import { characterCommands } from '../features/character/commands';
import { socialCommands } from '../features/social/commands';
import { walletCommands } from '../features/wallet/commands';
import { userCommands } from '../features/user/commands';
import { config } from './config';

// Combine all command definitions
const commands = [
    ...userCommands,
    ...adventureCommands,
    ...characterCommands,
    ...socialCommands,
    ...walletCommands,
].map(command => ('data' in command ? command.data : command).toJSON());

export const registerCommands = async (client: Client) => {
    const rest = new REST().setToken(config.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user!.id),
            { body: commands }
        );
        logger.info('Successfully registered application commands.');
    } catch (error) {
        logger.error('Error registering commands:', error);
    }
}; 