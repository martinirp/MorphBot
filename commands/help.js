const { createEmbed } = require('../utils/embed');

async function execute(message, client) {
  // Colete comandos atuais do client (já inclui aliases); filtramos por nome único
  const unique = new Map();
  for (const cmd of client.commands.values()) {
    if (!cmd?.name) continue;
    if (!unique.has(cmd.name)) unique.set(cmd.name, cmd);
  }

  // Monta linhas com apenas nome + descrição (instrução), conforme solicitado
  const rows = Array.from(unique.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(cmd => {
      const desc = cmd.description || 'Sem descrição';
      return `\`${cmd.name}\` — ${desc}`;
    });

  // Quebra em campos para respeitar limite de caracteres
  const embed = createEmbed()
    .setTitle('📖 Comandos Disponíveis')
    .setDescription('Use os prefixos: `#` `$` `%` `&` `/`');

  const chunkSize = 8; // mais compacta: 8 por campo
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    embed.addFields({
      name: `Comandos (${i + 1}-${Math.min(i + chunkSize, rows.length)})`,
      value: chunk.join('\n\n'),
      inline: false
    });
  }

  embed.setFooter({ text: `Total: ${unique.size} comandos` });

  return message.channel.send({ embeds: [embed] });
}

module.exports = {
  name: 'help',
  aliases: ['ajuda', 'comandos', 'h'],
  description: 'Mostra todos os comandos disponíveis',
  usage: '#help',
  execute
};
