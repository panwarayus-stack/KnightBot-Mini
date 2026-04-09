process.env.PUPPETEER_SKIP_DOWNLOAD = 'true'

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} = require('@whiskeysockets/baileys')

const qrcode = require('qrcode-terminal')
const config = require('./config')
const handler = require('./handler')

// simple store
const store = {
  messages: new Map(),
  max: 20
}

// dedupe
const processed = new Set()
setInterval(() => processed.clear(), 5 * 60 * 1000)

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(`./${config.sessionName}`)

  const sock = makeWASocket({
    auth: state,
    browser: Browsers.macOS('Desktop'),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false
  })

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('Scan QR:')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      console.log('Bot Connected')
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

      console.log('Reconnecting...')
      if (shouldReconnect) startBot()
    }
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      if (!msg.message || !msg.key?.id) continue

      const id = msg.key.id
      if (processed.has(id)) continue
      processed.add(id)

      const from = msg.key.remoteJid
      if (!from || from.includes('@broadcast')) continue

      // store messages
      if (!store.messages.has(from)) {
        store.messages.set(from, new Map())
      }

      const chat = store.messages.get(from)
      chat.set(id, msg)

      if (chat.size > store.max) {
        const first = chat.keys().next().value
        chat.delete(first)
      }

      // main handler
      handler.handleMessage(sock, msg).catch(() => {})
    }
  })

  sock.ev.on('group-participants.update', async (update) => {
    handler.handleGroupUpdate(sock, update)
  })

  return sock
}

// start
console.log('Starting Bot...')
startBot()
