import { 
    Client,
    Events,
    GatewayIntentBits
} from 'discord.js';
import { logger } from '../shared/logger';
import { registerCommands } from './commands';
import dotenv from 'dotenv';

// Suppress punycode deprecation warning
process.removeAllListeners('warning');
process.on('warning', (warning) => {
    if (warning.name !== 'DeprecationWarning' || !warning.message.includes('punycode')) {
        console.warn(warning);
    }
});

dotenv.config();

export const createBot = () => {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates,
        ]
    });

    client.once(Events.ClientReady, async (c) => {
        logger.info(`Ready! Logged in as ${c.user.tag}`);
        await registerCommands(client);
    });

    return client;
}; 