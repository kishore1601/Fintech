require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-change-me';

// Initialize Admin User if not exists
async function initializeDefaultUser() {
    const users = db.get('users');
    let admin = users.find(u => u.username === 'admin');

    if (!admin) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        db.add('users', {
            id: 'admin',
            username: 'admin',
            password: hashedPassword,
            role: 'admin',
            phoneNumber: '1234567890'
        });
        console.log('Default admin user created: admin / admin123 / 1234567890');
    } else if (!admin.phoneNumber) {
        // Migration: Add phone number to existing admin
        db.update('users', admin.id, { phoneNumber: '1234567890' });
        console.log('Updated default admin user with phone number: 1234567890');
    }
}
initializeDefaultUser();

// Middleware: Authenticate Token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// Routes

// POST /login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = db.find('users', u => u.username === username);

    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token, user: { username: user.username, phoneNumber: user.phoneNumber } });
});

// POST /auth/forgot-password - Generate OTP
app.post('/auth/forgot-password', (req, res) => {
    const { username } = req.body;
    const user = db.find('users', u => u.username === username);

    if (!user) {
        // Generic message for security, but for demo we can be explicit or just fail
        return res.status(404).json({ error: 'User not found' });
    }

    if (!user.phoneNumber) {
        return res.status(400).json({ error: 'No phone number linked to this account.' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Save OTP to DB (or memory store with expiration) - Simple DB approach
    // We'll store it on the user object for simplicity in this demo
    db.update('users', user.id, {
        otp: otp,
        otpExpires: Date.now() + 300000 // 5 mins 
    });

    // MOCK SMS SENDING
    // console.log(`[MOCK SMS] OTP for ${username} (${user.phoneNumber}): ${otp}`);

    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const client = require('twilio')(accountSid, authToken);

    client.messages
        .create({
            body: `Your OTP is ${otp}`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: user.phoneNumber
        })
        .then(message => console.log(message.sid));

    console.log(`[MOCK SMS] OTP for ${username} (${user.phoneNumber}): ${otp}`);

    res.json({
        success: true,
        message: `OTP sent to linked phone ending in ...${user.phoneNumber.slice(-4)}`,
        debugOtp: otp // Included for demo purposes so it's visible in network tab/frontend
    });
});

// POST /auth/verify-otp - Verify OTP and Reset Password
app.post('/auth/verify-otp', async (req, res) => {
    const { username, otp, newPassword } = req.body;
    const user = db.find('users', u => u.username === username);

    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.otp || user.otp !== otp) {
        return res.status(400).json({ error: 'Invalid OTP' });
    }

    if (Date.now() > user.otpExpires) {
        return res.status(400).json({ error: 'OTP Expired' });
    }

    // Reset Password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.update('users', user.id, {
        password: hashedPassword,
        otp: null,
        otpExpires: null
    });

    res.json({ success: true, message: 'Password reset successfully' });
});

// PUT /auth/profile - Update Profile (Username, Password, Phone)
app.put('/auth/profile', async (req, res) => {
    const { currentPassword, newUsername, newPassword, newPhone } = req.body;
    const userId = req.user.username; // In our JWT payload we stored username as ID effectively, ideally use ID.
    // Let's find user by the username from token
    let user = db.find('users', u => u.username === req.user.username);

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Verify Current Password
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
        return res.status(401).json({ error: 'Incorrect current password' });
    }

    const updates = {};
    if (newUsername && newUsername !== user.username) {
        // Check if taken
        const existing = db.find('users', u => u.username === newUsername);
        if (existing) return res.status(400).json({ error: 'Username already taken' });
        updates.username = newUsername;
    }
    if (newPhone) {
        updates.phoneNumber = newPhone;
    }
    if (newPassword) {
        updates.password = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(updates).length > 0) {
        db.update('users', user.id, updates);

        // If username changed, generate new token
        if (updates.username) {
            const newToken = jwt.sign({ username: updates.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
            return res.json({ success: true, message: 'Profile updated', token: newToken });
        }

        res.json({ success: true, message: 'Profile updated' });
    } else {
        res.json({ success: true, message: 'No changes made' });
    }
});

// GET /borrowers
app.get('/borrowers', (req, res) => {
    const transactions = db.get('transactions');
    const borrowers = db.get('borrowers');

    // 1. Get unique names from transactions
    const transactionNames = new Set(transactions.map(t => t.name));

    // 2. Start with standalone borrowers
    const allBorrowers = [...borrowers];

    // 3. Add transaction borrowers if not already in list
    transactionNames.forEach(name => {
        if (!allBorrowers.find(b => b.name === name)) {
            allBorrowers.push({ name, activeLoans: 0 });
        }
    });

    res.json(allBorrowers);
});

// POST /borrowers
app.post('/borrowers', (req, res) => {
    const borrower = req.body;
    borrower.id = Math.random().toString(36).substr(2, 9);
    borrower.created_at = new Date().toISOString();

    db.add('borrowers', borrower);
    console.log('Created Borrower:', borrower);
    logAudit('create', `Created new borrower: ${borrower.name}`);
    res.json(borrower);
});

// GET /loans
app.get('/loans', (req, res) => {
    res.json(db.get('transactions'));
});

// POST /loans
app.post('/loans', (req, res) => {
    const loan = req.body;
    loan.id = Math.random().toString(36).substr(2, 9);
    loan.repayments = [];

    db.add('transactions', loan);
    console.log('Created Loan:', loan);
    logAudit('lend', `Disbursed loan of Rs.${loan.amountGiven} to ${loan.name}`);
    res.json(loan);
});

// POST /payments
app.post('/payments', (req, res) => {
    const { loanId, amount, date } = req.body;
    const loan = db.find('transactions', t => t.id === loanId);

    if (loan) {
        const payment = {
            id: Math.random().toString(36).substr(2, 9),
            date: date || new Date().toISOString(),
            amount
        };

        // Directly mutating object reference from db.find/get works because it's in-memory
        // But we must save to persist
        loan.repayments.push(payment);
        db.save();

        console.log(`Payment recorded for ${loan.name}: ${amount}`);
        logAudit('payment', `Received payment of Rs.${amount} from ${loan.name}`);
        res.json({ success: true, loan, paymentId: payment.id });
    } else {
        res.status(404).json({ error: 'Loan not found' });
    }
});

// PUT /loans/:loanId/payments/:paymentId
app.put('/loans/:loanId/payments/:paymentId', (req, res) => {
    const { loanId, paymentId } = req.params;
    const updates = req.body;

    const loan = db.find('transactions', t => t.id === loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    let paymentIndex = loan.repayments.findIndex(r => r.id === paymentId);

    if (paymentIndex === -1) {
        const index = parseInt(paymentId);
        if (!isNaN(index) && index >= 0 && index < loan.repayments.length) {
            paymentIndex = index;
        }
    }

    if (paymentIndex !== -1) {
        loan.repayments[paymentIndex] = { ...loan.repayments[paymentIndex], ...updates };
        db.save();
        console.log(`Updated Payment ${paymentId} for Loan ${loanId}`);
        logAudit('update', `Updated payment record for ${loan.name}`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Payment not found' });
    }
});

// PUT /loans/:id
app.put('/loans/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    // Use db.update convenience method
    const updatedLoan = db.update('transactions', id, updates);

    if (updatedLoan) {
        console.log('Updated Loan:', updatedLoan);
        logAudit('update', `Updated loan details for ${updatedLoan.name}`);
        res.json(updatedLoan);
    } else {
        res.status(404).json({ error: 'Loan not found' });
    }
});

// DELETE /loans/:loanId/payments/:paymentId
app.delete('/loans/:loanId/payments/:paymentId', (req, res) => {
    const { loanId, paymentId } = req.params;

    const loan = db.find('transactions', t => t.id === loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const initialLength = loan.repayments.length;
    loan.repayments = loan.repayments.filter(r => r.id !== paymentId);

    if (loan.repayments.length === initialLength) {
        const index = parseInt(paymentId);
        if (!isNaN(index) && index >= 0 && index < initialLength) {
            loan.repayments = loan.repayments.filter((_, i) => i !== index);
        }
    }

    if (loan.repayments.length < initialLength) {
        db.save();
        console.log(`Deleted Payment ${paymentId} from Loan ${loanId}`);
        logAudit('delete', `Deleted payment record for ${loan.name}`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Payment not found' });
    }
});

// DELETE /loans/:id
app.delete('/loans/:id', (req, res) => {
    const { id } = req.params;
    const loan = db.find('transactions', t => t.id === id); // Get for name before delete
    const name = loan ? loan.name : 'Unknown';
    const deleted = db.delete('transactions', id);

    if (deleted) {
        console.log('Deleted Loan:', id);
        logAudit('delete', `Deleted loan record for ${name}`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Loan not found' });
    }
});

// DELETE /borrowers/:name
app.delete('/borrowers/:name', (req, res) => {
    const { name } = req.params;

    // Custom delete logic for non-ID based delete
    const transactions = db.get('transactions');
    const borrowers = db.get('borrowers');

    const initialTCount = transactions.length;
    const initialBCount = borrowers.length;

    // Filter out matches
    db.data.transactions = transactions.filter(t => t.name !== name);
    db.data.borrowers = borrowers.filter(b => b.name !== name);

    db.save();

    console.log('Deleted Borrower:', name);
    logAudit('delete', `Deleted borrower: ${name}`);
    res.json({ success: true });
});

// PUT /borrowers/:name
app.put('/borrowers/:name', (req, res) => {
    const { name } = req.params;
    const { newName } = req.body;

    if (!newName) {
        return res.status(400).json({ error: 'New name is required' });
    }

    // 1. Update standalone borrowers
    const borrower = db.find('borrowers', b => b.name === name);
    if (borrower) {
        borrower.name = newName;
    }

    // 2. Update all transactions for this borrower
    const transactions = db.get('transactions');
    let updatedCount = 0;
    transactions.forEach(t => {
        if (t.name === name) {
            t.name = newName;
            updatedCount++;
        }
    });

    db.save();
    console.log(`Renamed Borrower: ${name} -> ${newName} (${updatedCount} transactions updated)`);
    res.json({ success: true, oldName: name, newName: newName });
});

// Helper: Audit Log
function logAudit(type, message) {
    const entry = {
        id: Math.random().toString(36).substr(2, 9),
        type,
        message,
        timestamp: new Date().toISOString()
    };
    db.add('audit_log', entry);
    return entry;
}

// GET /audit-log
app.get('/audit-log', (req, res) => {
    const logs = db.get('audit_log');
    // Return last 50 events, newest first
    res.json(logs.slice(-50).reverse());
});

// POST /loans/:id/remind
app.post('/loans/:id/remind', (req, res) => {
    const { id } = req.params;
    const loan = db.find('transactions', t => t.id === id);

    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    // Find borrower phone
    const borrower = db.find('borrowers', b => b.name === loan.name);
    const phone = borrower?.phone || '1234567890'; // Fallback for demo

    // MOCK SMS if no env vars, or Real if present
    const message = `Reminder: Payment for ${loan.frequency} loan of Rs.${loan.amountGiven} is due.`; // Simplified message

    if (process.env.TWILIO_ACCOUNT_SID) {
        const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        client.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
        }).then(msg => console.log('SMS Sent:', msg.sid)).catch(err => console.error('SMS Error:', err));
    }

    console.log(`[SMS] To ${loan.name} (${phone}): ${message}`);
    logAudit('reminder', `Sent SMS reminder to ${loan.name}`);

    res.json({ success: true, message: 'Reminder sent successfully' });
});

// Start Server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Backend Server running on http://localhost:${PORT}`);
});
