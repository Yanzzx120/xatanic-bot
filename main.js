import express from 'express'
import cors from 'cors'
import si from 'systeminformation'
import os from 'os'
import path from 'path'
import fs from 'fs'
import session from 'express-session'
import cookieParser from 'cookie-parser'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import { connectDB } from './database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const API_PORT = 3000
const DASHBOARD_USER = process.env.DASH_USER || 'admin'
const DASHBOARD_PASS = process.env.DASH_PASS || 'xatanic123'

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24))
    const h = Math.floor((seconds % (3600 * 24)) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    return `${d > 0 ? d + 'h ' : ''}${h}j ${m}m ${s}s`
}

function startAPI() {
    const app = express()
    app.use(cors())
    app.use(express.json())
    app.use(cookieParser())
    app.use(session({
        secret: 'XatanicSuperSecretKey-123!',
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 24 * 60 * 60 * 1000, secure: false }
    }))

    app.post('/api/login', (req, res) => {
        const { username, password } = req.body
        if (username === DASHBOARD_USER && password === DASHBOARD_PASS) {
            req.session.loggedIn = true
            res.json({ success: true })
        } else {
            res.status(401).json({ success: false, message: 'Username atau Password salah!' })
        }
    })

    app.get('/api/logout', (req, res) => {
        req.session.destroy()
        res.redirect('/login.html')
    })

    const requireAuth = (req, res, next) => {
        if (req.session.loggedIn) next()
        else res.redirect('/login.html')
    }

    app.use(express.static(path.resolve(__dirname, 'public')))

    app.get('/', requireAuth, (req, res) => {
        res.sendFile(path.resolve(__dirname, 'public', 'index.html'))
    })

    app.get('/api/status', requireAuth, async (req, res) => {
        try {
            const mem = await si.mem()
            const ramPercent = Math.round((mem.active / mem.total) * 100)
            const battery = await si.battery()
            const batPercent = battery.hasBattery ? battery.percent : 100
            const fsSize = await si.fsSize()
            let storagePercent = 0
            if (fsSize.length > 0) storagePercent = Math.round(fsSize[0].use)
            const osInfo = await si.osInfo()
            const deviceName = `${osInfo.manufacturer} ${osInfo.model}`.trim() || 'Server Host'
            const isPushRunning = global.__skyPush?.isRunning?.() || false

            res.json({
                status: 'success',
                data: {
                    battery: batPercent, ram: ramPercent, storage: storagePercent,
                    device: `${deviceName} (${osInfo.platform} ${osInfo.arch})`,
                    network: 'Connected', uptime: formatUptime(os.uptime()),
                    time: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                    session: isPushRunning ? 'Push Kontak Running' : 'Idle',
                    botName: config.botName, botVersion: config.botVersion
                }
            })
        } catch (err) { res.status(500).json({ error: err.message }) }
    })

    app.listen(API_PORT, '0.0.0.0', () => {
        console.log(`✅ API Dashboard berjalan di http://localhost:${API_PORT}`)
    })
}

async function main() {
    console.log('════════════════════════════════════════')
    console.log(`🚀 Memulai ${config.botName} v${config.botVersion}`)
    console.log('════════════════════════════════════════')

    const dbDir = path.resolve(__dirname, 'db')
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })
    const publicDir = path.resolve(__dirname, 'public')
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true })

    startAPI()
    await connectDB()

    try {
        console.log('📱 Menjalankan Bot WhatsApp...')
        await import('./index.js')
    } catch (err) {
        console.error('❌ Gagal menjalankan bot:', err.message)
    }
}

process.on('SIGINT', () => { console.log('\n🛑 Bot dihentikan.'); process.exit(0) })

main().catch(err => { console.error('❌ Fatal Error:', err); process.exit(1) })