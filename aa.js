const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Testa login
client.once('ready', () => {
  console.log(`✅ Token válido! Bot logado como: ${client.user.tag}`);
  client.destroy(); // Encerra o bot após teste
});

client.on('error', error => {
  console.error('❌ Erro no cliente:', error);
});

client.login('MTI4Mjg4NTI3OTQ5NzE5NTU5Mw.G3H8A8.zA3PbD4-N8dYAEfRBr6Ck8KOodAREIwAH_5fB0').catch(err => {
  console.error('❌ Token inválido ou falha no login:', err.message);
});
