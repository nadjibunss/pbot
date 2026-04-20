// bot.js
const { default: makeWASocket } = require("baileys-button");
const { useMultiFileAuthState } = require("baileys-button");
const Boom = require('@hapi/boom');

// Penyimpanan template dalam memori (nama => { text, buttons })
const templates = new Map();

// Handler untuk pesan masuk
async function handleMessage(sock, message) {
  if (!message.message || message.key.fromMe) return;
  
  const from = message.key.remoteJid;
  let text = "";
  
  if (message.message.conversation) text = message.message.conversation;
  else if (message.message.extendedTextMessage) text = message.message.extendedTextMessage.text;
  
  // Perintah .template <nama> <pesan>
  if (text.startsWith('.template ')) {
    const parts = text.split(' ');
    if (parts.length < 3) {
      await sock.sendMessage(from, { text: 'Format: .template <nama> <pesan>' });
      return;
    }
    const [, name, ...messageParts] = parts;
    const messageText = messageParts.join(' ');
    templates.set(name, { text: messageText, buttons: [] });
    await sock.sendMessage(from, { text: `Template "${name}" disimpan.` });
    return;
  }
  
  // Perintah .addbutton <template> <button_id> <button_text>
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
    await sock.sendMessage(from, { text: `Button ditambahkan ke template "${templateName}".` });
    return;
  }
  
  // Perintah .test <template> <nomor>
  if (text.startsWith('.test ')) {
    const parts = text.split(' ');
    if (parts.length < 3) {
      await sock.sendMessage(from, { text: 'Format: .test <template> <nomor>' });
      return;
    }
    const [, templateName, number] = parts;
    
    const template = templates.get(templateName);
    if (!template) {
      await sock.sendMessage(from, { text: `Template "${templateName}" tidak ditemukan.` });
      return;
    }
    
    // Format nomor ke JID WhatsApp (hanya angka + @s.whatsapp.net)
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

// Fungsi koneksi WhatsApp dengan pairing code
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false // Menggunakan pairing code, bukan QR
  });
  
  // Jika belum terdaftar, minta pairing code
  if (!sock.authState.creds.registered) {
    // Ganti dengan nomor WhatsApp Anda (tanpa +, -, spasi, atau tkurung)
    const number = '6285123533466'; // ISI NOMOR ANDA DISINI
    try {
      const code = await sock.requestPairingCode(number);
      console.log('Pairing code:', code);
      console.log('Silahkan masukkan kode ini di WhatsApp -> Terhubung perangkat -> Tambahkan perangkat');
    } catch (err) {
      console.error('Gagal meminta pairing code:', err);
      process.exit(1);
    }
  }
  
  // Event handler koneksi
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error as Boom)?.output?.statusCode !== Boom.notFound;
      console.log('Koneksi terputus karena:', lastDisconnect.error, ', reconnect:', shouldReconnect);
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') {
      console.log('Bot WhatsApp berhasil terhubung!');
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
