const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initialize() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'admin',
                phone_number TEXT,
                otp TEXT,
                otp_expires BIGINT
            );

            CREATE TABLE IF NOT EXISTS borrowers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                phone TEXT,
                notes TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                date_given TEXT,
                amount_given NUMERIC,
                percentage NUMERIC,
                frequency TEXT,
                installment_amount NUMERIC DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS repayments (
                id TEXT PRIMARY KEY,
                transaction_id TEXT REFERENCES transactions(id) ON DELETE CASCADE,
                date TEXT,
                amount NUMERIC
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                type TEXT,
                message TEXT,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Database tables initialized successfully');
    } catch (err) {
        console.error('Error initializing database:', err);
    } finally {
        client.release();
    }
}

async function query(text, params) {
    const result = await pool.query(text, params);
    return result;
}

module.exports = { initialize, query, pool };
