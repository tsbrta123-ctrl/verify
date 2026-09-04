const express = require('express');
const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder 
} = require('discord.js');

// ==========================================
// 1. Web Server (Express) สำหรับ Hosting
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Server status: Online 🟢');
});

app.listen(PORT, () => {
    console.log(`[HTTP Server] Listening on port ${PORT}`);
});

// ==========================================
// 2. Discord Bot Setup
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`[Discord Bot] Logged in as ${client.user.tag}`);
});

// ==========================================
// 3. Message Commands & UI Builder
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // คำสั่งสร้าง UI พร้อม Embed และ ปุ่มกด
    if (message.content === '!panel' || message.content === '!ui') {

        // --- สร้าง Embed ---
        const mainEmbed = new EmbedBuilder()
            .setTitle('🤖 แผงควบคุมระบบ (Control Panel)')
            .setDescription('ยินดีต้อนรับสู่ระบบจัดการ เลือกกดปุ่มเมนูด้านล่างเพื่อสั่งการบอท')
            .setColor('#5865F2') // สี Blurple ของ Discord
            .setAuthor({ 
                name: message.guild.name, 
                iconURL: message.guild.iconURL({ dynamic: true }) 
            })
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { name: '📊 สถานะระบบ', value: '🟢 ปกติ (Online)', inline: true },
                { name: '⚡ ความหน่วง (Ping)', value: `\`${client.ws.ping} ms\``, inline: true },
                { name: '👥 ผู้ใช้งาน', value: `\`${message.guild.memberCount}\` คน`, inline: true }
            )
            .setImage('https://i.imgur.com/wSTFkRM.png') // ใส่รูป Banner (ถ้ามี)
            .setFooter({ 
                text: `ร้องขอโดย ${message.author.tag}`, 
                iconURL: message.author.displayAvatarURL() 
            })
            .setTimestamp();

        // --- สร้าง ปุ่มกด (Buttons) ---
        const btnPing = new ButtonBuilder()
            .setCustomId('btn_ping')
            .setLabel('เช็ค Ping')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚡');

        const btnServer = new ButtonBuilder()
            .setCustomId('btn_server_info')
            .setLabel('ข้อมูลเซิร์ฟเวอร์')
            .setStyle(ButtonStyle.Success)
            .setEmoji('ℹ️');

        const btnHelp = new ButtonBuilder()
            .setCustomId('btn_help')
            .setLabel('ช่วยเหลือ')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❓');

        const btnLink = new ButtonBuilder()
            .setLabel('เว็บไซต์หลัก')
            .setStyle(ButtonStyle.Link)
            .setURL('https://discord.js.org');

        // รวมปุ่มใส่ใน Row
        const row = new ActionRowBuilder().addComponents(btnPing, btnServer, btnHelp, btnLink);

        // ส่งข้อความ Embed พร้อม ปุ่ม
        await message.reply({
            embeds: [mainEmbed],
            components: [row]
        });
    }
});

// ==========================================
// 4. Button Interaction Handler (ระบบตอบสนองปุ่มกด)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // ปุ่ม: เช็ค Ping
    if (interaction.customId === 'btn_ping') {
        const pingEmbed = new EmbedBuilder()
            .setTitle('⚡ สถานะความหน่วง')
            .setDescription(`ความหน่วงระบบการเชื่อมต่อ (WebSocket Ping) คือ: **${client.ws.ping}ms**`)
            .setColor('#57F287');

        await interaction.reply({
            embeds: [pingEmbed],
            ephemeral: true // ข้อความเด้งเห็นคนเดียว
        });
    }

    // ปุ่ม: ข้อมูลเซิร์ฟเวอร์
    if (interaction.customId === 'btn_server_info') {
        const infoEmbed = new EmbedBuilder()
            .setTitle(`📌 ข้อมูลเซิร์ฟเวอร์: ${interaction.guild.name}`)
            .addFields(
                { name: 'เจ้าของเซิร์ฟเวอร์', value: `<@${interaction.guild.ownerId}>`, inline: true },
                { name: 'สมาชิกทั้งหมด', value: `${interaction.guild.memberCount} คน`, inline: true }
            )
            .setColor('#FEE75C');

        await interaction.reply({
            embeds: [infoEmbed],
            ephemeral: true
        });
    }

    // ปุ่ม: ช่วยเหลือ
    if (interaction.customId === 'btn_help') {
        await interaction.reply({
            content: '❓ **คู่มือใช้งาน:** พิมพ์คำสั่ง `!panel` เพื่อเรียกแผงควบคุมหลักขึ้นมาใช้งานได้ตลอดเวลาครับ',
            ephemeral: true
        });
    }
});

// ==========================================
// 5. Login
// ==========================================
const TOKEN = process.env.DISCORD_TOKEN;

if (TOKEN) {
    client.login(TOKEN);
} else {
    console.error('[ERROR] ไม่พบ DISCORD_TOKEN กรุณาตั้งค่าใน Environment Variables!');
}