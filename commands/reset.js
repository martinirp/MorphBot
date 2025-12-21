const path = require('path');
const { spawn } = require('child_process');
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
          .setDescription('Encerrando conexões e reiniciando...')
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

      await statusMsg.edit({
        embeds: [
          createEmbed()
            .setColor(0x2ecc71)
            .setTitle('🔄 Reiniciando')
            .setDescription('Saindo agora, voltarei em instantes...')
        ]
      });

      const startJsPath = path.join(__dirname, '..', 'start.js');

      // Se foi iniciado pelo start.js, basta encerrar que ele reinicia.
      if (process.env.__MORPHBOT_STARTER === '1') {
        process.exit(0);
        return;
      }

      // Caso contrário, iniciar o start.js de forma destacada e encerrar.
      const child = spawn(process.execPath, [startJsPath], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      process.exit(0);
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
