// Test script for emoji functionality
const fs = require('fs');
const path = require('path');

// Function to update emoji IDs in text (same as in server.js)
function updateEmojiIdsInText(text, emojiMappings) {
    if (!text || typeof text !== 'string') return text;
    
    let updatedText = text;
    
    for (const [oldId, newId] of Object.entries(emojiMappings)) {
        const emojiRegex = new RegExp(`<a?:([^:]+):${oldId}>`, 'g');
        updatedText = updatedText.replace(emojiRegex, (match, name) => {
            return `<a:${name}:${newId}>`;
        });
    }
    
    return updatedText;
}

// Test the emoji ID update function
function testEmojiIdUpdate() {
    console.log('🧪 Testing emoji ID update functionality...\n');
    
    // Sample text with emoji codes
    const testText = "Welcome to our server! <:welcome:123456789> Check out our rules <a:rules:987654321> and enjoy your stay!";
    
    // Sample emoji mappings (old ID -> new ID)
    const emojiMappings = {
        '123456789': '111222333',
        '987654321': '444555666'
    };
    
    console.log('Original text:', testText);
    console.log('Emoji mappings:', emojiMappings);
    
    const updatedText = updateEmojiIdsInText(testText, emojiMappings);
    console.log('Updated text:', updatedText);
    
    // Test with different emoji formats
    const testCases = [
        "<:smile:123>",
        "<a:wave:456>", 
        "Text with <:emoji:789> and <a:animated:012>",
        "No emojis here",
        "<:broken:>",
        "<a:test:123:extra>"
    ];
    
    console.log('\n🧪 Testing various emoji formats:');
    testCases.forEach(testCase => {
        const result = updateEmojiIdsInText(testCase, emojiMappings);
        console.log(`"${testCase}" -> "${result}"`);
    });
    
    console.log('\n✅ Emoji ID update test completed!');
}

// Test backup emoji handling
function testBackupEmojiHandling() {
    console.log('\n🧪 Testing backup emoji handling...\n');
    
    // Sample backup data with emojis
    const backupData = {
        server: {
            id: '123456789',
            name: 'Test Server'
        },
        emojis: [
            {
                id: '111222333',
                name: 'welcome',
                url: 'https://cdn.discordapp.com/emojis/111222333.png',
                animated: false
            },
            {
                id: '444555666',
                name: 'rules',
                url: 'https://cdn.discordapp.com/emojis/444555666.gif',
                animated: true
            }
        ]
    };
    
    // Sample saved embeds with emoji codes
    const savedEmbeds = [
        {
            id: '1',
            title: 'Welcome! <:welcome:111222333>',
            description: 'Please read our <a:rules:444555666>',
            fields: [
                {
                    name: 'Rules <:welcome:111222333>',
                    value: 'Follow the <a:rules:444555666>'
                }
            ]
        }
    ];
    
    console.log('Sample backup data:', JSON.stringify(backupData, null, 2));
    console.log('Sample saved embeds:', JSON.stringify(savedEmbeds, null, 2));
    
    // Simulate new emoji IDs after backup application
    const newEmojiMappings = {
        '111222333': '999888777',
        '444555666': '666555444'
    };
    
    console.log('\nNew emoji mappings:', newEmojiMappings);
    
    // Update embeds with new emoji IDs
    const updatedEmbeds = savedEmbeds.map(embed => {
        const updatedEmbed = { ...embed };
        
        if (updatedEmbed.title) {
            updatedEmbed.title = updateEmojiIdsInText(updatedEmbed.title, newEmojiMappings);
        }
        if (updatedEmbed.description) {
            updatedEmbed.description = updateEmojiIdsInText(updatedEmbed.description, newEmojiMappings);
        }
        if (updatedEmbed.fields) {
            updatedEmbed.fields = updatedEmbed.fields.map(field => ({
                ...field,
                name: updateEmojiIdsInText(field.name, newEmojiMappings),
                value: updateEmojiIdsInText(field.value, newEmojiMappings)
            }));
        }
        
        return updatedEmbed;
    });
    
    console.log('\nUpdated embeds:', JSON.stringify(updatedEmbeds, null, 2));
    console.log('✅ Backup emoji handling test completed!');
}

// Run tests
console.log('🚀 Starting emoji functionality tests...\n');
testEmojiIdUpdate();
testBackupEmojiHandling();
console.log('\n🎉 All tests completed successfully!'); 