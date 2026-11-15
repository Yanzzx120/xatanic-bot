import fs from 'fs'
import path from 'path'
import { config } from './config.js'
import { JpmHistory, Product } from './database.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

const JPM_DEFAULT_DELAY = config.jpm?.delayMin || 8000
const JPM_DEFAULT_DELAY_MAX = config.jpm?.delayMax || 15000

export function baseMenu(prefix, type = 'all') {
    if (type === 'all') {
        return `\n│ 📣 *Menu JPM (Promosi)*\n│ ▫️ *${prefix}jpm <teks>* : Kirim promosi ke semua grup\n│ ▫️ *${prefix}stopjpm* : Hentikan JPM\n│\n│ 🛒 *Menu Toko*\n│ ▫️ *${prefix}listproduk* : Lihat produk\n│ ▫️ *${prefix}addproduk <nama>|<harga>* : Tambah produk\n│ ▫️ *${prefix}delproduk <id>* : Hapus produk\n│ ▫️ *${prefix}beli <id>* : Info pembelian\n`
    }
    return ''
}

export function attachBase(sock, { native = [] } = {}) {
    console.log('🔧 Memasang fitur BaseBot (JPM, Toko)...')

    sock.onCommand(['jpm', 'promosi'], async (ctx) => {
        if (!ctx.fromMe) {
            const sender = (ctx.senderNumber || '').replace(/\D/g, '')
            const owners = (config.owners || []).map((n) => String(n).replace(/\D/g, ''))
            if (!owners.length || !owners.includes(sender)) return ctx.reply('❌ Hanya Owner yang bisa JPM.')
        }

        if (global.__skyPush?.isRunning?.()) return ctx.reply('⚠️ Push Kontak sedang berjalan! Tunggu selesai.')

        const messageText = (ctx.query || '').trim() || (ctx.quoted?.text || ctx.quoted?.body || '').trim()
        if (!messageText) return ctx.reply(`❌ Pesan kosong! Contoh: \`${config.prefix}jpm Promo murah!\``)

        let groups = []
        try { groups = Object.values(await sock.groupFetchAllParticipating()) } catch (err) { return ctx.reply(`❌ Gagal ambil grup: ${err.message}`) }
        if (!groups.length) return ctx.reply('❌ Bot belum di grup manapun.')

        await ctx.reply(`🚀 *Memulai JPM...*\n📌 *Target:* ${groups.length} grup\n💬 *Pesan:* "${messageText.slice(0, 50)}..."`)

        if (!global.__push) global.__push = {}
        global.__push.running = true

        let success = 0, failed = 0
        const originChat = ctx.chat, statusKey = ctx.key

        try { await sock.sendMessage(originChat, { react: { text: '⏳', key: statusKey } }) } catch {}

        for (let i = 0; i < groups.length; i++) {
            if (global.__push?.running === false) break
            try {
                await sock.sendMessage(groups[i].id, { text: messageText })
                success++
            } catch { failed++ }
            
            if (i < groups.length - 1) {
                if (i % 5 === 0) {
                    try { await sock.sendMessage(originChat, { text: `📊 *Progress JPM:* ${i + 1}/${groups.length}\n✅ Sukses: ${success} | ❌ Gagal: ${failed}`, edit: statusKey }) } catch {}
                }
                await sleep(randomInt(JPM_DEFAULT_DELAY, JPM_DEFAULT_DELAY_MAX))
            }
        }

        if (global.__push) global.__push.running = false

        // Simpan ke MongoDB
        await JpmHistory.create({ message: messageText, success, failed, total: groups.length })

        try { await sock.sendMessage(originChat, { react: { text: '✅', key: statusKey } }) } catch {}
        await sock.sendMessage(originChat, { text: `✅ *JPM Selesai!*\n\n📊 Total: ${groups.length}\n✔️ Sukses: ${success}\n❌ Gagal: ${failed}` })
    })

    sock.onCommand(['stopjpm'], async (ctx) => {
        if (!ctx.fromMe) {
            const sender = (ctx.senderNumber || '').replace(/\D/g, '')
            const owners = (config.owners || []).map((n) => String(n).replace(/\D/g, ''))
            if (!owners.includes(sender)) return
        }
        if (global.__push?.running) { global.__push.running = false; return ctx.reply('🛑 Menghentikan JPM...') }
        return ctx.reply('❌ Tidak ada JPM berjalan.')
    })

    sock.onCommand(['listproduk', 'produk'], async (ctx) => {
        const products = await Product.find()
        if (!products.length) return ctx.reply(`🛒 *Toko Kosong*\nTambah: \`${config.prefix}addproduk <nama>|<harga>\``)
        let text = `🛒 *DAFTAR PRODUK* 🛒\n\n`
        products.forEach((p, i) => { text += `${i + 1}. *${p.name}*\n   💰 Rp ${Number(p.price).toLocaleString('id-ID')}\n   🆔 ID: \`${p.id}\`\n\n` })
        return ctx.reply(text.trim())
    })

    sock.onCommand(['addproduk'], async (ctx) => {
        if (!ctx.fromMe) {
            const sender = (ctx.senderNumber || '').replace(/\D/g, '')
            const owners = (config.owners || []).map((n) => String(n).replace(/\D/g, ''))
            if (!owners.includes(sender)) return
        }
        const query = (ctx.query || '').trim()
        if (!query.includes('|')) return ctx.reply(`❌ Format: \`${config.prefix}addproduk Nama Produk|15000\``)
        const [name, price] = query.split('|').map(s => s.trim())
        if (!name || !price || isNaN(Number(price))) return ctx.reply('❌ Nama atau harga tidak valid.')
        const newId = Date.now().toString().slice(-6)
        await Product.create({ id: newId, name, price: Number(price) })
        return ctx.reply(`✅ *Produk Ditambahkan!*\n📌 Nama: ${name}\n💰 Harga: Rp ${Number(price).toLocaleString('id-ID')}\n🆔 ID: \`${newId}\``)
    })

    sock.onCommand(['delproduk'], async (ctx) => {
        if (!ctx.fromMe) {
            const sender = (ctx.senderNumber || '').replace(/\D/g, '')
            const owners = (config.owners || []).map((n) => String(n).replace(/\D/g, ''))
            if (!owners.includes(sender)) return
        }
        const id = (ctx.query || '').trim()
        const deleted = await Product.findOneAndDelete({ id })
        if (!deleted) return ctx.reply(`❌ Produk ID \`${id}\` tidak ditemukan.`)
        return ctx.reply(`✅ Produk *${deleted.name}* dihapus.`)
    })

    sock.onCommand(['beli'], async (ctx) => {
        const id = (ctx.query || '').trim()
        const product = await Product.findOne({ id })
        if (!product) return ctx.reply(`❌ Produk ID \`${id}\` tidak ditemukan.`)
        const ownerNumber = config.ownerNumber || config.owners?.[0] || ''
        const waLink = ownerNumber ? `https://wa.me/${ownerNumber}?text=Halo,%20saya%20mau%20beli%20${encodeURIComponent(product.name)}` : '-'
        return ctx.reply(`🛒 *INFO PEMBELIAN*\n\n📦 Produk : *${product.name}*\n💰 Harga : *Rp ${Number(product.price).toLocaleString('id-ID')}*\n🆔 ID : \`${product.id}\`\n\n📱 *Hubungi Owner:*\n${waLink}`)
    })

    console.log('✅ Fitur BaseBot terpasang!')
}