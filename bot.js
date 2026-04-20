// bot.js
const { default: makeWASocket } = require("baileys-button");
const { useMultiFileAuthState } = require("baileys-button");
const Boom = require('@hapi/boom');
const fs = require('fs');

// ---------- Konfigurasi ----------
const TEMPLATES_FILE = './templates.json';
const PAIRING_DELAY_MS = 3000; // 3 detik sebelum meminta pairing code
const MAX_RECONNECT_ATTEMPTS = 5;
// ---------- End Konfigurasi ----------

// Fungsi helper untuk delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Load template dari file jika ada (penyimpanan persisten)
let templates = new Map();
if (fs.existsSync(TEMPLATES_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
    for (const [name, value] of Object.entries(data)) {
      templates.set(name, value);
    }
    console.log(`[INFO] Loaded ${templates.size} template(s) from ${TEMPLATES_FILE}`);
  } catch (err) {
    console.error('[ERROR] Gagal membaca file template:', err);
    templates = new Map(); // fallback ke Map kosong
  }
}

// Simpan template ke file (menjaga persisten)
const saveTemplates = () => {
  try {
    const obj = {};
    templates.forEach((value, key) => {
      obj[key] = value;
    });
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error('[ERROR] Gagal menyimpan file template:', err);
  }
};

// Handler untuk pesan masuk
async function handleMessage(sock, message) {
  if (!message.message || message.key.fromMe) return;

  const from = message.key.remoteJid;
  let text = "";

  if (message.message.conversation) text = message.message.conversation;
  else if (message.message.extendedTextMessage) text = message.message.extendedTextMessage.text;

  // ---------- .help ----------
  if (text === '.help') {
    const helpText = `
*WhatsApp Bot Help*

Template Management:
.template <nama> <pesan>   - Simpan template pesan
.addbutton <template> <id> <teks> - Tambahkan tombol ke template
.listtemplate             - Lihat semua template

Testing:
.test <template> <nomor>  - Kirim template dengan tombol ke nomor

Contoh:
.template selo Halo!
.addbutton selo start Mulai
.test selo 6283849080010
    `.trim();
    await sock.sendMessage(from, { text: helpText });
    return;
  }

  // ---------- .listtemplate ----------
  if (text === '.listtemplate') {
    if (templates.size === 0) {
      await sock.sendMessage(from, { text: 'Belum ada template yang disimpan.' });
      return;
    }
    let list = '*Daftar Template:*\n';
    for (const [name] of templates) {
      list += `- ${name}\n`;
    }
    await sock.sendMessage(from, { text: list.trim() });
    return;
  }

  // ---------- .template <nama> <pesan> ----------
  if (text.startsWith('.template ')) {
    const parts = text.split(' ');
    if (parts.length < 3) {
      await sock.sendMessage(from, { text: 'Format: .template <nama> <pesan>' });
      return;
    }
    const [, name, ...messageParts] = parts;
    const messageText = messageParts.join(' ');
    templates.set(name, { text: messageText, buttons: [] });
    saveTemplates(); // simpan ke file
    await sock.sendMessage(from, { text: `Template "${name}" disimpan.` });
    return;
  }

  // ---------- .addbutton <template> <button_id> <button_text> ----------
  if (text.startsWith('.addbutton ')) {
    const parts = text.split(' ');
    if (parts.length < 4) {
      await sock.sendMessage(from, { text: 'Format: .addbutton <template> <button_id> <button_text>' });
      return;
    }
    const [, templateName, buttonId, ...buttonTextParts] = parts;
    const buttonText = buttonTextParts.join(' ');

    const template = templates.get(templateName);
    if (!template) {
      await sock.sendMessage(from, { text: `Template "${templateName}" tidak ditemukan.` });
      return;
    }

    template.buttons.push({
      buttonId: buttonId,
      buttonText: { displayText: buttonText },
      type: 1
    });
    saveTemplates(); // simpan perubahan
    await sock.sendMessage(from, { text: `Button ditambahkan ke template "${templateName}".` });
    return;
  }

  // ---------- .test <template> <nomor> ----------
  if (text.startsWith('.test ')) {
    const parts = text.trim().split(' ');
    if (parts.length < 3) {
      await sock.sendMessage(from, { text: 'Format: .test <template> <nomor>' });
      return;
    }
    const [, templateName, number] = parts;

    // Validasi nomor: hanya angka, panjang 10-15 digit
    if (!/^\d{10,15}$/.test(number)) {
      await sock.sendMessage(from, { text: 'Format nomor tidak valid. Hanya angka, 10-15 digit.' });
      return;
    }

    const template = templates.get(templateName);
    if (!template) {
      await sock.sendMessage(from, { text: `Template "${templateName}" tidak ditemukan.` });
      return;
    }

    // Format nomor ke JID WhatsApp
    const cleanNumber = number.replace(/[^\d]/g, '');
    const jid = `${cleanNumber}@s.whatsapp.net`;

    // Kirim pesan dengan tombol
    await sock.sendMessage(jid, {
      text: template.text,
      footer: "WhatsApp Bot",
      buttons: template.buttons,
      headerType: 1,
      viewOnce: false
    });

    await sock.sendMessage(from, { text: `Pesan dari template "${templateName}" dikirim ke ${number}.` });
    return;
  }
}

// Fungsi koneksi WhatsApp dengan pairing code + delay
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false // Menggunakan pairing code, bukan QR
  });

  // Jika belum terdaftar, minta pairing code dengan delay
  if (!sock.authState.creds.registered) {
    await delay(PAIRING_DELAY_MS); // <-- Delay sebelum meminta pairing code

    // Ganti dengan nomor WhatsApp Anda (tanpa +, -, spasi, atau tkurung)
    const number = '628xxxxxxxxxx'; // ISI NOMOR ANDA DISINI
    try {
      const code = await sock.requestPairingCode(number);
      console.log('Pairing code:', code);
      console.log('Silahkan masukkan kode ini di WhatsApp -> Terhubung perangkat -> Tambahkan perangkat');
    } catch (err) {
      console.error('Gagal meminta pairing code:', err);
      process.exit(1);
    }
  }

  // Event handler koneksi dengan reconnection cerdas
  let reconnectAttempts = 0;
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const error = lastDisconnect.error;
      console.log(`Koneksi terputus: ${error}`);

      // Jika bukan karena tidak ditemukan (404) dan masih di bawah batas, coba reconnect
      if (error?.output?.statusCode !== 404 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delayTime = Math.min(1000 * 2 ** reconnectAttempts, 30000); // Exponential backoff: 2s,4s,8s... max 30s
        console.log(`Mencoba reconnect dalam ${delayTime/1000} detik... (percobaan ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        await delay(delayTime);
        connectToWhatsApp(); // Rekursi: buat koneksi baru
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log('Maksimal percobaan reconnect tercapai. Bot akan berhenti.');
        process.exit(1);
      }
    } else if (connection === 'open') {
      console.log('Bot WhatsApp berhasil terhubung!');
      reconnectAttempts = 0; // Reset counter saat berhasil koneksi
    }
  });

  // Event handler pesan masuk
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages) {
      await handleMessage(sock, message);
    }
  });

  // Simpan kredensial saat diperbarui
  sock.ev.on('creds.update', saveCreds);
}

// Jalankan bot
connectToWhatsApp().catch(console.error);
