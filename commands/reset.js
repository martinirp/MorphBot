const { PermissionsBitField } = require('discord.js');
const queueManager = require('../utils/queueManager');
const { createEmbed } = require('../utils/embed');

module.exports = {
  name: 'reset',
  aliases: ['restart', 'reboot', 'rt'],
  description: 'Reinicia o bot: encerra tudo e executa novamente o start.js',
  permission: 'ADMINISTRATOR',

  async execute(message, client) {
    // Permissão de administrador
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.channel.send({
        embeds: [
          createEmbed()
            .setColor(0xe74c3c)
            .setTitle('❌ Permissão negada')
            .setDescription('Você não tem permissão para usar este comando.')
        ]
      });
    }

    const statusMsg = await message.channel.send({
      embeds: [
        createEmbed()
          .setColor(0xf1c40f)
          .setTitle('🔄 Reiniciando bot')
          .setDescription('Encerrando conexões...')
      ]
    });

    try {
      // Desconectar de todos os guilds de forma silenciosa
      if (queueManager && queueManager.guilds) {
        for (const [guildId] of queueManager.guilds) {
          queueManager.selfDisconnecting.add(guildId);
          queueManager.resetGuild(guildId, { preserveSelfFlag: true });
        }
      }

      // Dar um tempo para desconectar
      await new Promise(resolve => setTimeout(resolve, 1000));

      await statusMsg.edit({
        embeds: [
          createEmbed()
            .setColor(0x2ecc71)
            .setTitle('🔄 Reiniciando')
            .setDescription('Voltando em segundos... 🚀')
        ]
      });

      // Fechar cliente Discord e encerrar processo
      // O hosting (Replit, Railway, etc) detectará o crash e reiniciará
      console.log('[RESET] Encerrando processo para reinicialização...');
      
      try {
        await client.destroy();
      } catch {}

      // Exit com code 1 força o hosting a reiniciar
      process.exit(1);
    } catch (error) {
      console.error('[RESET] erro:', error);
      await statusMsg.edit({
        embeds: [
          createEmbed()
            .setColor(0xe74c3c)
            .setTitle('❌ Erro ao reiniciar')
            .setDescription(error?.message || String(error))
        ]
      });
    }
  }
};
