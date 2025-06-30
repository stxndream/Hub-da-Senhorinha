const { validateAdminCredentials, initAdminSystem } = require('./utils/adminService');

async function testAdmin() {
    console.log('🧪 Testing Admin Dashboard Setup...\n');
    
    try {
        // Initialize admin system
        console.log('1. Initializing admin system...');
        await initAdminSystem();
        console.log('✅ Admin system initialized\n');
        
        // Test admin credentials
        console.log('2. Testing admin credentials...');
        const isValid = await validateAdminCredentials('admin', 'admin');
        console.log(`✅ Admin credentials test: ${isValid ? 'PASSED' : 'FAILED'}\n`);
        
        if (isValid) {
            console.log('🎉 Admin Dashboard is ready!');
            console.log('📋 Login credentials:');
            console.log('   Username: admin');
            console.log('   Password: admin');
            console.log('\n🌐 Access the dashboard at: http://localhost:4129/admin-dashboard.html');
        } else {
            console.log('❌ Admin credentials test failed');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

testAdmin(); 