"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const discord_js_1 = require("discord.js");
const register_1 = require("./commands/register");
(0, dotenv_1.config)();
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.MessageContent,
    ]
});
const commands = [
    new discord_js_1.SlashCommandBuilder()
        .setName('register')
        .setDescription('Register your account'),
    new discord_js_1.SlashCommandBuilder()
        .setName('create_character')
        .setDescription('Create a new character')
        .addStringOption(option => option.setName('name')
        .setDescription('Character name')
        .setRequired(true))
        .addStringOption(option => option.setName('class')
        .setDescription('Character class')
        .setRequired(true)
        .addChoices({ name: 'Warrior', value: 'warrior' }, { name: 'Mage', value: 'mage' }, { name: 'Rogue', value: 'rogue' })),
    new discord_js_1.SlashCommandBuilder()
        .setName('start_adventure')
        .setDescription('Start a new adventure'),
    new discord_js_1.SlashCommandBuilder()
        .setName('action')
        .setDescription('Perform an action in your adventure')
        .addStringOption(option => option.setName('description')
        .setDescription('What would you like to do?')
        .setRequired(true))
].map(command => command.toJSON());
client.once(discord_js_1.Events.ClientReady, async (c) => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
    const rest = new discord_js_1.REST().setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(discord_js_1.Routes.applicationCommands(c.user.id), { body: commands });
        console.log('Successfully registered application commands.');
    }
    catch (error) {
        console.error('Error registering commands:', error);
    }
});
client.on(discord_js_1.Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand())
        return;
    if (interaction.commandName === 'register') {
        await (0, register_1.handleRegister)(interaction);
    }
});
client.login(process.env.DISCORD_TOKEN);
