import mongoose from 'mongoose'

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/xatanic'

export async function connectDB() {
    try {
        await mongoose.connect(MONGO_URI)
        console.log('✅ Terhubung ke MongoDB!')
    } catch (err) {
        console.error('❌ Gagal koneksi MongoDB:', err.message)
        process.exit(1)
    }
}

const ContactSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    fullName: String,
    givenName: String,
    familyName: String,
    savedAt: { type: Date, default: Date.now }
})
const JpmHistorySchema = new mongoose.Schema({
    message: String, success: Number, failed: Number, total: Number,
    time: { type: Date, default: Date.now }
})
const ProductSchema = new mongoose.Schema({
    id: { type: String, unique: true, required: true },
    name: String, price: Number,
    createdAt: { type: Date, default: Date.now }
})

export const Contact = mongoose.model('Contact', ContactSchema)
export const JpmHistory = mongoose.model('JpmHistory', JpmHistorySchema)
export const Product = mongoose.model('Product', ProductSchema)