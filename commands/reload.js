const fs = require('fs');
const path = require('path');
const { EmbedBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  name: 'reload',
  aliases: ['rl'],
  description: 'Recarrega todos os comandos e utilitários',
  permission: 'ADMINISTRATOR',

  async execute(message, client) {
    // =====================
    // 🔐 PERMISSÃO
    // =====================
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ Permissão negada')
            .setDescription('Você não tem permissão para usar este comando.')
        ]
      });
    }

    // =====================
    // 🔄 STATUS INICIAL
    // =====================
    const statusMsg = await message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('🔄 Recarregando...')
          .setDescription('Recarregando comandos e utilitários...')
      ]
    });

    try {
      // =====================
      // 🔥 RECARREGAR COMANDOS
      // =====================
      const commandsPath = path.join(__dirname);
      const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

      const newCommands = new Map();
      let commandsLoaded = 0;
      let commandsErrors = 0;

      for (const file of commandFiles) {
        try {
          const filePath = path.join(commandsPath, file);

          delete require.cache[require.resolve(filePath)];
          const command = require(filePath);

          if (!command.name || typeof command.execute !== 'function') {
            throw new Error('Estrutura inválida');
          }

          newCommands.set(command.name, command);

          if (Array.isArray(command.aliases)) {
            for (const alias of command.aliases) {
              newCommands.set(alias, command);
            }
          }

          commandsLoaded++;
        } catch (err) {
          console.error(`[RELOAD] erro no comando ${file}:`, err.message);
          commandsErrors++;
        }
      }

      client.commands = newCommands;

      // =====================
      // 🔧 RECARREGAR UTILS
      // =====================
      const utilsPath = path.join(__dirname, '../utils');
      const utilFiles = fs.readdirSync(utilsPath).filter(f => f.endsWith('.js'));

      let utilsLoaded = 0;
      let utilsErrors = 0;

      for (const file of utilFiles) {
        try {
          const filePath = path.join(utilsPath, file);
          delete require.cache[require.resolve(filePath)];
          require(filePath);
          utilsLoaded++;
        } catch (err) {
          console.error(`[RELOAD] erro no util ${file}:`, err.message);
          utilsErrors++;
        }
      }

      // =====================
      // 📊 RESULTADO
      // =====================
      const resultEmbed = new EmbedBuilder()
        .setColor(commandsErrors || utilsErrors ? 0xe67e22 : 0x2ecc71)
        .setTitle('✅ Reload concluído')
        .addFields(
          {
            name: '📥 Comandos',
            value: `Carregados: **${commandsLoaded}**\nErros: **${commandsErrors}**`,
            inline: true
          },
          {
            name: '🔧 Utilitários',
            value: `Carregados: **${utilsLoaded}**\nErros: **${utilsErrors}**`,
            inline: true
          },
          {
            name: '📊 Total registrado',
            value: `**${client.commands.size}** entradas`,
            inline: false
          }
        )
        .setTimestamp();

      await statusMsg.edit({ embeds: [resultEmbed] });

    } catch (error) {
      console.error('[RELOAD] erro geral:', error);

      await statusMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('❌ Erro no reload')
            .setDescription(error.message)
        ]
      });
    }
  }
};

