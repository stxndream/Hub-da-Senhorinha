const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js'); 
const fs = require('fs');
const path = require('path');
const config = require('./config.json');
const { connectDatabase } = require('./utils/database');
const { initUserCredentialsTable } = require('./utils/userCredentials');
const commandHandler = require('./handlers/commandHandler');
const eventHandler = require('./handlers/eventHandler');
const { startServer } = require('./server');
const { userSelections, saveUserSettingsToFile, showUserSettings } = require('./handlers/generatorEmbed');
const { initAutoSummon } = require('./handlers/autoSummon');
const { initAltAutoSummon } = require('./handlers/autoSummonAlt'); 

// Initialize client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages
    ]
});

// Create collections for commands and cooldowns
client.commands = new Collection();
client.cooldowns = new Collection();

// Initialize bot
(async () => {
    try {
        // Check if bot token is configured
        if (!config.bot.token || config.bot.token === '') {
            throw new Error('Bot token is not configured in config.json. Please add your Discord bot token.');
        }

        // Connect to database
        await connectDatabase();
        console.log('Connected to database');

        // Load commands
        await commandHandler(client);
        
        // Load events
        await eventHandler(client);
        
        // Start HTTP server
        const server = await startServer();
        console.log('HTTP Server started on port', server.address().port);
        
        // Bot login
        await client.login(config.bot.token);
    } catch (error) {
        console.error('Error initializing the bot:', error);
        process.exit(1);
    }
})();

client.on('rateLimit', (rateLimitInfo) => {
    console.warn('Rate limit hit!', rateLimitInfo);
    
    // If we're hitting rate limits frequently, increase the delays in the request queue
    if (rateLimitInfo.timeout > 3000) {
        console.log('Severe rate limiting detected - increasing queue delay');
        // You could dynamically adjust your requestQueue delays here
    }
});

client.once('ready', async () => {
    console.log(`🤖 Bot online as ${client.user.tag}`);
    
    // Initialize auto-summon system (will create initial embed and start refresh timer)
    await initAutoSummon(client);
    await initAltAutoSummon(client);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'service_modal') return;

    try {
        const service = interaction.fields.getTextInputValue('service_name');
        const userId = interaction.user.id;

        // Get existing selections or create new default ones
        const userSelectionsData = userSelections.get(userId) || {
            generator: 'fgen',
            service: null,
            sendDM: false
        };

        // Update service setting
        userSelectionsData.service = service;
        userSelections.set(userId, userSelectionsData);
        
        // Save to file if that function is available
        if (typeof saveUserSettingsToFile === 'function') {
            await saveUserSettingsToFile();
        }

        // Create confirmation embed
        const confirmEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Service Updated')
            .setDescription(`Your preferred service has been set to: **${service}**`)
            .setFooter({ text: 'Saved successfully' })
            .setTimestamp();

        // Send confirmation
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ 
                embeds: [confirmEmbed], 
                ephemeral: true 
            });
        } else {
            await interaction.followUp({ 
                embeds: [confirmEmbed], 
                ephemeral: true 
            });
        }
    } catch (error) {
        console.error('Error processing modal submission:', error);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: 'An error occurred while updating your service preference.',
                    ephemeral: true 
                });
            } else {
                await interaction.followUp({ 
                    content: 'An error occurred while updating your service preference.',
                    ephemeral: true 
                });
            }
        } catch (finalError) {
            console.error('Failed to send error message for modal submission:', finalError);
        }
    }
});

// Handle uncaught errors
process.on('unhandledRejection', error => {
    console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught Exception:', error);
    // Keep the bot running even with serious errors
});

module.exports = { client };