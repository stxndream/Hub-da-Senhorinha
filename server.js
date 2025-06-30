const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const jwt = require('jsonwebtoken');
const multer = require('multer');
const axios = require('axios');
const config = require('./config.json');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || config.api.port || 3000;

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 256 * 1024 } // 256KB limit for emojis
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

// JWT Secret (you should change this to a secure secret)
const JWT_SECRET = 'gallaapi';

// Admin authentication middleware
function authenticateToken(req, res, next) {
    let token = null;
    if (req.cookies && req.cookies.adminToken) {
        token = req.cookies.adminToken;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// Updated isAdmin: returns admin object or null
async function isAdmin(username) {
    try {
        const adminsPath = path.join(__dirname, 'utils', 'data', 'admins.json');
        const adminsData = await fs.readFile(adminsPath, 'utf8');
        const admins = JSON.parse(adminsData);
        return admins.find(admin => admin.username === username) || null;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return null;
    }
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Protected admin route - check if user has valid token
app.get('/admin', async (req, res) => {
    const token = req.cookies?.adminToken || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.redirect('/');
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const admin = await isAdmin(decoded.username);
        
        if (admin) {
            res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
        } else {
            res.redirect('/');
        }
    } catch (error) {
        res.redirect('/');
    }
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        console.log('🔍 Login attempt:', { username, password: password ? '***' : 'undefined' });
        
        // Find admin by username
        const admin = await isAdmin(username);
        console.log('👤 Admin found:', admin ? { username: admin.username, hasPassword: !!admin.password } : 'null');
        
        if (!admin) {
            console.log('❌ No admin found for username:', username);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check password (support SHA256 hash or plain)
        let passwordMatches = false;
        if (admin.password.length === 64) { // SHA256 hash
            const hash = crypto.createHash('sha256').update(password).digest('hex');
            passwordMatches = (hash === admin.password);
            console.log('🔐 SHA256 check:', { 
                inputHash: hash, 
                storedHash: admin.password, 
                matches: passwordMatches 
            });
        } else {
            passwordMatches = (password === admin.password);
            console.log('🔐 Plain text check:', { 
                input: password, 
                stored: admin.password, 
                matches: passwordMatches 
            });
        }

        if (!passwordMatches) {
            console.log('❌ Password mismatch for user:', username);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        console.log('✅ Login successful for user:', username);
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
        
        // Set secure HTTP-only cookie
        res.cookie('adminToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // Only use HTTPS in production
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        
        res.json({ token });
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Validate token
app.get('/api/admin/validate', authenticateToken, async (req, res) => {
    try {
        const adminStatus = await isAdmin(req.user.username);
        if (!adminStatus) {
            return res.status(401).json({ error: 'Not authorized' });
        }
        res.json({ valid: true });
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Get server data
app.get('/api/admin/server-data', authenticateToken, async (req, res) => {
    try {
        const isAdminUser = await isAdmin(req.user.username);
        if (!isAdminUser) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const { client } = require('./index.js');
        const guild = client.guilds.cache.get(config.bot.guildId);
        
        if (!guild) {
            return res.status(404).json({ error: 'Server not found' });
        }

        const serverData = {
            id: guild.id,
            name: guild.name,
            memberCount: guild.memberCount,
            owner: guild.owner,
            createdAt: guild.createdAt,
            roles: guild.roles.cache.map(role => ({
                id: role.id,
                name: role.name,
                color: role.color,
                position: role.position,
                members: role.members.size
            })),
            channels: guild.channels.cache.map(channel => ({
                id: channel.id,
                name: channel.name,
                type: channel.type,
                position: channel.position
            })),
            emojis: guild.emojis.cache.map(emoji => ({
                id: emoji.id,
                name: emoji.name,
                url: emoji.url,
                animated: emoji.animated
            }))
        };

        res.json(serverData);
    } catch (error) {
        console.error('Error fetching server data:', error);
        res.status(500).json({ error: 'Failed to fetch server data' });
    }
});

// Create backup
app.post('/api/admin/backup/create', authenticateToken, async (req, res) => {
    try {
        const isAdminUser = await isAdmin(req.user.username);
        if (!isAdminUser) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const { roles = true, channels = true, emojis = true, settings = true, webhooks = true } = req.body;
        const { client } = require('./index.js');
        const guild = client.guilds.cache.get(config.bot.guildId);
        
        if (!guild) {
            return res.status(404).json({ error: 'Server not found' });
        }

        const backup = {
            id: Date.now().toString(),
            name: `${guild.name}_backup_${new Date().toISOString().split('T')[0]}`,
            createdAt: new Date().toISOString(),
            server: {
                id: guild.id,
                name: guild.name,
                description: guild.description,
                verificationLevel: guild.verificationLevel,
                explicitContentFilter: guild.explicitContentFilter,
                defaultMessageNotifications: guild.defaultMessageNotifications
            }
        };

        if (roles) {
            backup.roles = guild.roles.cache.map(role => ({
                id: role.id,
                name: role.name,
                color: role.color,
                hoist: role.hoist,
                position: role.position,
                permissions: role.permissions.toArray(),
                mentionable: role.mentionable
            }));
        }

        if (channels) {
            backup.channels = guild.channels.cache.map(channel => ({
                id: channel.id,
                name: channel.name,
                type: channel.type,
                position: channel.position,
                topic: channel.topic,
                nsfw: channel.nsfw,
                bitrate: channel.bitrate,
                userLimit: channel.userLimit,
                rateLimitPerUser: channel.rateLimitPerUser,
                parentId: channel.parentId
            }));
        }

        if (emojis) {
            backup.emojis = guild.emojis.cache.map(emoji => ({
                id: emoji.id,
                name: emoji.name,
                url: emoji.url,
                animated: emoji.animated,
                managed: emoji.managed,
                requireColons: emoji.requireColons,
                roles: emoji.roles.cache.map(role => role.id)
            }));
        }

        if (settings) {
            backup.settings = {
                verificationLevel: guild.verificationLevel,
                explicitContentFilter: guild.explicitContentFilter,
                defaultMessageNotifications: guild.defaultMessageNotifications,
                systemChannelId: guild.systemChannelId,
                rulesChannelId: guild.rulesChannelId,
                publicUpdatesChannelId: guild.publicUpdatesChannelId,
                preferredLocale: guild.preferredLocale
            };
        }

        if (webhooks) {
            const webhooksList = await guild.fetchWebhooks();
            backup.webhooks = webhooksList.map(webhook => ({
                id: webhook.id,
                name: webhook.name,
                avatar: webhook.avatarURL(),
                channelId: webhook.channelId,
                url: webhook.url
            }));
        }

        // Save backup to file
        const backupDir = path.join(__dirname, 'backups');
        await fs.mkdir(backupDir, { recursive: true });
        const backupPath = path.join(backupDir, `${backup.id}.json`);
        await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));

        res.json(backup);
    } catch (error) {
        console.error('Error creating backup:', error);
        res.status(500).json({ error: 'Failed to create backup' });
    }
});

app.post('/api/admin/backup/apply', authenticateToken, async (req, res) => {
    try {
        const isAdminUser = await isAdmin(req.user.username);
        if (!isAdminUser) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const backupData = req.body;
        const { client } = require('./index.js');
        const guild = client.guilds.cache.get(config.bot.guildId);
        
        if (!guild) {
            return res.status(404).json({ error: 'Server not found' });
        }

        // Store old to new ID mappings
        const idMappings = {
            roles: {},
            channels: {},
            emojis: {}
        };

        // Apply backup data
        if (backupData.server) {
            await guild.edit({
                name: backupData.server.name,
                description: backupData.server.description,
                verificationLevel: backupData.server.verificationLevel,
                explicitContentFilter: backupData.server.explicitContentFilter,
                defaultMessageNotifications: backupData.server.defaultMessageNotifications
            });
        }

        if (backupData.roles) {
            // Create roles that don't exist
            for (const roleData of backupData.roles) {
                if (!guild.roles.cache.has(roleData.id)) {
                    const newRole = await guild.roles.create({
                        name: roleData.name,
                        color: roleData.color,
                        hoist: roleData.hoist,
                        position: roleData.position,
                        permissions: roleData.permissions,
                        mentionable: roleData.mentionable
                    });
                    
                    // Store the mapping from old ID to new ID
                    idMappings.roles[roleData.id] = newRole.id;
                } else {
                    // Role already exists, map to existing ID
                    idMappings.roles[roleData.id] = roleData.id;
                }
            }
        }

        if (backupData.channels) {
            // Create channels that don't exist
            for (const channelData of backupData.channels) {
                if (!guild.channels.cache.has(channelData.id)) {
                    const channelOptions = {
                        name: channelData.name,
                        type: channelData.type,
                        position: channelData.position,
                        topic: channelData.topic,
                        nsfw: channelData.nsfw,
                        bitrate: channelData.bitrate,
                        userLimit: channelData.userLimit,
                        rateLimitPerUser: channelData.rateLimitPerUser
                    };

                    if (channelData.parentId) {
                        // Map the parent ID to new ID if it exists
                        const newParentId = idMappings.channels[channelData.parentId] || channelData.parentId;
                        channelOptions.parent = newParentId;
                    }

                    const newChannel = await guild.channels.create(channelData.name, channelOptions);
                    
                    // Store the mapping from old ID to new ID
                    idMappings.channels[channelData.id] = newChannel.id;
                } else {
                    // Channel already exists, map to existing ID
                    idMappings.channels[channelData.id] = channelData.id;
                }
            }
        }

        if (backupData.emojis) {
            // Create emojis that don't exist
            for (const emojiData of backupData.emojis) {
                // Check if emoji with same name already exists
                const existingEmoji = guild.emojis.cache.find(e => e.name === emojiData.name);
                
                if (!existingEmoji) {
                    try {
                        // Download emoji image
                        const emojiResponse = await axios.get(emojiData.url, { responseType: 'arraybuffer' });
                        const emojiBuffer = Buffer.from(emojiResponse.data);
                        
                        // Create new emoji
                        const newEmoji = await guild.emojis.create(emojiBuffer, emojiData.name);
                        
                        // Store the mapping from old ID to new ID
                        idMappings.emojis[emojiData.id] = newEmoji.id;
                    } catch (error) {
                        console.error(`Failed to create emoji ${emojiData.name}:`, error);
                        // If emoji creation fails, we'll skip it but continue with the backup
                    }
                } else {
                    // Emoji already exists, map to existing ID
                    idMappings.emojis[emojiData.id] = existingEmoji.id;
                }
            }
        }

        // Update config.json with new IDs
        await updateConfigWithNewIds(idMappings, backupData);

        // Update saved embeds with new emoji IDs
        await updateEmbedsWithNewEmojiIds(idMappings.emojis);

        res.json({ 
            success: true,
            message: 'Backup applied successfully',
            idMappings: idMappings
        });
    } catch (error) {
        console.error('Error applying backup:', error);
        res.status(500).json({ error: 'Failed to apply backup' });
    }
});

// Function to update saved embeds with new emoji IDs
async function updateEmbedsWithNewEmojiIds(emojiMappings) {
    try {
        const embedsFile = path.join(__dirname, 'data', 'embeds', 'saved-embeds.json');
        
        // Check if embeds file exists
        try {
            await fs.access(embedsFile);
        } catch (error) {
            // File doesn't exist, nothing to update
            return;
        }

        const content = await fs.readFile(embedsFile, 'utf8');
        let embeds = JSON.parse(content);
        let updated = false;

        // Update each embed
        embeds.forEach(embed => {
            if (embed.title) {
                embed.title = updateEmojiIdsInText(embed.title, emojiMappings);
            }
            if (embed.description) {
                embed.description = updateEmojiIdsInText(embed.description, emojiMappings);
            }
            if (embed.footer) {
                embed.footer = updateEmojiIdsInText(embed.footer, emojiMappings);
            }
            if (embed.fields) {
                embed.fields.forEach(field => {
                    if (field.name) {
                        field.name = updateEmojiIdsInText(field.name, emojiMappings);
                    }
                    if (field.value) {
                        field.value = updateEmojiIdsInText(field.value, emojiMappings);
                    }
                });
            }
        });

        // Save updated embeds
        await fs.writeFile(embedsFile, JSON.stringify(embeds, null, 2));
        console.log('✅ Updated saved embeds with new emoji IDs');

    } catch (error) {
        console.error('Error updating embeds with new emoji IDs:', error);
    }
}

// Function to update emoji IDs in text
function updateEmojiIdsInText(text, emojiMappings) {
    if (!text || typeof text !== 'string') return text;

    // Replace emoji IDs in the format <:name:id> or <a:name:id>
    let updatedText = text;
    
    for (const [oldId, newId] of Object.entries(emojiMappings)) {
        // Find the emoji name for this ID (we need to get it from the backup data)
        // For now, we'll use a regex to match emoji patterns
        const emojiRegex = new RegExp(`<a?:([^:]+):${oldId}>`, 'g');
        updatedText = updatedText.replace(emojiRegex, (match, name) => {
            return `<a:${name}:${newId}>`;
        });
    }

    return updatedText;
}

// Function to update config.json with new server IDs
async function updateConfigWithNewIds(idMappings, backupData) {
    try {
        const configPath = path.join(__dirname, 'config.json');
        const configContent = await fs.readFile(configPath, 'utf8');
        let config = JSON.parse(configContent);

        // Update guild ID
        config.bot.guildId = backupData.server.id;

        // Update role IDs in config
        if (backupData.roles && config.roles) {
            // Update main roles
            for (const [oldId, newId] of Object.entries(idMappings.roles)) {
                // Find role by name in backup data
                const roleData = backupData.roles.find(r => r.id === oldId);
                if (roleData) {
                    // Map role names to config properties
                    const roleNameMap = {
                        'reward': 'reward',
                        'member': 'member',
                        'admin': 'admin',
                        'trial': 'trial',
                        'helper': 'helper',
                        'moderator': 'moderator',
                        'pingPermissions': 'pingPermissions',
                        'freeGeneratorAccess': 'freeGeneratorAccess'
                    };

                    // Check if this role name matches any config role
                    for (const [configKey, roleName] of Object.entries(roleNameMap)) {
                        if (roleData.name.toLowerCase().includes(roleName.toLowerCase()) || 
                            roleName.toLowerCase().includes(roleData.name.toLowerCase())) {
                            config.roles[configKey] = newId;
                            break;
                        }
                    }

                    // Update generator roles
                    if (config.roles.generators) {
                        const generatorRoleMap = {
                            'mgen': 'mgen',
                            'bgen': 'bgen',
                            'ogen': 'ogen',
                            'allgens': 'allgens',
                            'vipalt': 'vipalt'
                        };

                        for (const [configKey, roleName] of Object.entries(generatorRoleMap)) {
                            if (roleData.name.toLowerCase().includes(roleName.toLowerCase()) || 
                                roleName.toLowerCase().includes(roleData.name.toLowerCase())) {
                                config.roles.generators[configKey] = newId;
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Update channel IDs in config
        if (backupData.channels && config.channels) {
            for (const [oldId, newId] of Object.entries(idMappings.channels)) {
                // Find channel by name in backup data
                const channelData = backupData.channels.find(c => c.id === oldId);
                if (channelData) {
                    // Map channel names to config properties
                    const channelNameMap = {
                        'greeting': 'greeting',
                        'hits': 'hits',
                        'freeGenerator': 'freeGenerator',
                        'transcripts': 'transcripts',
                        'moderationLogs': 'moderationLogs',
                        'generalLogs': 'generalLogs',
                        'discadiaVoteLogs': 'discadiaVoteLogs',
                        'inviteLog': 'inviteLog',
                        'whitelistLog': 'whitelistLog',
                        'generationLog': 'generationLog',
                        'staffLog': 'staffLog'
                    };

                    // Check if this channel name matches any config channel
                    for (const [configKey, channelName] of Object.entries(channelNameMap)) {
                        if (channelData.name.toLowerCase().includes(channelName.toLowerCase()) || 
                            channelName.toLowerCase().includes(channelData.name.toLowerCase())) {
                            config.channels[configKey] = newId;
                            break;
                        }
                    }

                    // Update chat tracking channels
                    if (config.channels.chatTracking && config.channels.chatTracking.channels) {
                        const chatTrackingIndex = config.channels.chatTracking.channels.indexOf(oldId);
                        if (chatTrackingIndex !== -1) {
                            config.channels.chatTracking.channels[chatTrackingIndex] = newId;
                        }
                    }
                }
            }
        }

        // Save updated config
        await fs.writeFile(configPath, JSON.stringify(config, null, 4));
        console.log('✅ Config.json updated with new server IDs');
        
    } catch (error) {
        console.error('Error updating config.json:', error);
        throw error;
    }
}

app.get('/api/admin/backup/history', authenticateToken, async (req, res) => {
    try {
        const isAdminUser = await isAdmin(req.user.username);
        if (!isAdminUser) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const backupDir = path.join(__dirname, 'backups');
        try {
            await fs.access(backupDir);
        } catch (error) {
            return res.json([]);
        }

        const files = await fs.readdir(backupDir);
        const backups = [];

        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(backupDir, file);
                const content = await fs.readFile(filePath, 'utf8');
                const backup = JSON.parse(content);
                backups.push(backup);
            }
        }

        backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(backups);
    } catch (error) {
        console.error('Error fetching backup history:', error);
        res.status(500).json({ error: 'Failed to fetch backup history' });
    }
});

app.get('/api/admin/roles', authenticateToken, async (req, res) => {
    try {
        const isAdminUser = await isAdmin(req.user.username);
        if (!isAdminUser) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const { client } = require('./index.js');
        const guild = client.guilds.cache.get(config.bot.guildId);
        
        if (!guild) {
            return res.status(404).json({ error: 'Server not found' });
        }

        const roles = guild.roles.cache.map(role => ({
            id: role.id,
            name: role.name,
            color: role.color,
            position: role.position,
            members: role.members.size,
            permissions: role.permissions.toArray()
        }));

        res.json(roles);
    } catch (error) {
        console.error('Error fetching roles:', error);
        res.status(500).json({ error: 'Failed to fetch roles' });
    }
});

app.get('/api/admin/permissions', authenticateToken, async (req, res) => {
    try {
        const isAdminUser = await isAdmin(req.user.username);
        if (!isAdminUser) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const { PermissionsBitField } = require('discord.js');
        const permissions = Object.keys(PermissionsBitField.Flags).map(key => ({
            key,
            name: key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
        }));

        res.json(permissions);
    } catch (error) {
        console.error('Error fetching permissions:', error);
        res.status(500).json({ error: 'Failed to fetch permissions' });
    }
});

app.post('/api/admin/embeds/save', authenticateToken, async (req, res) => {
    try {
        const isAdminUser = await isAdmin(req.user.username);
        if (!isAdminUser) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const embedData = req.body;
        const embedsDir = path.join(__dirname, 'data', 'embeds');
        await fs.mkdir(embedsDir, { recursive: true });
        
        const embedsFile = path.join(embedsDir, 'saved-embeds.json');
        
        let embeds = [];
        try {
            const content = await fs.readFile(embedsFile, 'utf8');
            embeds = JSON.parse(content);
        } catch (error) {
            // File doesn't exist, start with empty array
        }

        const newEmbed = {
            id: Date.now().toString(),
            ...embedData,
            createdAt: new Date().toISOString()
        };

        embeds.push(newEmbed);
        await fs.writeFile(embedsFile, JSON.stringify(embeds, null, 2));

        res.json(newEmbed);
    } catch (error) {
        console.error('Error saving embed:', error);
        res.status(500).json({ error: 'Failed to save embed' });
    }
});

app.get('/api/admin/embeds', authenticateToken, async (req, res) => {
    try {
        const isAdminUser = await isAdmin(req.user.username);
        if (!isAdminUser) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const embedsFile = path.join(__dirname, 'data', 'embeds', 'saved-embeds.json');
        
        try {
            const content = await fs.readFile(embedsFile, 'utf8');
            const embeds = JSON.parse(content);
            res.json(embeds);
        } catch (error) {
            res.json([]);
        }
    } catch (error) {
        console.error('Error fetching embeds:', error);
        res.status(500).json({ error: 'Failed to fetch embeds' });
    }
});

app.post('/api/admin/emojis/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        const isAdminUser = await isAdmin(req.user.username);
        if (!isAdminUser) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const { name } = req.body;
        const file = req.file;

        if (!name || !file) {
            return res.status(400).json({ error: 'Name and file are required' });
        }

        const { client } = require('./index.js');
        const guild = client.guilds.cache.get(config.bot.guildId);
        
        if (!guild) {
            return res.status(404).json({ error: 'Server not found' });
        }

        // Create emoji
        const emoji = await guild.emojis.create(file.buffer, name);

        res.json({
            id: emoji.id,
            name: emoji.name,
            url: emoji.url,
            animated: emoji.animated
        });
    } catch (error) {
        console.error('Error uploading emoji:', error);
        res.status(500).json({ error: 'Failed to upload emoji' });
    }
});

app.get('/api/admin/emojis', authenticateToken, async (req, res) => {
    try {
        const isAdminUser = await isAdmin(req.user.username);
        if (!isAdminUser) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const { client } = require('./index.js');
        const guild = client.guilds.cache.get(config.bot.guildId);
        
        if (!guild) {
            return res.status(404).json({ error: 'Server not found' });
        }

        const emojis = guild.emojis.cache.map(emoji => ({
            id: emoji.id,
            name: emoji.name,
            url: emoji.url,
            animated: emoji.animated,
            managed: emoji.managed,
            requireColons: emoji.requireColons,
            roles: emoji.roles.cache.map(role => role.id)
        }));

        res.json(emojis);
    } catch (error) {
        console.error('Error fetching emojis:', error);
        res.status(500).json({ error: 'Failed to fetch emojis' });
    }
});

app.get('/api/admin/config-structure', authenticateToken, async (req, res) => {
    try {
        const isAdminUser = await isAdmin(req.user.username);
        if (!isAdminUser) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const configPath = path.join(__dirname, 'config.json');
        const configContent = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configContent);

        // Structure the config for the dashboard
        const structuredConfig = {
            server: {
                guildId: config.bot.guildId,
                ownerId: config.bot.ownerId
            },
            roles: {
                main: {
                    reward: config.roles.reward,
                    member: config.roles.member,
                    admin: config.roles.admin,
                    trial: config.roles.trial,
                    helper: config.roles.helper,
                    moderator: config.roles.moderator,
                    pingPermissions: config.roles.pingPermissions,
                    freeGeneratorAccess: config.roles.freeGeneratorAccess
                },
                generators: config.roles.generators
            },
            channels: {
                main: {
                    greeting: config.channels.greeting,
                    hits: config.channels.hits,
                    freeGenerator: config.channels.freeGenerator,
                    transcripts: config.channels.transcripts,
                    moderationLogs: config.channels.moderationLogs,
                    generalLogs: config.channels.generalLogs,
                    discadiaVoteLogs: config.channels.discadiaVoteLogs,
                    inviteLog: config.channels.inviteLog,
                    whitelistLog: config.channels.whitelistLog,
                    generationLog: config.channels.generationLog,
                    staffLog: config.channels.staffLog
                },
                chatTracking: config.channels.chatTracking
            }
        };

        res.json(structuredConfig);
    } catch (error) {
        console.error('Error fetching config structure:', error);
        res.status(500).json({ error: 'Failed to fetch config structure' });
    }
});

app.post('/api/admin/update-config', authenticateToken, async (req, res) => {
    try {
        const isAdminUser = await isAdmin(req.user.username);
        if (!isAdminUser) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const configData = req.body;
        const configPath = path.join(__dirname, 'config.json');
        const configContent = await fs.readFile(configPath, 'utf8');
        let config = JSON.parse(configContent);

        // Update server settings
        if (configData.server) {
            config.bot.guildId = configData.server.guildId;
            config.bot.ownerId = configData.server.ownerId;
        }

        // Update roles
        if (configData.roles) {
            if (configData.roles.main) {
                Object.assign(config.roles, configData.roles.main);
            }
            if (configData.roles.generators) {
                config.roles.generators = configData.roles.generators;
            }
        }

        // Update channels
        if (configData.channels) {
            if (configData.channels.main) {
                Object.assign(config.channels, configData.channels.main);
            }
            if (configData.channels.chatTracking) {
                config.channels.chatTracking = configData.channels.chatTracking;
            }
        }

        await fs.writeFile(configPath, JSON.stringify(config, null, 4));
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating config:', error);
        res.status(500).json({ error: 'Failed to update config' });
    }
});

// Start server function
function startServer() {
    return new Promise((resolve, reject) => {
        const server = app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            resolve(server);
        });
        
        server.on('error', (error) => {
            console.error('Server error:', error);
            reject(error);
        });
    });
}

module.exports = { startServer };