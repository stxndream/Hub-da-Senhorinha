const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');
const { connectDatabase } = require('./utils/database');
const { initUserCredentialsTable } = require('./utils/userCredentials');
const commandHandler = require('./handlers/commandHandler');
const eventHandler = require('./handlers/eventHandler');

// Initialize client with all necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildInvites
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember
    ],
    shards: process.env.SHARD_ID ? parseInt(process.env.SHARD_ID) : 'auto',
    shardCount: process.env.SHARD_COUNT ? parseInt(process.env.SHARD_COUNT) : 'auto'
});

// Create collections for commands, cooldowns, and other data
client.commands = new Collection();
client.cooldowns = new Collection();
client.invites = new Collection();
client.tickets = new Collection();
client.warnings = new Collection();
client.config = config;

// Initialize bot
(async () => {
    try {
        // Connect to database
        await connectDatabase();
        console.log(`[SHARD ${client.shard?.ids[0] || 'Unknown'}] Connected to database`);
        
        // Initialize user credentials table
        await initUserCredentialsTable();
        console.log(`[SHARD ${client.shard?.ids[0] || 'Unknown'}] User credentials table initialized`);
        
        // Load commands
        await commandHandler(client);
        
        // Load events
        await eventHandler(client);
        
        // Initialize invite tracking
        if (config.features.inviteTracking) {
            const guild = await client.guilds.fetch(config.bot.guildId);
            const firstInvites = await guild.invites.fetch();
            client.invites.set(guild.id, new Collection(firstInvites.map((invite) => [invite.code, invite.uses])));
        }
        
        // Set bot activity
        if (config.bot.activity) {
            client.user.setActivity(config.bot.activity.name, { type: config.bot.activity.type });
        }
        
        // Bot login
        await client.login(config.bot.token);
        
        console.log(`[SHARD ${client.shard?.ids[0] || 'Unknown'}] Bot logged in successfully`);
    } catch (error) {
        console.error(`[SHARD ${client.shard?.ids[0] || 'Unknown'}] Error initializing the bot:`, error);
    }
})();

// Handle uncaught errors
process.on('unhandledRejection', error => {
    console.error(`[SHARD ${client.shard?.ids[0] || 'Unknown'}] Unhandled Rejection:`, error);
});

process.on('uncaughtException', error => {
    console.error(`[SHARD ${client.shard?.ids[0] || 'Unknown'}] Uncaught Exception:`, error);
});

// Add process events to help with debugging
process.on('exit', code => {
    console.error(`[SHARD ${client.shard?.ids[0] || 'Unknown'}] Process exited with code ${code}`);
});

// Make sure to disconnect the client before the process exits
process.on('SIGINT', () => {
    console.log(`[SHARD ${client.shard?.ids[0] || 'Unknown'}] Received SIGINT, gracefully shutting down`);
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log(`[SHARD ${client.shard?.ids[0] || 'Unknown'}] Received SIGTERM, gracefully shutting down`);
    client.destroy();
    process.exit(0);
});