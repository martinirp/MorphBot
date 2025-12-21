const { createEmbed } = require('../utils/embed');
const queueManager = require('../utils/queueManager');

async function execute(message) {
  const guildId = message.guild.id;
  const textChannel = message.channel;

  const player = queueManager.getPlayer(guildId);

  // validação simples e segura
  if (!player) {
    return textChannel.send({
      embeds: [
        createEmbed()
          .setDescription('❌ Não há música tocando no momento.')
      ]
    });
  }

  // título ANTES do skip (se existir)
  const g = queueManager.guilds.get(guildId);
  const skippedTitle = g?.current?.title;

  // 🔥 delega totalmente ao QueueManager
  queueManager.skip(guildId);

  return textChannel.send({
    embeds: [
      createEmbed().setDescription(
        skippedTitle
          ? `⏭️ Música pulada: **${skippedTitle}**`
          : '⏭️ Música pulada.'
      )
    ]
  });
}

module.exports = {
  name: 'skip',
  aliases: ['s', 'pular'],
  description: 'Pula a música atual e toca a próxima da fila',
  usage: '#skip',
  execute
};

