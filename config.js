export const config = {
    botName: 'xᴀᴛᴀɴɪᴄ',
    botVersion: '2.0.0',
    prefix: '.',
    owners: ['6285842176747'], // GANTI DENGAN NOMOR WA ANDA (62xxx)
    ownerName: 'Yanzzii',
    ownerNumber: '6285842176747',
    devName: 'Yanzzzx',
    devNumber: '6285842176747',
    sessionFolder: './session',
    logLevel: 'silent',
    pairingCode: true,
    botPhoneNumber: '6281234567890', // GANTI DENGAN NOMOR BOT
    antiBan: { enabled: true, minDelayMs: 800, maxDelayMs: 1500, simulatePresence: true },
    rateLimit: { max: 10, windowMs: 10000, cooldownMs: 15000 },
    pushkontak: {
        enabled: true,
        contactFirstName: 'Contoh',
        contactLastName: 'Buyer',
        delayMin: 5000, delayMax: 10000,
        minDelay: 1000, maxDelay: 60000,
        batchBreak: true,
        batchSize: [30, 50],
        batchRest: [40000, 60000],
        typing: [1500, 2500]
    },
    jpm: { delayMin: 8000, delayMax: 15000 }
};