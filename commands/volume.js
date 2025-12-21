const { createEmbed } = require('../utils/embed');

async function execute(message) {
  return message.channel.send({
    embeds: [
      createEmbed()
        .setTitle('🔇 Controle de Volume')
        .setDescription('❌ O controle de volume foi removido. O bot opera no volume padrão.')
    ]
  }).catch(() => {});
}

module.exports = {
  name: 'volume',
  aliases: ['vol', 'v'],
  description: 'Controle de volume (atualmente desativado)',
  usage: '#volume',
  execute
};
