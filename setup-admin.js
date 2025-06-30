const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const path = require('path');

async function setupAdmin() {
    console.log('🔧 Setting up Admin Dashboard...\n');
    
    try {
        // Create admin data directory if it doesn't exist
        const adminDataDir = path.join(__dirname, 'utils', 'data');
        await fs.mkdir(adminDataDir, { recursive: true });
        
        const adminsFile = path.join(adminDataDir, 'admins.json');
        
        // Check if admins file exists
        let admins = [];
        try {
            const content = await fs.readFile(adminsFile, 'utf8');
            admins = JSON.parse(content);
        } catch (error) {
            // File doesn't exist, start with empty array
        }
        
        // Check if admin already exists
        const existingAdmin = admins.find(admin => admin.username === 'admin');
        
        if (existingAdmin) {
            console.log('⚠️  Admin user already exists!');
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            const answer = await new Promise(resolve => {
                rl.question('Do you want to reset the admin password? (y/n): ', resolve);
            });
            rl.close();
            
            if (answer.toLowerCase() === 'y') {
                const password = await new Promise(resolve => {
                    const rl2 = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    });
                    rl2.question('Enter new admin password: ', (pass) => {
                        rl2.close();
                        resolve(pass);
                    });
                });
                
                const hashedPassword = await bcrypt.hash(password, 10);
                existingAdmin.password = hashedPassword;
                
                await fs.writeFile(adminsFile, JSON.stringify(admins, null, 2));
                console.log('✅ Admin password updated successfully!');
            } else {
                console.log('❌ Setup cancelled.');
            }
        } else {
            // Create new admin user
            const password = await new Promise(resolve => {
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                rl.question('Enter admin password: ', (pass) => {
                    rl.close();
                    resolve(pass);
                });
            });
            
            const hashedPassword = await bcrypt.hash(password, 10);
            
            const newAdmin = {
                username: 'admin',
                password: hashedPassword,
                role: 'admin',
                createdAt: new Date().toISOString()
            };
            
            admins.push(newAdmin);
            await fs.writeFile(adminsFile, JSON.stringify(admins, null, 2));
            
            console.log('✅ Admin user created successfully!');
            console.log('📋 Login credentials:');
            console.log('   Username: admin');
            console.log('   Password: [the password you entered]');
        }
        
        // Create necessary directories
        const directories = [
            'backups',
            'data/embeds',
            'logs'
        ];
        
        for (const dir of directories) {
            await fs.mkdir(path.join(__dirname, dir), { recursive: true });
            console.log(`📁 Created directory: ${dir}`);
        }
        
        console.log('\n🎉 Admin Dashboard setup completed!');
        console.log('🌐 Access the dashboard at: http://localhost:4129/admin-dashboard.html');
        console.log('🔐 Use the admin credentials to log in');
        
    } catch (error) {
        console.error('❌ Setup failed:', error);
        process.exit(1);
    }
}

// Run setup if this file is executed directly
if (require.main === module) {
    setupAdmin();
}

module.exports = { setupAdmin }; 