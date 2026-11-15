import fs from 'fs'
import path from 'path'
import pino from 'pino'
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, jidNormalizedUser, lidCache
} from '@whiskeysockets/baileys'
import { config } from './config.js'
import { attachBase, getBotMode, baseMenu } from './base.js'
import { Contact } from './database.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

// ==========================================
// STATE & LOCK MANAGEMENT
// ==========================================
const STATE_PATH = path.resolve('./db/state.json')
const CONTACT_CONFIG_PATH = path.resolve('./db/contact_config.json')
const PUSH_CONFIG_PATH = path.resolve('./db/push_config.json')

const pk = () => config.pushkontak || {}
const rangeOf = (arr, dflt) => {
  const a = Array.isArray(arr) && arr.length >= 2 ? arr.slice(0, 2).map(Number) : dflt
  return a[0] <= a[1] ? a : [a[1], a[0]]
}
const defaultPushConfig = () => ({
  delayMin: Number(pk().delayMin) || 5000,
  delayMax: Number(pk().delayMax) || 10000,
  batchBreak: pk().batchBreak !== false
})

let isPushRunning = false
let stopRequested = false

const PushLock = {
    _active: false,
    acquire() { if (this._active) return false; this._active = true; return true },
    release() { this._active = false },
    isBusy() { return this._active || isPushRunning || !!loadState()?.isActive || !!global.__push?.running }
}

function loadState() { try { if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) } catch {} return null }
function saveState(state) { try { const dir = path.dirname(STATE_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8') } catch (err) {} }
function clearState() { saveState({ isActive: false }) }

function loadContactConfig() {
  let file = {}
  try { if (fs.existsSync(CONTACT_CONFIG_PATH)) file = JSON.parse(fs.readFileSync(CONTACT_CONFIG_PATH, 'utf8')) } catch {}
  return { firstName: pk().contactFirstName ?? 'Contoh', lastName: pk().contactLastName ?? 'Member', lastIndex: 0, ...file }
}
function saveContactConfig(data) { try { const dir = path.dirname(CONTACT_CONFIG_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(CONTACT_CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8') } catch (err) {} }

function loadPushConfig() {
  let cfg = {}
  try { if (fs.existsSync(PUSH_CONFIG_PATH)) cfg = JSON.parse(fs.readFileSync(PUSH_CONFIG_PATH, 'utf8')) } catch {}
  const def = defaultPushConfig()
  const lo = Number(pk().minDelay) || 1000
  const hi = Number(pk().maxDelay) || 60000
  const merged = { ...def, ...cfg }
  merged.delayMin = Math.max(lo, Math.min(hi, Number(merged.delayMin) || def.delayMin))
  merged.delayMax = Math.max(merged.delayMin, Math.min(hi, Number(merged.delayMax) || def.delayMax))
  merged.batchBreak = merged.batchBreak !== false
  return merged
}
function savePushConfig(data) { try { const dir = path.dirname(PUSH_CONFIG_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(PUSH_CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8') } catch (err) {} }

global.__skyPush = { load: loadPushConfig, isRunning: () => PushLock.isBusy() }

const fmtSec = (ms) => `${(ms / 1000).toFixed(1).replace('.0', '')}`
const fmtDelay = (cfg) => cfg.delayMin === cfg.delayMax ? `${fmtSec(cfg.delayMin)} detik` : `${fmtSec(cfg.delayMin)} - ${fmtSec(cfg.delayMax)} detik`

async function sleepOrStop(ms) {
  const end = Date.now() + ms
  while (Date.now() < end && !stopRequested) { await sleep(Math.min(500, Math.max(0, end - Date.now()))) }
}

// ==========================================
// HELPER PERMISSIONS
// ==========================================
const ownerList = () => (config.owners || []).map((n) => String(n).replace(/\D/g, '')).filter(Boolean)

function isAllowedAccess(ctx) {
  const mode = getBotMode()
  const isBot = ctx.fromMe === true
  const sender = (ctx.senderNumber || '').replace(/\D/g, '')
  const isOwnerUser = isBot || (sender && ownerList().includes(sender))
  if (mode === 'self') return isBot
  if (mode === 'owner') return isOwnerUser
  return true
}

function isOwner(ctx) {
  const isBot = ctx.fromMe === true
  if (isBot) return true
  const owners = ownerList()
  if (!owners.length) return false
  const sender = (ctx.senderNumber || '').replace(/\D/g, '')
  return owners.includes(sender)
}

function formatUptime() {
  const uptimeSec = Math.floor(process.uptime())
  const days = Math.floor(uptimeSec / 86400)
  const hours = Math.floor((uptimeSec % 86400) / 3600)
  const minutes = Math.floor((uptimeSec % 3600) / 60)
  const seconds = uptimeSec % 60
  return `${days > 0 ? `${days}h ` : ''}${hours}j ${minutes}m ${seconds}s`
}

function getParticipantPN(p) {
  if (p.phoneNumber) { const clean = jidNormalizedUser(p.phoneNumber).split('@')[0].replace(/\D/g, ''); if (clean) return clean }
  const idNormalized = jidNormalizedUser(p.id || '')
  if (idNormalized.endsWith('@s.whatsapp.net')) { const clean = idNormalized.split('@')[0].replace(/\D/g, ''); if (clean) return clean }
  const resolved = lidCache.resolveToPN(p.id)
  if (resolved && resolved.endsWith('@s.whatsapp.net')) { const clean = jidNormalizedUser(resolved).split('@')[0].replace(/\D/g, ''); if (clean) return clean }
  return ''
}

function getGroupOwnerPN(meta) {
  if (meta.ownerPn) { const clean = jidNormalizedUser(meta.ownerPn).split('@')[0].replace(/\D/g, ''); if (clean) return clean }
  if (meta.owner) {
    const idNorm = jidNormalizedUser(meta.owner)
    if (idNorm.endsWith('@s.whatsapp.net')) { const clean = idNorm.split('@')[0].replace(/\D/g, ''); if (clean) return clean }
    const resolved = lidCache.resolveToPN(meta.owner)
    if (resolved && resolved.endsWith('@s.whatsapp.net')) { const clean = jidNormalizedUser(resolved).split('@')[0].replace(/\D/g, ''); if (clean) return clean }
  }
  const superadmin = meta.participants?.find((p) => p.admin === 'superadmin')
  if (superadmin) { const pn = getParticipantPN(superadmin); if (pn) return pn }
  return ''
}

function extractTargetParticipants(meta, sock) {
  const botJid = jidNormalizedUser(sock.user?.id || '')
  const botNum = (botJid.split('@')[0] || '').replace(/\D/g, '')
  const botLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : ''
  const targets = []
  const seen = new Set()
  for (const p of meta.participants || []) {
    const rawId = p.id || ''
    const idNormalized = jidNormalizedUser(rawId)
    const pn = getParticipantPN(p)
    if (pn && botNum && pn === botNum) continue
    if (rawId && botLid && idNormalized === botLid) continue
    if (idNormalized === botJid) continue
    const targetJid = pn ? `${pn}@s.whatsapp.net` : idNormalized
    if (!targetJid || seen.has(targetJid)) continue
    seen.add(targetJid)
    targets.push({ jid: targetJid, pn: pn || '', rawId })
  }
  return targets
}

function renderProgressBar(current, total, barLength = 10) {
  const progress = total > 0 ? Math.min(1, current / total) : 0
  const filled = Math.round(progress * barLength)
  return '█'.repeat(filled) + '░'.repeat(barLength - filled)
}

function formatRealtimeStatusText({ groupSubject, messageText, current, total, success, failed, statusLabel }) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0
  const bar = renderProgressBar(current, total)
  const remaining = Math.max(0, total - current)
  const preview = messageText.length > 50 ? `${messageText.slice(0, 50)}...` : messageText
  return `📊 *STATUS PUSHKONTAK REALTIME* 📊\n\n📌 *Target Grup* : ${groupSubject}\n💬 *Pesan* : "${preview}"\n\n📈 *Progres Pengiriman:*\n${bar} ${percent}%\n\n▫️ *Terkirim* : ${current} / ${total}\n▫️ *Berhasil* : ✅ ${success}\n▫️ *Gagal*    : ❌ ${failed}\n▫️ *Tersisa*  : ⏳ ${remaining}\n▫️ *Status*   : ${statusLabel}\n\n_Pesan status ini diperbarui otomatis secara realtime._`
}

// ==========================================
// EXECUTE PUSH LOOP (MongoDB + Atomic Lock)
// ==========================================
async function executePushLoop(sock, state, isResuming = false) {
  if (isPushRunning && !isResuming) return
  isPushRunning = true
  stopRequested = false

  const { targetGroupId, groupSubject, messageText, originChat, targets } = state
  let { currentIndex = 0, success = 0, failed = 0 } = state
  let processed = currentIndex
  let stopped = false
  let batchCount = 0
  let nextBatchLimit = randomInt(...rangeOf(pk().batchSize, [30, 50]))
  let statusMessageKey = state.statusMessageKey || null

  if (!statusMessageKey) {
    try {
      const sent = await sock.sendMessage(originChat, { text: formatRealtimeStatusText({ groupSubject, messageText, current: currentIndex, total: targets.length, success, failed, statusLabel: '🚀 Menyiapkan pengiriman...' }) })
      statusMessageKey = sent?.key || null
      state.statusMessageKey = statusMessageKey
      saveState(state)
    } catch (err) {}
  }

  try {
    for (let i = currentIndex; i < targets.length; i++) {
      if (stopRequested) { stopped = true; break }
      const pushCfg = loadPushConfig()
      state.currentIndex = i; state.success = success; state.failed = failed; state.updatedAt = Date.now(); saveState(state)

      const target = targets[i]
      const targetJid = target.jid || target
      const pnDigits = target.pn || (targetJid.endsWith('@s.whatsapp.net') ? targetJid.split('@')[0].replace(/\D/g, '') : '')

      // --- MONGODB CHECK ---
      const existingContact = pnDigits ? await Contact.findOne({ number: pnDigits }) : null
      let contactInfo = null

      if (existingContact) {
        contactInfo = existingContact.toObject()
      } else {
        const contactCfg = loadContactConfig()
        const nextNum = (contactCfg.lastIndex || 0) + 1
        contactCfg.lastIndex = nextNum
        saveContactConfig(contactCfg)
        const givenName = contactCfg.lastName ? `${contactCfg.firstName} ${contactCfg.lastName}` : contactCfg.firstName
        contactInfo = { fullName: `${givenName} #${nextNum}`, givenName, familyName: `#${nextNum}`, number: pnDigits || targetJid }
        try { if (typeof sock.saveContact === 'function') await sock.saveContact(targetJid, contactInfo.fullName) } catch {}
        
        // --- SAVE MONGODB ---
        if (pnDigits) {
            await Contact.create({ number: pnDigits, fullName: contactInfo.fullName, givenName: contactInfo.givenName, familyName: contactInfo.familyName })
        }
      }

      const typingTime = randomInt(...rangeOf(pk().typing, [1500, 2000]))
      try { await sock.sendPresenceUpdate('composing', targetJid) } catch {}
      await sleep(typingTime)
      try { await sock.sendPresenceUpdate('paused', targetJid) } catch {}

      try { await sock.sendMessage(targetJid, { text: messageText }); success++ } catch { failed++ }

      batchCount++
      processed = i + 1

      if (statusMessageKey) {
        const updateText = formatRealtimeStatusText({ groupSubject, messageText, current: i + 1, total: targets.length, success, failed, statusLabel: '🚀 Sedang mengirimkan...' })
        try { await sock.sendMessage(originChat, { text: updateText, edit: statusMessageKey }) } catch {}
      }

      if (pushCfg.batchBreak && batchCount >= nextBatchLimit && i < targets.length - 1) {
        const cooldownMs = randomInt(...rangeOf(pk().batchRest, [40000, 60000]))
        batchCount = 0; nextBatchLimit = randomInt(...rangeOf(pk().batchSize, [30, 50]))
        if (statusMessageKey) {
          const cooldownText = formatRealtimeStatusText({ groupSubject, messageText, current: i + 1, total: targets.length, success, failed, statusLabel: `☕ Cooldown Batch (${Math.round(cooldownMs / 1000)}s)...` })
          try { await sock.sendMessage(originChat, { text: cooldownText, edit: statusMessageKey }) } catch {}
        }
        await sleepOrStop(cooldownMs)
      } else if (i < targets.length - 1) {
        const liveCfg = loadPushConfig()
        await sleepOrStop(randomInt(liveCfg.delayMin, liveCfg.delayMax))
      }
    }

    isPushRunning = false; stopRequested = false; clearState()

    if (statusMessageKey) {
      const doneText = formatRealtimeStatusText({ groupSubject, messageText, current: stopped ? processed : targets.length, total: targets.length, success, failed, statusLabel: stopped ? '🛑 Dihentikan oleh pengguna' : '🎉 Selesai 100%!' })
      try { await sock.sendMessage(originChat, { text: doneText, edit: statusMessageKey }) } catch {}
    }

    await sock.sendMessage(originChat, { text: `${stopped ? '🛑 *Push Kontak Dihentikan!*' : '✅ *Push Kontak Selesai!*'}\n\n📌 *Grup Target:* ${groupSubject}\n✔️ *Berhasil:* ${success}\n❌ *Gagal:* ${failed}\n📤 *Terproses:* ${processed} / ${targets.length}` })

  } catch (err) {
    console.error('Error push loop:', err)
    isPushRunning = false; stopRequested = false
  } finally {
    PushLock.release()
  }
}

// ==========================================
// START BOT & COMMANDS
// ==========================================
async function startBot() {
  console.log('🚀 Menyiapkan Pushkon Bot...')
  const { state, saveCreds } = await useMultiFileAuthState(config.sessionFolder)
  const sock = makeWASocket({
    auth: state, logger: pino({ level: config.logLevel }), dynamicLogger: false,
    promptPhoneNumber: true, phoneNumber: config.botPhoneNumber || undefined,
    defaultPairingCode: config.pairingCode, autoTyping: true,
    antiBan: config.antiBan, rateLimit: config.rateLimit
  })

  const nativeCommands = []
  const registerCommand = sock.onCommand.bind(sock)
  sock.onCommand = (names, handler, ...rest) => { nativeCommands.push(...[].concat(names)); return registerCommand(names, handler, ...rest) }

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, pairingCode }) => {
    if (pairingCode) console.log(`\n🔑 Pairing Code WhatsApp: ${pairingCode}\n👉 HP > Perangkat Tertaut > Tautkan dengan Kode Telepon\n`)
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      if (statusCode !== DisconnectReason.loggedOut) startBot()
    } else if (connection === 'open') {
      console.log(`✅ ${config.botName} Terhubung ke WhatsApp!`)
      const saved = loadState()
      if (saved && saved.isActive && saved.targets && saved.currentIndex < saved.targets.length) {
        executePushLoop(sock, saved, true).catch(console.error)
      }
    }
  })

  // .menu
  sock.onCommand(['menu', 'help', 'start'], async (ctx) => {
    if (!isAllowedAccess(ctx)) return
    const senderNum = (ctx.senderNumber || ctx.sender?.split('@')[0] || '').replace(/\D/g, '') || 'User'
    const bannerPath = path.resolve('./lib/image/banner.png')
    const hasBanner = fs.existsSync(bannerPath)
    const bannerBuffer = hasBanner ? fs.readFileSync(bannerPath) : null
    const menuCaption = `\n╭───❐ *\`𝙃𝘼𝙄𝙄\`* ❐───✧\n├ 👋 *${senderNum}*\n╰─────────────────────✧\n\n╭───❐ *\`𝘼𝘽𝙊𝙐𝙏 - 𝙓𝘼𝙏𝘼𝙉𝙄𝘾\`* ❐───✧\n├ 🛠️ *Creator : 𝘆𝗮𝗻𝗙𝗫*\n├ 📜 *BotName : xᴀᴛᴀɴɪᴄ*\n├ ⚙️ *Version : ${config.botVersion}*\n├ ⏱️ *Runtime : ${formatUptime()}*\n├ 💻 *Mode : ${getBotMode().toUpperCase()}*\n╰─────────────────────✧`
    
    const listSections = [{ title: '📋 Navigasi Menu', rows: [
        { id: `${config.prefix}allmenu`, title: '📜 AllMenu', description: 'Menampilkan Semua Fitur' },
        { id: `${config.prefix}menujpm`, title: '📣 Menu Jpm', description: 'Fitur Jpm & Broadcast' },
        { id: `${config.prefix}menutoko`, title: '🛒 Store Menu', description: 'Store & Jasa Dev' },
        { id: `${config.prefix}owner`, title: '✨ Owner', description: 'Developer Script' }
    ]}]

    try {
      await sock.sendListMenu(ctx.chat, { title: `⚡ ${config.botName} ⚡`, subtitle: 'Whatsapp Engine', text: menuCaption, footer: config.botName, buttonText: '🔘 All Fitur', image: bannerBuffer || undefined, mentions: [ctx.sender], sections: listSections }, { quoted: ctx.msg })
    } catch {
      if (bannerBuffer) await sock.sendMessage(ctx.chat, { image: bannerBuffer, caption: menuCaption, mentions: [ctx.sender] }, { quoted: ctx.msg })
      else await ctx.reply(menuCaption, { mentions: [ctx.sender] })
    }
  })

  // .pushkontak
  sock.onCommand(['pushkontak', 'pushkon'], async (ctx) => {
    if (!isAllowedAccess(ctx) || !isOwner(ctx)) return
    if (pk().enabled === false) return ctx.reply('❌ Fitur pushkontak dimatikan.')
    
    const senderNumber = (ctx.senderNumber || ctx.sender?.split('@')[0] || '').replace(/\D/g, '')
    const targetOutputChat = ctx.isGroup ? `${senderNumber}@s.whatsapp.net` : ctx.chat

    if (ctx.isGroup) {
      try { await sock.sendMessage(ctx.chat, { react: { text: '⏳', key: ctx.key } }) } catch {}
      try { await sock.sendMessage(ctx.chat, { delete: ctx.key }) } catch {}
    }

    if (PushLock.isBusy() || !PushLock.acquire()) return sock.sendMessage(targetOutputChat, { text: '⚠️ Push Kontak sedang berjalan!' })

    let messageText = (ctx.query || '').trim() || (ctx.quoted?.text || ctx.quoted?.body || '').trim()
    if (!messageText) {
        PushLock.release()
        return sock.sendMessage(targetOutputChat, { text: `❌ Pesan kosong! Contoh: \`${config.prefix}pushkontak Halo kak\`` })
    }

    if (ctx.isGroup) {
      try {
        const meta = await sock.groupMetadata(ctx.chat)
        const targets = extractTargetParticipants(meta, sock)
        if (!targets.length) { PushLock.release(); return sock.sendMessage(targetOutputChat, { text: `❌ Tidak ada target.` }) }
        const stateData = { isActive: true, type: 'pushkontak', targetGroupId: ctx.chat, groupSubject: meta.subject || 'Grup', messageText, originChat: targetOutputChat, currentIndex: 0, targets, success: 0, failed: 0, statusMessageKey: null, updatedAt: Date.now() }
        await sock.sendMessage(targetOutputChat, { text: `🚀 *Memulai Push Kontak...*\n\n📌 *Grup:* ${meta.subject}\n👥 *Target:* ${targets.length} member` })
        executePushLoop(sock, stateData)
      } catch (err) { PushLock.release(); await sock.sendMessage(targetOutputChat, { text: `❌ Error: ${err.message}` }) }
      return
    }
  })

  // .stoppush
  sock.onCommand(['stoppush', 'stoppushkontak'], async (ctx) => {
    if (!isAllowedAccess(ctx) || !isOwner(ctx)) return
    if (isPushRunning) { stopRequested = true; return ctx.reply('🛑 Menghentikan push kontak...') }
    if (loadState()?.isActive) { clearState(); return ctx.reply('🧹 Sesi push dibersihkan.') }
    return ctx.reply('❌ Push tidak berjalan.')
  })

  // .ping
  sock.onCommand(['ping'], async (ctx) => {
    if (!isAllowedAccess(ctx)) return
    const start = Date.now()
    await ctx.reply(`🏓 *Pong!*\n⏱️ Latency: ${Date.now() - start}ms\n⏱️ Uptime: ${formatUptime()}\n⚡ Engine: Baileys`)
  })

  attachBase(sock, { native: nativeCommands })
}

startBot().catch((err) => { console.error('Fatal Bot Error:', err) })