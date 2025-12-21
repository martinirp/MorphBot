// ===============================================
// 🚫 EVITAR MULTI INSTÂNCIAS
// ===============================================
if (global.botInstance) {
  console.log('🔄 Limpando instância anterior do bot...');
  try {
    if (client?.destroy) client.destroy();
  } catch {}
}
global.botInstance = true;

// ===============================================
// 🌱 ENV
// ===============================================
require('dotenv').config();

// ===============================================
// 🤖 IMPORTS
// ===============================================
const { Client, Collection, GatewayIntentBits, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

const db = require('./utils/db');
const cachePath = require('./utils/cachePath');
const queueManager = require('./utils/queueManager');
const { createEmbed } = require('./utils/embed');
const { removeSongCompletely } = require('./utils/removeSong');

// ===============================================
// 💬 Último canal de texto por guild
// ===============================================
const lastTextChannel = new Map();

// ===============================================
// 🔒 Guilds em reset (lock anti race-condition)
// ===============================================
const resettingGuilds = new Set();

// ===============================================
// 🔧 Client
// ===============================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const PREFIXES = ['#', '$', '%', '&', '/'];
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('❌ Token não encontrado.');
  process.exit(1);
}

// ===============================================
// 🧩 Comandos
// ===============================================
client.commands = new Collection();
const commandPath = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(commandPath).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandPath, file));
  if (!command.name) continue;

  client.commands.set(command.name, command);
  if (Array.isArray(command.aliases)) {
    for (const alias of command.aliases) {
      client.commands.set(alias, command);
    }
  }
}

console.log(`✅ Comandos carregados: ${client.commands.size}`);

// ===============================================
// 🤖 READY
// ===============================================
client.once(Events.ClientReady, c => {
  console.log(`✅ Bot online como ${c.user.tag}`);
});

// ===============================================
// 💬 PREFIXOS
// ===============================================
client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;

  lastTextChannel.set(message.guild.id, message.channel);

  const prefix = PREFIXES.find(p => message.content.startsWith(p));
  if (!prefix) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/g);
  const commandName = args.shift().toLowerCase();
  const command = client.commands.get(commandName);
  if (!command) return;

  try {
    if (resettingGuilds.has(message.guild.id)) {
      return message.reply('⏳ Bot está se reorganizando, tente novamente em alguns segundos.');
    }

    console.log(`🔧 Executando comando: ${prefix}${commandName}`, args);
    await command.execute(message, client, args);
  } catch (err) {
    console.error(`❌ Erro no comando "${commandName}":`, err);
    message.channel.send('❌ Erro ao executar comando.');
  }
});

// ===============================================
// 🎮 INTERACTIONS
// ===============================================
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton() && interaction.customId === 'lib_search') {
      return interaction.showModal({
        title: 'Buscar música',
        custom_id: 'lib_search_modal',
        components: [{
          type: 1,
          components: [{
            type: 4,
            custom_id: 'query',
            label: 'Nome da música',
            style: 1,
            required: true
          }]
        }]
      });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'lib_search_modal') {
      const query = interaction.fields.getTextInputValue('query');
      const results = db.searchSongs(query);

      if (!results.length) {
        return interaction.reply({ content: '❌ Nenhuma música encontrada.', ephemeral: true });
      }

      const song = results[0];

      return interaction.reply({
        embeds: [{
          title: '🎵 Música encontrada',
          description: `**${song.title}**`,
          fields: [
            { name: 'VideoId', value: song.videoId },
            { name: 'Arquivo', value: fs.existsSync(song.file) ? '✅ Cache OK' : '❌ Não existe' }
          ],
          color: 0x5865F2
        }],
        components: [{
          type: 1,
          components: [
            { type: 2, style: 1, label: 'Tocar', emoji: '▶️', custom_id: `lib_play_${song.videoId}` },
            { type: 2, style: 4, label: 'Excluir', emoji: '❌', custom_id: `lib_delete_${song.videoId}` }
          ]
        }]
      });
    }

    if (interaction.isButton() && interaction.customId.startsWith('lib_play_')) {
      const videoId = interaction.customId.replace('lib_play_', '');
      const song = db.getByVideoId(videoId);

      if (!song || !fs.existsSync(song.file)) {
        return interaction.reply({ content: '❌ Cache não encontrado.', ephemeral: true });
      }

      const vc = interaction.member.voice.channel;
      if (!vc) {
        return interaction.reply({ content: '❌ Entre em um canal de voz.', ephemeral: true });
      }

      if (resettingGuilds.has(interaction.guild.id)) {
        return interaction.reply({ content: '⏳ Bot está se reorganizando.', ephemeral: true });
      }

      await interaction.reply({ content: '▶️ Tocando do cache...', ephemeral: true });

      return queueManager.play(
        interaction.guild.id,
        vc,
        { videoId: song.videoId, title: song.title, file: song.file },
        interaction.channel
      );
    }

    if (interaction.isButton() && interaction.customId.startsWith('lib_delete_')) {
      const videoId = interaction.customId.replace('lib_delete_', '');
      const ok = removeSongCompletely(videoId);

      return interaction.reply({
        content: ok
          ? '❌ Música removida completamente (cache + banco).'
          : '❌ Música não encontrada.',
        ephemeral: true
      });
    }

  } catch (e) {
    console.error('❌ Erro em InteractionCreate:', e);
    if (!interaction.replied) {
      interaction.reply({ content: '❌ Erro interno.', ephemeral: true });
    }
  }
});

// ===============================================
// 🔊 VOICE STATE (MUTE / UNMUTE / KICK)
// ===============================================
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const guildId = oldState.guild.id;

    // ============================================
    // 👤 Alguém saiu do canal → verificar se bot ficou sozinho
    // ============================================
    if (oldState.channelId && !newState.channelId && oldState.member?.id !== client.user.id) {
      const botVoiceState = oldState.guild.members.me?.voice;
      if (botVoiceState?.channelId === oldState.channelId) {
        setTimeout(() => queueManager.checkIfAlone(guildId), 1000);
      }
    }

    // ============================================
    // 🤖 Eventos do próprio bot
    // ============================================
    if (oldState.member?.id !== client.user.id) return;

    const wasMuted = oldState.serverMute || oldState.selfMute;
    const isMuted = newState.serverMute || newState.selfMute;

    if (!wasMuted && isMuted) {
      queueManager.pause(guildId);

      const textChannel = lastTextChannel.get(guildId);
      if (textChannel) {
        await textChannel.send({
          embeds: [
            createEmbed()
              .setTitle('😔 Fui mutado')
              .setDescription('Alguém me mutou...\nAposto que foi o **PITUBA**.')
          ]
        }).catch(() => {});
      }
      return;
    }

    if (wasMuted && !isMuted) {
      queueManager.resume(guildId);
      return;
    }

    const botKicked = oldState.channelId && !newState.channelId;
    if (!botKicked) return;

    // Verificar se foi auto-disconnect
    if (queueManager.selfDisconnecting.has(guildId)) {
      return; // Não mostrar mensagem de kick
    }

    resettingGuilds.add(guildId);

    const textChannel = lastTextChannel.get(guildId);
    if (textChannel) {
      await textChannel.send({
        embeds: [
          createEmbed()
            .setTitle('😔 Fui kickado')
            .setDescription('Aposto que foi o **PITUBA**.')
        ]
      }).catch(() => {});
    }

    queueManager.resetGuild(guildId);

    setTimeout(() => resettingGuilds.delete(guildId), 1000);

  } catch (e) {
    console.error('⚠️ Erro em VoiceStateUpdate:', e);
    if (oldState.guild) resettingGuilds.delete(oldState.guild.id);
  }
});

// ===============================================
// 🚀 LOGIN
// ===============================================
client.login(token);
