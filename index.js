const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    InteractionType,
    parseEmoji,
    MessageFlags
} = require('discord.js');

// ==========================================
// CONFIGURATION
// ==========================================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
const PORT = parseInt(process.env.PORT || "8888", 10);
const DB_PATH = process.env.DB_PATH || "database.db";

const GIF_URL = "https://cdn.discordapp.com/attachments/1420812683124670596/1540669145161662584/original_ddaceecdd62614ddf9a488b75ef88075.gif?ex=6a8acb74&is=6a8979f4&hm=7dfcdf79662c2c31c862537e84fa6d7c0768406c383c75ab75d3cb7389be5025&";

const COLOR_SUCCESS = 0x2ECC71;
const COLOR_ERROR   = 0xE74C3C;
const COLOR_INFO    = 0x3498DB;
const COLOR_ACCENT  = 0xF1C40F;

const DEFAULT_SETTINGS = {
    roblox_group_id: 33852603,
    roblox_group_url: "https://www.roblox.com/groups/33852603",
    roblox_map_url: "https://www.roblox.com/games/17709721251",
    verified_role_id: "1540716342120939550",
    developer_role_id: "1420812428740133016",
    verified_emoji: "✅",
    role_ids: {
        or: "1420812475804287056",
        cd: "1420812474227101707",
        of_low: "1420812472616751278",
        of_high: "1420812470905213019",
        hq: "1420812465775710354",
        guest: null,
    },
    rank_prefixes: {
        "or-1": "OR-1, PVT", "or-2": "OR-2, PFC", "or-3": "OR-3, LCPL", "or-4": "OR-4, CPL",
        "or-5": "OR-5, SGT", "or-6": "OR-6, SM3", "or-7": "OR-7, SM2", "or-8": "OR-8, SM1",
        "or-9": "OR-9, SMS", "of-d": "OF-D, ACO", "of-1a": "OF-1A, 2LT", "of-1b": "OF-1B, 1LT",
        "of-2": "OF-2, CPT", "of-3": "OF-3, MAJ", "of-4": "OF-4, LTC", "of-5": "OF-5, COL",
        "of-6": "OF-6, SRCOL", "of-7": "OF-7, MG", "of-8": "OF-8, LTG", "of-9": "OF-9, GEN",
        "deputy prime minister": "DPM", "prime minister": "PM", "mom rajawongse": "M.R.",
        "his serene highness": "H.S.H. Prince", "her highness": "H.H. Princess",
        "his royal highness": "H.R.H. Prince", "field marshal": "OF-10, FMS",
        "royal protectorate": "Protectorate", "crown prince": "Crown Prince",
        "her majesty": "H.M. Queen", "his majesty": "H.M. King"
    }
};

const DEVELOPER_IDS = [2769442731];

// ==========================================
// DATABASE UTILITIES (sqlite3)
// ==========================================
const db = new sqlite3.Database(DB_PATH);

function dbRun(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbGet(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

async function initDb() {
    await dbRun(`
        CREATE TABLE IF NOT EXISTS users (
            discord_id TEXT PRIMARY KEY,
            roblox_id TEXT,
            roblox_username TEXT,
            verified INTEGER DEFAULT 0,
            pending_roblox_username TEXT
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS guild_settings (
            guild_id TEXT PRIMARY KEY,
            settings_json TEXT
        )
    `);
}
initDb();

async function getGuildSettings(guildId) {
    if (!guildId) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

    const row = await dbGet("SELECT settings_json FROM guild_settings WHERE guild_id = ?", [String(guildId)]);
    let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

    if (row && row.settings_json) {
        try {
            const saved = JSON.parse(row.settings_json);
            if (saved && typeof saved === 'object') {
                Object.keys(saved).forEach(k => {
                    if (k !== 'role_ids' && k !== 'rank_prefixes') {
                        settings[k] = saved[k];
                    }
                });
                if (saved.role_ids) Object.assign(settings.role_ids, saved.role_ids);
                if (saved.rank_prefixes) Object.assign(settings.rank_prefixes, saved.rank_prefixes);
            }
        } catch (e) {
            console.error(`Error parsing settings for guild ${guildId}:`, e);
        }
    }
    return settings;
}

async function saveGuildSettings(guildId, settings) {
    if (!guildId) return;
    await dbRun(`
        INSERT INTO guild_settings (guild_id, settings_json)
        VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET settings_json = excluded.settings_json
    `, [String(guildId), JSON.stringify(settings)]);
}

function parseId(val) {
    if (!val) return null;
    const match = String(val).match(/\d+/);
    return match ? match[0] : null;
}

async function getUser(discordId) {
    return await dbGet("SELECT * FROM users WHERE discord_id = ?", [String(discordId)]);
}

async function updatePending(discordId, robloxId, username) {
    await dbRun(`
        INSERT INTO users (discord_id, roblox_id, roblox_username, pending_roblox_username, verified)
        VALUES (?, ?, ?, ?, 0)
        ON CONFLICT(discord_id) DO UPDATE SET
            roblox_id = excluded.roblox_id,
            roblox_username = excluded.roblox_username,
            pending_roblox_username = excluded.pending_roblox_username,
            verified = 0
    `, [String(discordId), String(robloxId), String(username), String(username).trim().toLowerCase()]);
}

function getSafeEmoji(emojiStr) {
    if (!emojiStr) return "✅";
    if (typeof emojiStr === 'string' && emojiStr.startsWith("<") && emojiStr.endsWith(">")) {
        const parsed = parseEmoji(emojiStr);
        return parsed ? parsed : "✅";
    }
    return emojiStr;
}

// ==========================================
// ROBLOX API HELPER FUNCTIONS
// ==========================================
async function getRobloxInfoByName(username) {
    try {
        const response = await axios.post(
            "https://users.roblox.com/v1/usernames/users",
            { usernames: [username], excludeBannedUsers: true },
            { timeout: 15000 }
        );
        if (response.data && response.data.data && response.data.data.length > 0) {
            return {
                robloxId: String(response.data.data[0].id),
                name: response.data.data[0].name
            };
        }
    } catch (error) {
        console.error("Error fetching Roblox ID:", error.message);
    }
    return { robloxId: null, name: null };
}

async function checkGroupMembership(robloxId, groupId) {
    try {
        const response = await axios.get(
            `https://groups.roblox.com/v1/users/${robloxId}/groups/roles`,
            { timeout: 15000 }
        );
        if (response.data && response.data.data) {
            for (const group of response.data.data) {
                if (group.group && group.group.id === parseInt(groupId, 10)) {
                    return {
                        isInGroup: true,
                        rankVal: group.role.rank,
                        rankName: group.role.name
                    };
                }
            }
        }
    } catch (error) {
        console.error("Error checking group membership:", error.message);
    }
    return { isInGroup: false, rankVal: 0, rankName: null };
}

function getPrefixForRank(rankVal, rankName, settings) {
    const prefixes = settings.rank_prefixes || {};
    const normalizedName = String(rankName || "").trim().toLowerCase();
    const numericRank = parseInt(rankVal || 0, 10);

    const rankAliases = {
        1: ["or-1"], 2: ["or-2"], 3: ["or-3"], 4: ["or-4"], 5: ["or-5"],
        6: ["or-6"], 7: ["or-7"], 8: ["or-8"], 9: ["or-9"],
        10: ["of-d"], 11: ["of-1a"], 12: ["of-1b"], 13: ["of-2"],
        14: ["of-3"], 15: ["of-4"], 16: ["of-5"], 17: ["of-6"],
        18: ["of-7"], 19: ["of-8"], 20: ["of-9"]
    };

    for (const [rankKey, prefix] of Object.entries(prefixes)) {
        const key = String(rankKey).trim().toLowerCase();
        const aliases = rankAliases[numericRank] || [];
        if (normalizedName.includes(key) || aliases.includes(key)) {
            return String(prefix).trim();
        }
    }

    const fallback = {
        1: "OR-1, PVT", 2: "OR-2, PFC", 3: "OR-3, LCPL", 4: "OR-4, CPL",
        5: "OR-5, SGT", 6: "OR-6, SM3", 7: "OR-7, SM2", 8: "OR-8, SM1",
        9: "OR-9, SMS", 10: "OF-D, ACO", 11: "OF-1A, 2LT", 12: "OF-1B, 1LT",
        13: "OF-2, CPT", 14: "OF-3, MAJ", 15: "OF-4, LTC", 16: "OF-5, COL",
        17: "OF-6, SRCOL", 18: "OF-7, MG", 19: "OF-8, LTG", 20: "OF-9, GEN",
        22: "DPM", 23: "PM", 24: "M.R.", 25: "H.S.H. Prince", 26: "H.H. Princess",
        27: "H.R.H. Prince", 28: "OF-10, FMS", 29: "Protectorate",
        30: "Crown Prince", 31: "H.M. Queen", 32: "H.M. King"
    };

    return fallback[numericRank] || "";
}

async function updateMemberStatus(discordId, robloxId, robloxUsername, guildId = null) {
    let guild = guildId ? client.guilds.cache.get(String(guildId)) : null;
    if (!guild && client.guilds.cache.size > 0) {
        guild = client.guilds.cache.first();
    }
    if (!guild) {
        return { rankVal: null, displayName: null, rankName: null, errMsg: "ไม่พบเซิร์ฟเวอร์ Discord ของบอท" };
    }

    const settings = await getGuildSettings(guild.id);

    try {
        const member = await guild.members.fetch(String(discordId));
        const groupInfo = await checkGroupMembership(robloxId, settings.roblox_group_id);
        const isDev = DEVELOPER_IDS.includes(parseInt(robloxId, 10));

        const managedRoleIds = new Set([
            parseId(settings.verified_role_id),
            parseId(settings.developer_role_id),
            ...Object.values(settings.role_ids || {}).map(v => parseId(v))
        ]);
        managedRoleIds.delete(null);

        let rolesToKeep = member.roles.cache.filter(role => role.id !== guild.id && !managedRoleIds.has(role.id));
        let newRoleIds = new Set(rolesToKeep.map(r => r.id));

        const verifiedRoleId = parseId(settings.verified_role_id);
        if (verifiedRoleId) newRoleIds.add(verifiedRoleId);

        let nickname = "";
        let displayRankName = "";

        if (isDev) {
            const devRoleId = parseId(settings.developer_role_id);
            if (devRoleId) newRoleIds.add(devRoleId);
            nickname = `ผู้ดูแลระบบ | ${robloxUsername}`;
            displayRankName = "Developer";
        } else if (groupInfo.isInGroup) {
            const rVal = groupInfo.rankVal;
            let rankRoleId = null;

            if (rVal >= 1 && rVal <= 9) rankRoleId = parseId(settings.role_ids.or);
            else if (rVal >= 10 && rVal <= 13) rankRoleId = parseId(settings.role_ids.cd);
            else if (rVal >= 14 && rVal <= 17) rankRoleId = parseId(settings.role_ids.of_low);
            else if (rVal >= 18 && rVal <= 20) rankRoleId = parseId(settings.role_ids.of_high);
            else if (rVal >= 22 && rVal <= 32) rankRoleId = parseId(settings.role_ids.hq);

            if (rankRoleId) newRoleIds.add(rankRoleId);

            const prefix = getPrefixForRank(rVal, groupInfo.rankName, settings);
            nickname = prefix ? `${prefix} | ${robloxUsername}` : robloxUsername;
            displayRankName = groupInfo.rankName || "ไม่ทราบชื่อยศ";
        } else {
            const guestRoleId = parseId(settings.role_ids.guest);
            if (guestRoleId) newRoleIds.add(guestRoleId);
            nickname = `Guest | ${robloxUsername}`;
            displayRankName = "Guest";
        }

        await member.roles.set(Array.from(newRoleIds));
        await member.setNickname(nickname.substring(0, 32));

        return {
            rankVal: isDev ? 999 : groupInfo.rankVal,
            displayName: member.displayName,
            rankName: displayRankName,
            errMsg: null
        };
    } catch (error) {
        let msg = `Error: ${error.message}`;
        if (error.code === 50013) {
            msg = "บอทไม่มีสิทธิ์จัดการโรล/ชื่อ (Missing Permissions) หรือ Role บอทอยู่ต่ำกว่า Role ที่ใส่";
        } else if (error.code === 10007) {
            msg = "ไม่พบคุณใน Discord Server นี้ (อาจยังไม่ได้เข้าเซิร์ฟเวอร์)";
        }
        return { rankVal: null, displayName: null, rankName: null, errMsg: msg };
    }
}

// ==========================================
// DISCORD BOT SETUP & EVENTS
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ฟังก์ชันสร้าง UI แบบ COMPONENTS V2 (ขังปุ่มอยู่ใน Container เดียวกับ Text & Banner)
function createVerifyComponentsV2(vEmoji = "✅") {
    const safeEmoji = getSafeEmoji(vEmoji);
    const emojiObj = typeof safeEmoji === 'object' ? safeEmoji : { name: safeEmoji };

    const container = {
        type: 17, // ComponentType.Container
        components: [
            // 1. Text Section
            {
                type: 10, // ComponentType.TextDisplay
                content: 
                    "## ✔️ ระบบยืนยันตัวตน | Roblox Verification\n" +
                    "ยินดีต้อนรับสู่ระบบยืนยันตัวตน กรุณากดปุ่ม **`ยืนยันตัวตนที่นี่`** ด้านล่างเพื่อเริ่มต้นขั้นตอนผูกบัญชี Discord เข้ากับ Roblox\n\n" +
                    "**📌 สิ่งที่คุณต้องเตรียม:**\n" +
                    "• ชื่อผู้ใช้ Roblox (Username)\n" +
                    "• เข้าร่วมกลุ่ม Roblox ที่กำหนดให้เรียบร้อย\n" +
                    "• เข้าแมพ ที่ได้ทำการส่งไปให้\n" +
                    "• หลังเข้าเกมแล้วพิมพ์ ยืนยัน แล้วจะขึ้น หน้าต่าง แล้วกดยืนยันตัวตนได้เลย"
            },
            // 2. Banner Image
            {
                type: 12, // ComponentType.MediaGallery
                items: [
                    { media: { url: GIF_URL } }
                ]
            },
            // 3. Separator (เส้นคั่น)
            {
                type: 14, // ComponentType.Separator
                divider: true,
                spacing: 1
            },
            // 4. Button inside Container
            {
                type: 1, // ComponentType.ActionRow
                components: [
                    {
                        type: 2, // ComponentType.Button
                        custom_id: "persistent_verify",
                        label: "ยืนยันตัวตนที่นี่",
                        style: 1, // ButtonStyle.Primary
                        emoji: emojiObj
                    }
                ]
            }
        ]
    };

    return [container];
}

function createReVerifyView() {
    const btnUpdate = new ButtonBuilder()
        .setCustomId("update_rank")
        .setLabel("อัพเดทยศ")
        .setStyle(ButtonStyle.Success)
        .setEmoji("🔄");

    const btnChange = new ButtonBuilder()
        .setCustomId("change_acc")
        .setLabel("เปลี่ยน Account")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔁");

    return new ActionRowBuilder().addComponents(btnUpdate, btnChange);
}

client.once('ready', async () => {
    console.log(`[BOT] Logged in as ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName("ยืนยันตัวตน")
            .setDescription("ตั้งค่าระบบยืนยันตัวตน (Administrator Only)")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName("ตั้งค่าอีโมจิ")
            .setDescription("เปลี่ยนอีโมจิกดยืนยันตัวตนของเซิร์ฟเวอร์นี้ (Administrator Only)")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(option =>
                option.setName("อีโมจิ")
                    .setDescription("ใส่อีโมจิธรรมดา หรือ Custom Emoji เช่น <:name:ID>")
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName("ล้างข้อมูล")
            .setDescription("ลบข้อมูลการยืนยันตัวตนทุกคน")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName("ล้างข้อมูลทั้งหมด")
            .setDescription("ลบข้อมูลการยืนยันตัวตนทุกคน (คำสั่งเดิม)")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName("ใส่โรล")
            .setDescription("ตั้งค่า Role ให้กับประเภทที่เลือกของเซิร์ฟเวอร์นี้")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(option =>
                option.setName("ประเภท")
                    .setDescription("เลือกประเภทบทบาทที่ต้องการผูก Role")
                    .setRequired(true)
                    .addChoices(
                        { name: "ยืนยันตัวตน", value: "verified" },
                        { name: "Developer", value: "developer" },
                        { name: "OR", value: "or" },
                        { name: "CD(นายร้อย)", value: "cd" },
                        { name: "OF Low", value: "of_low" },
                        { name: "OF High", value: "of_high" },
                        { name: "กองบัญชาการ (HQ)", value: "hq" },
                        { name: "Guest", value: "guest" }
                    )
            )
            .addRoleOption(option =>
                option.setName("โรล")
                    .setDescription("เลือก Role ที่ต้องการให้ระบบใช้")
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName("ใส่คำนำหน้า")
            .setDescription("เพิ่มหรือแก้คำนำหน้าตามชื่อยศ Roblox ของเซิร์ฟเวอร์นี้")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(option =>
                option.setName("ยศ")
                    .setDescription("รหัสยศ เช่น OF-3 หรือ OR-1 ต้องตรงหรือเป็นส่วนหนึ่งของชื่อยศ Roblox")
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName("คำนำหน้า")
                    .setDescription("ชื่อคำนำหน้า เช่น MAJ หรือ PC")
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName("ปรับแต่งทั้งหมด")
            .setDescription("เปิดหน้าต่างปรับแต่งระบบกลุ่ม โรล และคำนำหน้าของเซิร์ฟเวอร์นี้")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName("ดูการตั้งค่า")
            .setDescription("ดูการตั้งค่าระบบปัจจุบันของเซิร์ฟเวอร์นี้")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ];

    try {
        await client.application.commands.set(commands);
        console.log("[BOT] Synchronized slash commands successfully!");
    } catch (err) {
        console.error("Failed to sync slash commands:", err);
    }
});

// ==========================================
// INTERACTION HANDLERS
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === "ยืนยันตัวตน") {
            const settings = await getGuildSettings(interaction.guildId);
            const vEmoji = settings.verified_emoji || "✅";

            // ส่งผ่านระบบ Components V2
            await interaction.channel.send({
                components: createVerifyComponentsV2(vEmoji),
                flags: MessageFlags.IsComponentsV2
            });

            const confirmEmbed = new EmbedBuilder()
                .setTitle("✅ ดำเนินการสำเร็จ")
                .setDescription("ติดตั้งข้อความระบบยืนยันตัวตน (Components V2 UI) เรียบร้อยแล้ว")
                .setColor(COLOR_SUCCESS);

            await interaction.reply({ embeds: [confirmEmbed], ephemeral: true });
        }

        else if (commandName === "ตั้งค่าอีโมจิ") {
            if (!interaction.guildId) return;
            const emojiInput = interaction.options.getString("อีโมจิ").trim();
            const settings = await getGuildSettings(interaction.guildId);

            settings.verified_emoji = emojiInput;
            await saveGuildSettings(interaction.guildId, settings);

            const safeE = getSafeEmoji(emojiInput);
            const embed = new EmbedBuilder()
                .setTitle("🎨 อัพเดทอีโมจิสำเร็จ")
                .setDescription(`เปลี่ยนอีโมจิยืนยันตัวตนเป็น ${safeE} เรียบร้อยแล้ว\n\n*(พิมพ์ \`/ยืนยันตัวตน\` อีกครั้งเพื่อส่งปุ่มด้วยอีโมจิใหม่)*`)
                .setColor(COLOR_SUCCESS);

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        else if (commandName === "ล้างข้อมูล" || commandName === "ล้างข้อมูลทั้งหมด") {
            await dbRun("DELETE FROM users");
            const embed = new EmbedBuilder()
                .setTitle("⚠️ ล้างข้อมูลสำเร็จ")
                .setDescription("ลบข้อมูลการยืนยันตัวตนทั้งหมดในระบบแล้ว ผู้ใช้ทุกคนจะต้องทำการยืนยันตัวตนใหม่")
                .setColor(COLOR_ACCENT);

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        else if (commandName === "ใส่โรล") {
            if (!interaction.guildId) return;
            const roleType = interaction.options.getString("ประเภท");
            const role = interaction.options.getRole("โรล");
            const settings = await getGuildSettings(interaction.guildId);

            if (roleType === "verified" || roleType === "developer") {
                settings[`${roleType}_role_id`] = role.id;
            } else {
                settings.role_ids[roleType] = role.id;
            }
            await saveGuildSettings(interaction.guildId, settings);

            const embed = new EmbedBuilder()
                .setTitle("🏷️ ตั้งค่าบทบาทสำเร็จ")
                .setDescription(`เชื่อมโยงบทบาท <@&${role.id}> ให้กับประเภท **${roleType}** สำเร็จ`)
                .setColor(COLOR_SUCCESS);

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        else if (commandName === "ใส่คำนำหน้า") {
            if (!interaction.guildId) return;
            const rankCode = interaction.options.getString("ยศ").trim();
            const title = interaction.options.getString("คำนำหน้า").trim();

            const settings = await getGuildSettings(interaction.guildId);
            settings.rank_prefixes[rankCode.toLowerCase()] = `${rankCode}, ${title}`;
            await saveGuildSettings(interaction.guildId, settings);

            const embed = new EmbedBuilder()
                .setTitle("🏷️ เพิ่มคำนำหน้าสำเร็จ")
                .setDescription(`บันทึกรูปแบบ: **\`${rankCode}, ${title}\`** เรียบร้อยแล้ว`)
                .setColor(COLOR_SUCCESS);

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        else if (commandName === "ปรับแต่งทั้งหมด") {
            const modal = new ModalBuilder()
                .setCustomId("customize_all_modal")
                .setTitle("⚙️ ปรับแต่งระบบทั้งหมด");

            const groupIdInput = new TextInputBuilder()
                .setCustomId("group_id")
                .setLabel("Roblox Group ID")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("ตัวเลขเท่านั้น เช่น 33852603")
                .setRequired(false);

            const groupUrlInput = new TextInputBuilder()
                .setCustomId("group_url")
                .setLabel("ลิงก์กลุ่ม Roblox")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("https://www.roblox.com/groups/...")
                .setRequired(false);

            const mapUrlInput = new TextInputBuilder()
                .setCustomId("map_url")
                .setLabel("ลิงก์แมพ Roblox")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("https://www.roblox.com/games/...")
                .setRequired(false);

            const prefixesInput = new TextInputBuilder()
                .setCustomId("prefixes")
                .setLabel("คำนำหน้ายศ (แยกด้วย ;)")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("or-1=PC; of-3=MAJ")
                .setRequired(false);

            const roleIdsInput = new TextInputBuilder()
                .setCustomId("role_ids")
                .setLabel("Role IDs (แยกด้วย ;)")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("verified=ID; or=ID; cd=ID; of_low=ID; of_high=ID; hq=ID; guest=ID")
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(groupIdInput),
                new ActionRowBuilder().addComponents(groupUrlInput),
                new ActionRowBuilder().addComponents(mapUrlInput),
                new ActionRowBuilder().addComponents(prefixesInput),
                new ActionRowBuilder().addComponents(roleIdsInput)
            );

            await interaction.showModal(modal);
        }

        else if (commandName === "ดูการตั้งค่า") {
            if (!interaction.guildId) return;
            const settings = await getGuildSettings(interaction.guildId);
            const roleIds = settings.role_ids || {};
            const vEmoji = settings.verified_emoji || "✅";

            const rolesFmt = 
                `• **OR:** \`${roleIds.or || 'None'}\`\n` +
                `• **CD (นายร้อย):** \`${roleIds.cd || 'None'}\`\n` +
                `• **OF Low:** \`${roleIds.of_low || 'None'}\`\n` +
                `• **OF High:** \`${roleIds.of_high || 'None'}\`\n` +
                `• **HQ (กองบัญชาการ):** \`${roleIds.hq || 'None'}\`\n` +
                `• **Guest:** \`${roleIds.guest || 'None'}\``;

            let prefixesStr = Object.entries(settings.rank_prefixes || {})
                .map(([k, v]) => `\`${k}\` ➔ ${v}`)
                .join("\n");

            const embed = new EmbedBuilder()
                .setTitle("⚙️ การตั้งค่าระบบปัจจุบัน (Server Settings)")
                .setColor(COLOR_INFO)
                .addFields(
                    { name: "📌 Group ID", value: `\`\`\`${settings.roblox_group_id}\`\`\``, inline: true },
                    { name: "✅ Verified Role ID", value: `\`\`\`${settings.verified_role_id}\`\`\``, inline: true },
                    { name: "🎨 Verification Emoji", value: `${vEmoji}`, inline: true },
                    { name: "🎭 Role Configs", value: rolesFmt, inline: false },
                    { name: "🏷️ Rank Prefixes", value: prefixesStr.substring(0, 1024) || "*ไม่มีข้อมูล*", inline: false }
                )
                .setFooter({ text: "Configuration Panel • Dev by : dewanoi123" });

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }

    else if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId === "persistent_verify") {
            const user = await getUser(interaction.user.id);
            if (user && user.verified) {
                const settings = await getGuildSettings(interaction.guildId);
                const safeVEmoji = getSafeEmoji(settings.verified_emoji || "✅");

                const embed = new EmbedBuilder()
                    .setTitle("✅ บัญชีนี้ได้รับการยืนยันตัวตนแล้ว")
                    .setDescription("คุณมีข้อมูลผูกไว้กับระบบเรียบร้อยแล้ว หากต้องการอัพเดทยศหรือเปลี่ยนบัญชี เลือกปุ่มด้านล่าง")
                    .setColor(COLOR_INFO)
                    .addFields(
                        { name: "👤 Roblox Username", value: `\`\`\`${user.roblox_username}\`\`\``, inline: true },
                        { name: "🆔 Roblox ID", value: `\`\`\`${user.roblox_id}\`\`\``, inline: true },
                        { name: "⚡ สถานะ", value: `\`\`\`${safeVEmoji} Verified\`\`\``, inline: false }
                    )
                    .setImage(GIF_URL)
                    .setFooter({ text: "Verification Panel • Dev by : dewanoi123" });

                await interaction.reply({
                    embeds: [embed],
                    components: [createReVerifyView()],
                    ephemeral: true
                });
            } else {
                const modal = new ModalBuilder()
                    .setCustomId("verify_modal")
                    .setTitle("⚡ ยืนยันตัวตน ROBLOX");

                const usernameInput = new TextInputBuilder()
                    .setCustomId("roblox_username")
                    .setLabel("ROBLOX USERNAME")
                    .setPlaceholder("กรอกชื่อผู้ใช้ของคุณ (เช่น RobloxUser123)")
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(3)
                    .setMaxLength(20)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
                await interaction.showModal(modal);
            }
        }

        else if (customId === "update_rank") {
            await interaction.deferReply({ ephemeral: true });
            const user = await getUser(interaction.user.id);

            if (!user || !user.roblox_id) {
                const embed = new EmbedBuilder()
                    .setTitle("❌ ไม่พบข้อมูล")
                    .setDescription("ไม่พบข้อมูลการบันทึกยืนยันตัวตนของคุณในระบบ")
                    .setColor(COLOR_ERROR);
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            const result = await updateMemberStatus(
                interaction.user.id,
                user.roblox_id,
                user.roblox_username,
                interaction.guildId
            );

            if (result.rankVal === null) {
                const embed = new EmbedBuilder()
                    .setTitle("❌ เกิดข้อผิดพลาด")
                    .setDescription(`\`\`\`${result.errMsg}\`\`\``)
                    .setColor(COLOR_ERROR);
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            const settings = await getGuildSettings(interaction.guildId);
            const safeVEmoji = getSafeEmoji(settings.verified_emoji || "✅");

            const embed = new EmbedBuilder()
                .setTitle(`${safeVEmoji} อัพเดทยศสำเร็จ!`)
                .setDescription("ปรับปรุงยศและข้อมูลบทบาทของคุณเรียบร้อยแล้ว")
                .setColor(COLOR_SUCCESS)
                .addFields(
                    { name: "👤 ผู้ใช้", value: `\`\`\`${user.roblox_username}\`\`\``, inline: true },
                    { name: "🎖️ ยศปัจจุบัน", value: `\`\`\`${result.rankName}\`\`\``, inline: true }
                )
                .setFooter({ text: "System Sync Completed", iconURL: interaction.user.displayAvatarURL() });

            await interaction.editReply({ embeds: [embed] });
        }

        else if (customId === "change_acc") {
            const modal = new ModalBuilder()
                .setCustomId("verify_modal")
                .setTitle("⚡ ยืนยันตัวตน ROBLOX");

            const usernameInput = new TextInputBuilder()
                .setCustomId("roblox_username")
                .setLabel("ROBLOX USERNAME")
                .setPlaceholder("กรอกชื่อผู้ใช้ของคุณ (เช่น RobloxUser123)")
                .setStyle(TextInputStyle.Short)
                .setMinLength(3)
                .setMaxLength(20)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
            await interaction.showModal(modal);
        }
    }

    else if (interaction.type === InteractionType.ModalSubmit) {
        if (interaction.customId === "verify_modal") {
            const inputName = interaction.fields.getTextInputValue("roblox_username").trim();
            const { robloxId, name: correctName } = await getRobloxInfoByName(inputName);

            if (!robloxId) {
                const embed = new EmbedBuilder()
                    .setTitle("❌ ไม่พบข้อมูลบัญชี")
                    .setDescription(`ไม่พบบัญชี Roblox ชื่อ **\`${inputName}\`** โปรดตรวจสอบตัวอักษรและลองใหม่อีกครั้ง`)
                    .setColor(COLOR_ERROR)
                    .setFooter({ text: "Verification System • Dev by : dewanoi123" });

                await interaction.reply({ embeds: [embed], ephemeral: true });
                return;
            }

            const settings = await getGuildSettings(interaction.guildId);
            const isDev = DEVELOPER_IDS.includes(parseInt(robloxId, 10));
            const groupInfo = await checkGroupMembership(robloxId, settings.roblox_group_id);

            if (!groupInfo.isInGroup && !isDev) {
                const embed = new EmbedBuilder()
                    .setTitle("🚫 จำเป็นต้องเข้าร่วมกลุ่ม")
                    .setDescription("คุณจำเป็นต้องเป็นสมาชิกของกลุ่ม Roblox ก่อนจึงจะทำการยืนยันตัวตนได้")
                    .setColor(COLOR_ERROR)
                    .addFields({ name: "🔗 ลิงก์กลุ่ม", value: `[คลิกที่นี่เพื่อเข้ากลุ่ม Roblox](${settings.roblox_group_url})`, inline: false })
                    .setFooter({ text: "Verification System • Dev by : dewanoi123" });

                await interaction.reply({ embeds: [embed], ephemeral: true });
                try {
                    await interaction.user.send(`⚠️ **แจ้งเตือน:** กรุณาเข้ากลุ่ม Roblox ก่อนทำการยืนยันตัวตน: ${settings.roblox_group_url}`);
                } catch (e) {}
                return;
            }

            await updatePending(interaction.user.id, robloxId, correctName);

            const embed = new EmbedBuilder()
                .setTitle("📥 ขั้นตอนถัดไป: ยืนยันตัวตนในเกม")
                .setDescription("ระบบได้รับข้อมูลของคุณเรียบร้อยแล้ว โปรดเข้าเกมเพื่อทำรายการยืนยันให้เสร็จสมบูรณ์")
                .setColor(COLOR_INFO)
                .addFields(
                    { name: "👤 Roblox Username", value: `\`\`\`${correctName}\`\`\``, inline: true },
                    { name: "🆔 Roblox ID", value: `\`\`\`${robloxId}\`\`\``, inline: true },
                    { name: "🎮 เข้ายืนยันตัวตน", value: `➡️ **[คลิกที่นี่เพื่อเข้าสู่แมพยืนยันตัวตน](${settings.roblox_map_url})**`, inline: false }
                )
                .setFooter({ text: "ระบบกำลังรอการยืนยันจากในเกม...", iconURL: interaction.user.displayAvatarURL() });

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        else if (interaction.customId === "customize_all_modal") {
            const guildId = interaction.guildId;
            if (!guildId) return;

            const settings = await getGuildSettings(guildId);

            const gidVal = interaction.fields.getTextInputValue("group_id").trim();
            const gUrlVal = interaction.fields.getTextInputValue("group_url").trim();
            const mUrlVal = interaction.fields.getTextInputValue("map_url").trim();
            const prefixesVal = interaction.fields.getTextInputValue("prefixes").trim();
            const roleIdsVal = interaction.fields.getTextInputValue("role_ids").trim();

            if (gidVal) {
                const parsedGid = parseId(gidVal);
                if (parsedGid) settings.roblox_group_id = parseInt(parsedGid, 10);
            }
            if (gUrlVal) settings.roblox_group_url = gUrlVal;
            if (mUrlVal) settings.roblox_map_url = mUrlVal;

            if (prefixesVal) {
                prefixesVal.split(";").forEach(item => {
                    if (item.includes("=")) {
                        let [k, v] = item.split("=", 2);
                        k = k.trim().toLowerCase();
                        v = v.trim();
                        if (k && v) {
                            if (!v.includes(",") && k.includes("-")) {
                                settings.rank_prefixes[k] = `${k.toUpperCase()}, ${v}`;
                            } else {
                                settings.rank_prefixes[k] = v;
                            }
                        }
                    }
                });
            }

            if (roleIdsVal) {
                roleIdsVal.split(";").forEach(item => {
                    if (item.includes("=")) {
                        let [rtype, ridRaw] = item.split("=", 2);
                        rtype = rtype.trim().toLowerCase();
                        const rid = parseId(ridRaw);
                        if (rid) {
                            if (rtype === "verified" || rtype === "developer") {
                                settings[`${rtype}_role_id`] = rid;
                            } else if (["or", "cd", "of_low", "of_high", "hq", "guest"].includes(rtype)) {
                                settings.role_ids[rtype] = rid;
                            }
                        }
                    }
                });
            }

            await saveGuildSettings(guildId, settings);

            const embed = new EmbedBuilder()
                .setTitle("✅ บันทึกการตั้งค่าเรียบร้อย")
                .setDescription("การตั้งค่าระบบถูกอัปเดตสำหรับเซิร์ฟเวอร์นี้แล้ว")
                .setColor(COLOR_SUCCESS);

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }
});

// ==========================================
// EXPRESS WEBHOOK
// ==========================================
const app = express();
app.use(express.json());

app.post('/verify', async (req, res) => {
    const { robloxId, robloxUsername, guildId } = req.body;
    const searchName = String(robloxUsername || "").trim().toLowerCase();

    let row = await dbGet(`
        SELECT discord_id FROM users
        WHERE roblox_id = ? AND verified = 0
        ORDER BY rowid DESC LIMIT 1
    `, [String(robloxId)]);

    if (!row) {
        row = await dbGet(`
            SELECT discord_id FROM users
            WHERE LOWER(pending_roblox_username) = ? AND verified = 0
            ORDER BY rowid DESC LIMIT 1
        `, [searchName]);
    }

    if (!row) {
        return res.json({
            ok: false,
            message: `ไม่พบชื่อ '${robloxUsername}' ในรายการรอ (กรุณากดปุ่มยืนยันใน Discord ก่อน)`
        });
    }

    const result = await updateMemberStatus(row.discord_id, robloxId, robloxUsername, guildId);

    if (result.rankVal !== null) {
        await dbRun(`
            UPDATE users
            SET roblox_id = ?, roblox_username = ?, verified = 1,
                pending_roblox_username = NULL
            WHERE discord_id = ?
        `, [String(robloxId), String(robloxUsername).trim(), row.discord_id]);

        return res.json({
            ok: true,
            discord_username: result.displayName,
            current_rank: result.rankName
        });
    }

    return res.json({
        ok: false,
        message: result.errMsg || "บอทไม่มีสิทธิ์เปลี่ยนยศหรือไม่พบเซิร์ฟเวอร์ Discord"
    });
});

app.listen(PORT, () => {
    console.log(`[HTTP] Webhook server listening on port ${PORT}`);
});

if (DISCORD_TOKEN) {
    client.login(DISCORD_TOKEN);
} else {
    console.error("[ERROR] DISCORD_TOKEN is missing in environment variables!");
}
