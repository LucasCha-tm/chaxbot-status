const { Client, GatewayIntentBits, EmbedBuilder, Partials, REST, Routes } = require('discord.js');
const axios = require('axios');
const config = require('./config.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences // Ajout des intentions pour vérifier les présences
    ],
    partials: [Partials.Channel],
});

const sitesToCheck = [
    { name: "Panel ChaxBot'Ticket", url: "http://node.serenetia.com:40009", category: "Web" },
    { name: "ChaxBot'Music", id: "1305248707213787166", category: "Bot" },
    { name: "ChaxBot'Ticket", id: "1267544830003904573", category: "Bot" },
    { name: "ChaxBot'Event", id: "1259233794070679705", category: "Bot" },
    { name: "ChaxCube", url: "https://minecraftserver.com", category: "Minecraft" }
];

let statusMessage;
let maintenanceSchedule = [];
let problemReports = [];
let observationPeriods = [];
let notifiedAdmins = new Set();

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    const activities = [
        { name: 'surveiller les sites', type: 'WATCHING' },
        { name: 'la performance du serveur', type: 'LISTENING' }
    ];
    
    let activityIndex = 0;
    setInterval(() => {
        const activity = activities[activityIndex % activities.length];
        client.user.setActivity(activity);
        console.log(`Activity set to: ${activity.name}`);
        activityIndex++;
    }, 60000); // Change activity every 60 seconds

    const channel = client.channels.cache.get(config.channelId);
    if (!channel) {
        console.error("Channel not found");
        return;
    }

    // Create or fetch the initial status message
    try {
        const messages = await channel.messages.fetch({ limit: 10 });
        statusMessage = messages.find(msg => msg.author.id === client.user.id && msg.embeds.length);
        if (!statusMessage) {
            statusMessage = await channel.send({ embeds: [createStatusEmbed()] });
        }
    } catch (error) {
        console.error('Error fetching or creating status message:', error);
    }

    await registerCommands();

    setInterval(checkSitesStatus, 60000); // Check sites every 60 seconds
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'maintenance') {
        const siteName = options.getString('site');
        const time = options.getString('time');
        const reason = options.getString('reason');

        const site = sitesToCheck.find(s => s.name === siteName);
        if (site) {
            maintenanceSchedule.push({ name: siteName, time, reason });
            await interaction.reply(`Maintenance scheduled for ${siteName} at ${time} for the following reason: ${reason}`);
            checkSitesStatus(); // Update the status embed immediately
        } else {
            await interaction.reply(`Site ${siteName} not found.`);
        }
    }

    if (commandName === 'probleme') {
        const siteName = options.getString('site');
        const issue = options.getString('issue');

        problemReports.push({ name: siteName, issue });
        await interaction.reply(`Problème signalé pour ${siteName}: ${issue}`);
        checkSitesStatus();
    }

    if (commandName === 'observation') {
        const siteName = options.getString('site');
        const duration = options.getInteger('duration');

        observationPeriods.push({ name: siteName, endTime: Date.now() + duration * 3600000 });
        await interaction.reply(`${siteName} est en période de surveillance pendant ${duration} heures.`);
        checkSitesStatus();
    }

    if (commandName === 'removeremarque') {
        const siteName = options.getString('site');

        maintenanceSchedule = maintenanceSchedule.filter(m => m.name !== siteName);
        problemReports = problemReports.filter(p => p.name !== siteName);
        observationPeriods = observationPeriods.filter(o => o.name !== siteName);

        await interaction.reply(`Remarque pour ${siteName} supprimée.`);
        checkSitesStatus(); // Update the status embed immediately
    }
});

async function checkSitesStatus() {
    const channel = client.channels.cache.get(config.channelId);
    if (!channel) {
        console.error("Channel not found");
        return;
    }

    try {
        statusMessage = await channel.messages.fetch(statusMessage.id);
    } catch (error) {
        console.error("Status message not found. Creating a new one.");
        statusMessage = await channel.send({ embeds: [createStatusEmbed()] });
    }

    let statusText = '';

    for (const site of sitesToCheck) {
        const maintenance = maintenanceSchedule.find(m => m.name === site.name);
        if (maintenance) {
            statusText += `**${site.name} (Maintenance) 🟠**\n`;
            continue;
        }

        const problem = problemReports.find(p => p.name === site.name);
        if (problem) {
            statusText += `**${site.name} (Problème: ${problem.issue}) ❗**\n`;
            continue;
        }

        const observation = observationPeriods.find(o => o.name === site.name && o.endTime > Date.now());
        if (observation) {
            statusText += `**${site.name} est en période de surveillance pendant encore ${Math.ceil((observation.endTime - Date.now()) / 3600000)} heures 🕒**\n`;
            continue;
        }

        if (site.category === "Bot") {
            const botPresence = client.guilds.cache.some(guild => guild.members.cache.get(site.id)?.presence?.status === 'online');
            const status = botPresence ? '🟢 En ligne' : '🔴 Hors ligne';
            statusText += `**${site.name} ${status}**\n`;
        } else {
            try {
                const start = Date.now();
                await axios.get(site.url);
                const ping = Date.now() - start;
                console.log(`${site.name} is up.`);
                statusText += `**${site.name} 🟢 (Ping: ${ping} ms)**\n`;
                notifiedAdmins.delete(site.name); // Reset notification status if the site is back up
            } catch (error) {
                console.error(`${site.name} is down!`);
                statusText += `**${site.name} 🔴**\n`;

                if (!notifiedAdmins.has(site.name)) {
                    const admin = await client.users.fetch('664491067814445056'); // Replace with the actual admin user ID
                    admin.send(`Attention: ${site.name} est hors ligne !`);
                    notifiedAdmins.add(site.name);
                }
            }
        }
    }

    const embed = createStatusEmbed(statusText);
    if (statusMessage) {
        statusMessage.edit({ embeds: [embed] }).catch(console.error);
    }
}

function createStatusEmbed(statusText = 'En attente de la première vérification...') {
    const embed = new EmbedBuilder()
        .setColor('#00FF00') // Green
        .setTitle('Status des Services')
        .setDescription(statusText)
        .setTimestamp()
        .setFooter({ text: 'Made by LucasCha', iconURL: 'https://cdn.discordapp.com/avatars/664491067814445056/733bbc8587ab92aa27a52ece0d7b1c32.png?size=512' });

    return embed;
}

async function registerCommands() {
    const commands = [
        {
            name: 'maintenance',
            description: 'Planifie une maintenance',
            options: [
                {
                    name: 'site',
                    type: 3, // Corrected type for STRING
                    description: 'Le nom du site',
                    required: true,
                },
                {
                    name: 'time',
                    type: 3, // Corrected type for STRING
                    description: 'Le moment de la maintenance',
                    required: true,
                },
                {
                    name: 'reason',
                    type: 3, // Corrected type for STRING
                    description: 'La raison de la maintenance',
                    required: true,
                },
            ],
        },
        {
            name: 'probleme',
            description: 'Signale un problème',
            options: [
                {
                    name: 'site',
                    type: 3, // Corrected type for STRING
                    description: 'Le nom du site',
                    required: true,
                },
                {
                    name: 'issue',
                    type: 3, // Corrected type for STRING
                    description: 'La nature du problème',
                    required: true,
                },
            ],
        },
        { 
            name: 'observation',
            description: 'Mets un service en période de surveillance',
            options: [
                {
                    name: 'site',
                    type: 3, // Corrected type for STRING
                    description: 'Le nom du site',
                    required: true,
                },
                {
                    name: 'duration',
                    type: 4, // Corrected type for INTEGER
                    description: 'Durée en heures de la période de surveillance',
                    required: true,
                },
            ],
        },
        // Ajout de la commande pour enlever les remarques
        {
            name: 'removeremarque',
            description: 'Supprime une remarque en cours',
            options: [
                {
                    name: 'site',
                    type: 3, // Corrected type for STRING
                    description: 'Le nom du site',
                    required: true,
                },
            ],
        },
    ];

    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(client.user.id, config.guildId),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
}

client.login(config.token);
