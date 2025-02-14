require('dotenv').config();
const { Client, GatewayIntentBits, Events, SlashCommandBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { Connection, PublicKey } = require('@solana/web3.js');
const QRCode = require('qrcode');
const { REST, Routes } = require('discord.js');

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Create client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Register slash command
const commands = [
    new SlashCommandBuilder()
        .setName('link_wallet')
        .setDescription('Link your Solana wallet')
        .addStringOption(option =>
            option.setName('wallet_address')
                .setDescription('Your Solana wallet address')
                .setRequired(true))
].map(command => command.toJSON());

client.once(Events.ClientReady, async (c) => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
    
    // Register commands
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(c.user.id),
            { body: commands },
        );
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

// Handle interactions
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'link_wallet') {
        try {
            const walletAddress = interaction.options.getString('wallet_address');

            // Validate Solana address
            try {
                new PublicKey(walletAddress);
            } catch (error) {
                await interaction.reply({
                    content: 'Invalid Solana wallet address. Please check and try again.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            // Store in Supabase
            const { error } = await supabase
                .from('wallet_links')
                .upsert({
                    discord_id: interaction.user.id,
                    wallet_address: walletAddress,
                    updated_at: new Date()
                });

            if (error) throw error;

            // Generate QR code for the wallet address
            const qrCodeDataUrl = await QRCode.toDataURL(`solana:${walletAddress}`);

            await interaction.reply({
                content: `✅ Wallet linked successfully!\n\nWallet Address: \`${walletAddress}\`\n\nNew to Solana? Here's how to get started:\n1. Download Phantom Wallet from https://phantom.app\n2. Create a new wallet or import existing\n3. Send some SOL to your wallet for transactions`,
                files: [{
                    attachment: Buffer.from(qrCodeDataUrl.split(',')[1], 'base64'),
                    name: 'wallet-qr.png'
                }],
                flags: MessageFlags.Ephemeral
            });

        } catch (error) {
            console.error('Error linking wallet:', error);
            await interaction.reply({
                content: 'There was an error linking your wallet. Please try again later.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
});

// Message handling
client.on(Events.MessageCreate, async message => {
    // Ignore messages from bots
    if (message.author.bot) return;

    // Simple command handling
    if (message.content === '!ping') {
        await message.reply('Pong!');
    }
});

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

// Login
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('Failed to login:', error);
}); 