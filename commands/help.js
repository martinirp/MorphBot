const { createEmbed } = require('../utils/embed');

async function execute(message, client) {
  const commands = Array.from(client.commands.values());
  
  // Remover duplicatas (usar Map para garantir unicidade por nome)
  const uniqueCommands = new Map();
  for (const cmd of commands) {
    if (!uniqueCommands.has(cmd.name)) {
      uniqueCommands.set(cmd.name, cmd);
    }
  }

  // Agrupar comandos por categoria
  const categories = {
    '🎵 Reprodução': ['play', 'queue', 'skip', 'clear'],
    '📚 Biblioteca': ['lib', 'mix', 'download'],
    '🛠️ Utilidades': ['stats', 'reload', 'volume', 'help']
  };

  const embed = createEmbed()
    .setTitle('📖 Comandos Disponíveis')
    .setDescription('Use os prefixos: `#` `$` `%` `&` `/`');

  // Adicionar comandos por categoria
  for (const [category, commandNames] of Object.entries(categories)) {
    const categoryCommands = commandNames
      .map(name => uniqueCommands.get(name))
      .filter(cmd => cmd) // Remover undefined
      .map(cmd => {
        const aliases = cmd.aliases && cmd.aliases.length > 0 
          ? ` *(${cmd.aliases.slice(0, 2).join(', ')})*` // Limitar aliases
          : '';
        const description = cmd.description || 'Sem descrição';
        
        return `\`${cmd.name}${aliases}\` - ${description}`;
      });

    if (categoryCommands.length > 0) {
      // Limitar a 1000 caracteres por campo
      const fieldValue = categoryCommands.join('\n');
      
      if (fieldValue.length <= 1024) {
        embed.addFields({
          name: category,
          value: fieldValue,
          inline: false
        });
      } else {
        // Dividir em múltiplos campos se necessário
        const half = Math.ceil(categoryCommands.length / 2);
        embed.addFields(
          {
            name: `${category} (1)`,
            value: categoryCommands.slice(0, half).join('\n'),
            inline: false
          },
          {
            name: `${category} (2)`,
            value: categoryCommands.slice(half).join('\n'),
            inline: false
          }
        );
      }
    }
  }

  embed.setFooter({ 
    text: `Total: ${uniqueCommands.size} comandos` 
  });

  return message.channel.send({ embeds: [embed] });
}

module.exports = {
  name: 'help',
  aliases: ['ajuda', 'comandos', 'h'],
  description: 'Mostra todos os comandos disponíveis organizados por categoria',
  usage: '#help',
  execute
};
