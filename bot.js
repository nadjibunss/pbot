// bot.js

const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  delay
} = require("@whiskeysockets/baileys");
const Boom = require("@hapi/boom");
const fs = require("fs");

// ====== CONFIG ======
const SESSION_FOLDER = "auth_info_baileys";
const TEMPLATES_FILE = "./templates.json";
const PAIRING_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 5;

// GANTI DENGAN NOMOR WHATSAPP KAMU (contoh: 6281234567890)
const OWNER_NUMBER = "628xxxxxxxxxx";
// =====================

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ====== TEMPLATE STORAGE ======
let templates = new Map();

function loadTemplates() {
  if (!fs.existsSync(TEMPLATES_FILE)) {
    templates = new Map();
    return;
  }
  try {
    const raw = fs.readFileSync(TEMPLATES_FILE, "utf8");
    const obj = JSON.parse(raw);
    templates = new Map(Object.entries(obj));
    console.log(`[INFO] Loaded ${templates.size} template(s)`);
  } catch (e) {
    console.error("[ERROR] loadTemplates:", e.message);
    templates = new Map();
  }
}

function saveTemplates() {
  try {
    const obj = Object.fromEntries(templates);
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error("[ERROR] saveTemplates:", e.message);
  }
}

loadTemplates();

// ====== MESSAGE HANDLER ======
async function handleMessage(sock, msg) {
  if (!msg.message || msg.key.fromMe) return;

  const from = msg.key.remoteJid;
  let text = "";

  if (msg.message.conversation) text = msg.message.conversation;
  else if (msg.message.extendedTextMessage) text = msg.message.extendedTextMessage.text;
  else return;

  text = text.trim();

  // .help
  if (text === ".help") {
    const help = `
*WhatsApp Bot Commands*

.template <nama> <pesan>
  Simpan template pesan.

.addbutton <template> <id> <teks>
  Tambah 1 tombol ke template.

.listtemplate
  Lihat semua template yang tersimpan.

.test <template> <nomor>
  Kirim template + tombol ke nomor tujuan.

Contoh:
  .template selo Halo!
  .addbutton selo start Mulai
  .test selo 6283849080010
    `.trim();
    await sock.sendMessage(from, { text: help });
    return;
  }

  // .listtemplate
  if (text === ".listtemplate") {
    if (templates.size === 0) {
      await sock.sendMessage(from, { text: "Belum ada template." });
      return;
    }
    let out = "*Daftar Template:*\n";
    for (const [name] of templates.entries()) out += `- ${name}\n`;
    await sock.sendMessage(from, { text: out.trim() });
    return;
  }

  // .template <nama> <pesan>
  if (text.startsWith(".template ")) {
    const parts = text.split(" ");
    if (parts.length < 3) {
      await sock.sendMessage(from, { text: "Format: .template <nama> <pesan>" });
      return;
    }
    const [, name, ...rest] = parts;
    const messageText = rest.join(" ");
    templates.set(name, { text: messageText, buttons: [] });
    saveTemplates();
    await sock.sendMessage(from, { text: `Template "${name}" disimpan.` });
    return;
  }

  // .addbutton <template> <button_id> <button_text>
  if (text.startsWith(".addbutton ")) {
    const parts = text.split(" ");
    if (parts.length < 4) {
      await sock.sendMessage(from, { text: "Format: .addbutton <template> <button_id> <button_text>" });
      return;
    }
    const [, templateName, buttonId, ...rest] = parts;
    const buttonText = rest.join(" ");

    const tpl = templates.get(templateName);
    if (!tpl) {
      await sock.sendMessage(from, { text: `Template "${templateName}" tidak ditemukan.` });
      return;
    }

    tpl.buttons.push({
      buttonId,
      buttonText: { displayText: buttonText },
      type: 1
    });

    saveTemplates();
    await sock.sendMessage(from, { text: `Button ditambahkan ke template "${templateName}".` });
    return;
  }

  // .test <template> <nomor>
  if (text.startsWith(".test ")) {
    const parts = text.split(" ");
    if (parts.length < 3) {
      await sock.sendMessage(from, { text: "Format: .test <template> <nomor>" });
      return;
    }
    const [, templateName, numberRaw] = parts;

    if (!/^\d{10,15}$/.test(numberRaw)) {
      await sock.sendMessage(from, { text: "Format nomor tidak valid. Hanya angka, 10-15 digit." });
      return;
    }

    const tpl = templates.get(templateName);
    if (!tpl) {
      await sock.sendMessage(from, { text: `Template "${templateName}" tidak ditemukan.` });
      return;
    }

    const jid = `${numberRaw}@s.whatsapp.net`;

    const message = {
      text: tpl.text,
      footer: "WhatsApp Bot",
      buttons: tpl.buttons,
      headerType: 1
    };

    await sock.sendMessage(jid, message);
    await sock.sendMessage(from, { text: `Template "${templateName}" dikirim ke ${numberRaw}.` });
    return;
  }
}

// ====== MAIN CONNECT FUNCTION ======
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);

  const sock = makeWASocket({
    auth: state,
    // device: Google Chrome di Linux/Ubuntu
    browser: Browsers.chrome("Ubuntu"), // pattern yang direkomendasikan contoh resmi[web:75]
    printQRInTerminal: false
  });

  // pairing code kalau belum registered
  if (!sock.authState.creds.registered) {
    console.log(`Menunggu ${PAIRING_DELAY_MS / 1000} detik sebelum request pairing code...`);
    await delay(PAIRING_DELAY_MS);

    const number = OWNER_NUMBER;
    if (!/^\d{10,15}$/.test(number)) {
      console.error("OWNER_NUMBER tidak valid. Isi dengan angka saja, contoh: 6281234567890");
      process.exit(1);
    }

    try {
      const code = await sock.requestPairingCode(number);
      console.log("======================================");
      console.log(" Pairing Code:", code);
      console.log(" Buka WhatsApp HP:");
      console.log("  Pengaturan -> Perangkat tertaut -> Tautkan perangkat");
      console.log("  Pilih 'Masukkan kode', lalu ketik kode di atas");
      console.log("======================================");
    } catch (e) {
      console.error("Gagal meminta pairing code:", e);
      process.exit(1);
    }
  }

  let reconnectAttempts = 0;

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      console.log("✅ Bot WhatsApp terhubung!");
      reconnectAttempts = 0;
    } else if (connection === "close") {
      const err = lastDisconnect?.error;
      const statusCode = Boom.isBoom(err) ? err.output.statusCode : null;
      console.log("❌ Koneksi terputus:", statusCode, err?.message);

      if (statusCode === 401) {
        console.log("Sesi invalid/expired. Hapus folder auth_info_baileys dan jalankan lagi.");
        process.exit(1);
      }

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delayMs = Math.min(1000 * 2 ** reconnectAttempts, 30000);
        console.log(`Reconnect dalam ${delayMs / 1000} detik (percobaan ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        await sleep(delayMs);
        startBot().catch(console.error);
      } else {
        console.log("Gagal reconnect terlalu banyak. Keluar.");
        process.exit(1);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const m of messages) {
      try {
        await handleMessage(sock, m);
      } catch (e) {
        console.error("Error handleMessage:", e);
      }
    }
  });
}

startBot().catch((err) => console.error("StartBot error:", err));
