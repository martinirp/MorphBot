const fs = require('fs');
const path = require('path');
const { createEmbed } = require('../utils/embed');
const db = require('../utils/db');
const queueManager = require('../utils/queueManager');
const cachePath = require('../utils/cachePath');

const ITEMS_PER_PAGE = 12;
const MAX_CHARS = 3800;

module.exports = {
  name: 'lib',
  aliases: ['library', 'biblioteca'],
  description: 'Mostra todas as músicas disponíveis no cache local',
  usage: '#lib',

  async execute(message) {
    const textChannel = message.channel;
    const client = message.client;

    const songs = db.getAllSongs();

    if (!songs.length) {
      return textChannel.send({
        embeds: [createEmbed().setDescription('📭 Biblioteca vazia.')]
      });
    }

    // ======================================================
    // 📚 MENSAGEM 1 — LISTA DA BIBLIOTECA (INALTERADA)
    // ======================================================
    const pages = [];
    let buffer = [];
    let length = 0;

    songs.forEach((song, index) => {
      const artist = song.artist || 'Desconhecido';
      const line =
        `**${index + 1}.** ${song.title}\n` +
        `*${artist}*\n\n`;

      if (
        buffer.length >= ITEMS_PER_PAGE ||
        length + line.length > MAX_CHARS
      ) {
        pages.push(buffer);
        buffer = [];
        length = 0;
      }

      buffer.push(line);
      length += line.length;
    });

    if (buffer.length) pages.push(buffer);

    let page = 0;

    const buildEmbed = () =>
      createEmbed()
        .setTitle('📚 Biblioteca de Músicas')
        .setDescription(pages[page].join(''))
        .setFooter({
          text: `Página ${page + 1} de ${pages.length} • ${songs.length} músicas`
        });

    const libMsg = await textChannel.send({
      embeds: [buildEmbed()],
      components: pages.length > 1
        ? [{
            type: 1,
            components: [
              { type: 2, style: 2, emoji: '⬅️', custom_id: 'lib_prev' },
              { type: 2, style: 2, emoji: '➡️', custom_id: 'lib_next' }
            ]
          }]
        : []
    });

    if (pages.length > 1) {
      const collector = libMsg.createMessageComponentCollector({
        time: 10 * 60 * 1000
      });

      collector.on('collect', async interaction => {
        if (interaction.user.id !== message.author.id) {
          return interaction.reply({
            content: '❌ Apenas quem executou o comando pode navegar.',
            ephemeral: true
          });
        }

        if (interaction.customId === 'lib_prev') {
          page = page === 0 ? pages.length - 1 : page - 1;
        }

        if (interaction.customId === 'lib_next') {
          page = (page + 1) % pages.length;
        }

        await interaction.update({ embeds: [buildEmbed()] });
      });

      collector.on('end', async () => {
        try { await libMsg.edit({ components: [] }); } catch {}
      });
    }

    // ======================================================
    // 🔍 MENSAGEM 2 — GERENCIAMENTO MANUAL
    // ======================================================
    await textChannel.send({
      embeds: [
        createEmbed()
          .setTitle('🔍 Gerenciar Biblioteca')
          .setDescription(
            'Use **Buscar** para localizar uma música específica.\n' +
            'Você pode **▶️ tocar direto do cache** ou **❌ excluir completamente**.'
          )
      ],
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 1,
          label: 'Buscar',
          emoji: '🔍',
          custom_id: 'lib_search'
        }]
      }]
    });

    // ======================================================
    // ⚠️ IMPORTANTE
    // Interações do lib são tratadas NO INDEX.JS
    // Não registre interactionCreate aqui
    // ======================================================
  }
};
