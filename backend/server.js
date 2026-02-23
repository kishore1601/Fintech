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

// Initialize Database & Default Admin User
async function initializeApp() {
    await db.initialize();

    const result = await db.query('SELECT * FROM users WHERE username = $1', ['admin']);
    if (result.rows.length === 0) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await db.query(
            'INSERT INTO users (id, username, password, role, phone_number) VALUES ($1, $2, $3, $4, $5)',
            ['admin', 'admin', hashedPassword, 'admin', '1234567890']
        );
        console.log('Default admin user created: admin / admin123 / 1234567890');
    }
}
initializeApp();

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

// Helper: Generate random ID
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Helper: Audit Log
async function logAudit(type, message) {
    const id = generateId();
    await db.query(
        'INSERT INTO audit_log (id, type, message) VALUES ($1, $2, $3)',
        [id, type, message]
    );
}

// ================== AUTH ROUTES ==================

// POST /login
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token, user: { username: user.username, phoneNumber: user.phone_number } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /auth/forgot-password - Generate OTP
app.post('/auth/forgot-password', async (req, res) => {
    try {
        const { username } = req.body;
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!user.phone_number) {
            return res.status(400).json({ error: 'No phone number linked to this account.' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        await db.query(
            'UPDATE users SET otp = $1, otp_expires = $2 WHERE id = $3',
            [otp, Date.now() + 300000, user.id]
        );

        // Twilio SMS
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        if (accountSid && authToken) {
            const client = require('twilio')(accountSid, authToken);
            client.messages
                .create({
                    body: `Your OTP is ${otp}`,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: user.phone_number
                })
                .then(message => console.log(message.sid))
                .catch(err => console.error('SMS Error:', err));
        }

        console.log(`[SMS] OTP for ${username} (${user.phone_number}): ${otp}`);

        res.json({
            success: true,
            message: `OTP sent to linked phone ending in ...${user.phone_number.slice(-4)}`,
            debugOtp: otp
        });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /auth/verify-otp - Verify OTP and Reset Password
app.post('/auth/verify-otp', async (req, res) => {
    try {
        const { username, otp, newPassword } = req.body;
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!user.otp || user.otp !== otp) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        if (Date.now() > user.otp_expires) {
            return res.status(400).json({ error: 'OTP Expired' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.query(
            'UPDATE users SET password = $1, otp = NULL, otp_expires = NULL WHERE id = $2',
            [hashedPassword, user.id]
        );

        res.json({ success: true, message: 'Password reset successfully' });
    } catch (err) {
        console.error('Verify OTP error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /auth/profile - Update Profile
app.put('/auth/profile', async (req, res) => {
    try {
        const { currentPassword, newUsername, newPassword, newPhone } = req.body;
        const result = await db.query('SELECT * FROM users WHERE username = $1', [req.body.currentUsername || 'admin']);
        const user = result.rows[0];

        if (!user) return res.status(404).json({ error: 'User not found' });

        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Incorrect current password' });
        }

        if (newUsername && newUsername !== user.username) {
            const existing = await db.query('SELECT * FROM users WHERE username = $1', [newUsername]);
            if (existing.rows.length > 0) return res.status(400).json({ error: 'Username already taken' });
            await db.query('UPDATE users SET username = $1 WHERE id = $2', [newUsername, user.id]);
        }
        if (newPhone) {
            await db.query('UPDATE users SET phone_number = $1 WHERE id = $2', [newPhone, user.id]);
        }
        if (newPassword) {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id]);
        }

        if (newUsername && newUsername !== user.username) {
            const newToken = jwt.sign({ username: newUsername, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
            return res.json({ success: true, message: 'Profile updated', token: newToken });
        }

        res.json({ success: true, message: 'Profile updated' });
    } catch (err) {
        console.error('Profile update error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ================== BORROWER ROUTES ==================

// GET /borrowers
app.get('/borrowers', async (req, res) => {
    try {
        const borrowersResult = await db.query('SELECT * FROM borrowers');
        const transactionsResult = await db.query('SELECT DISTINCT name FROM transactions');

        const allBorrowers = [...borrowersResult.rows];

        // Add transaction-only borrowers not already in borrowers table
        transactionsResult.rows.forEach(t => {
            if (!allBorrowers.find(b => b.name === t.name)) {
                allBorrowers.push({ name: t.name, activeLoans: 0 });
            }
        });

        res.json(allBorrowers);
    } catch (err) {
        console.error('Get borrowers error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /borrowers
app.post('/borrowers', async (req, res) => {
    try {
        const borrower = req.body;
        borrower.id = generateId();

        await db.query(
            'INSERT INTO borrowers (id, name, phone, notes) VALUES ($1, $2, $3, $4)',
            [borrower.id, borrower.name, borrower.phone || '', borrower.notes || '']
        );

        const result = await db.query('SELECT * FROM borrowers WHERE id = $1', [borrower.id]);
        console.log('Created Borrower:', result.rows[0]);
        await logAudit('create', `Created new borrower: ${borrower.name}`);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Create borrower error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /borrowers/:name
app.delete('/borrowers/:name', async (req, res) => {
    try {
        const { name } = req.params;

        // Delete all transactions (repayments cascade) for this borrower
        await db.query('DELETE FROM repayments WHERE transaction_id IN (SELECT id FROM transactions WHERE name = $1)', [name]);
        await db.query('DELETE FROM transactions WHERE name = $1', [name]);
        await db.query('DELETE FROM borrowers WHERE name = $1', [name]);

        console.log('Deleted Borrower:', name);
        await logAudit('delete', `Deleted borrower: ${name}`);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete borrower error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /borrowers/:name
app.put('/borrowers/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const { newName } = req.body;

        if (!newName) {
            return res.status(400).json({ error: 'New name is required' });
        }

        // Update borrowers table
        await db.query('UPDATE borrowers SET name = $1 WHERE name = $2', [newName, name]);

        // Update all transactions for this borrower
        const result = await db.query('UPDATE transactions SET name = $1 WHERE name = $2', [newName, name]);

        console.log(`Renamed Borrower: ${name} -> ${newName} (${result.rowCount} transactions updated)`);
        res.json({ success: true, oldName: name, newName: newName });
    } catch (err) {
        console.error('Rename borrower error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ================== LOAN ROUTES ==================

// GET /loans
app.get('/loans', async (req, res) => {
    try {
        const loansResult = await db.query('SELECT * FROM transactions');
        const loans = loansResult.rows;

        // Fetch repayments for all loans
        for (let loan of loans) {
            const repaymentsResult = await db.query(
                'SELECT * FROM repayments WHERE transaction_id = $1',
                [loan.id]
            );
            // Map DB columns to the format frontend expects
            loan.dateGiven = loan.date_given;
            loan.amountGiven = Number(loan.amount_given);
            loan.percentage = Number(loan.percentage);
            loan.installmentAmount = Number(loan.installment_amount);
            loan.repayments = repaymentsResult.rows.map(r => ({
                id: r.id,
                date: r.date,
                amount: Number(r.amount)
            }));
            // Clean up DB-specific column names
            delete loan.date_given;
            delete loan.amount_given;
            delete loan.installment_amount;
        }

        res.json(loans);
    } catch (err) {
        console.error('Get loans error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /loans
app.post('/loans', async (req, res) => {
    try {
        const loan = req.body;
        loan.id = generateId();

        await db.query(
            'INSERT INTO transactions (id, name, date_given, amount_given, percentage, frequency, installment_amount) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [loan.id, loan.name, loan.dateGiven, loan.amountGiven, loan.percentage, loan.frequency, loan.installmentAmount || 0]
        );

        loan.repayments = [];
        console.log('Created Loan:', loan);
        await logAudit('lend', `Disbursed loan of Rs.${loan.amountGiven} to ${loan.name}`);
        res.json(loan);
    } catch (err) {
        console.error('Create loan error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /loans/:id
app.put('/loans/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Build dynamic update query for allowed fields
        const fieldMap = {
            name: 'name',
            dateGiven: 'date_given',
            amountGiven: 'amount_given',
            percentage: 'percentage',
            frequency: 'frequency',
            installmentAmount: 'installment_amount'
        };

        const setClauses = [];
        const values = [];
        let paramIndex = 1;

        for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
            if (updates[jsKey] !== undefined) {
                setClauses.push(`${dbCol} = $${paramIndex}`);
                values.push(updates[jsKey]);
                paramIndex++;
            }
        }

        if (setClauses.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        values.push(id);
        await db.query(
            `UPDATE transactions SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
            values
        );

        // Fetch and return updated loan
        const loanResult = await db.query('SELECT * FROM transactions WHERE id = $1', [id]);
        if (loanResult.rows.length === 0) {
            return res.status(404).json({ error: 'Loan not found' });
        }

        const loan = loanResult.rows[0];
        loan.dateGiven = loan.date_given;
        loan.amountGiven = Number(loan.amount_given);
        loan.percentage = Number(loan.percentage);
        loan.installmentAmount = Number(loan.installment_amount);

        const repaymentsResult = await db.query('SELECT * FROM repayments WHERE transaction_id = $1', [id]);
        loan.repayments = repaymentsResult.rows.map(r => ({ id: r.id, date: r.date, amount: Number(r.amount) }));

        delete loan.date_given;
        delete loan.amount_given;
        delete loan.installment_amount;

        console.log('Updated Loan:', loan);
        await logAudit('update', `Updated loan details for ${loan.name}`);
        res.json(loan);
    } catch (err) {
        console.error('Update loan error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /loans/:id
app.delete('/loans/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Get loan name for audit log before deleting
        const loanResult = await db.query('SELECT name FROM transactions WHERE id = $1', [id]);
        const name = loanResult.rows[0]?.name || 'Unknown';

        // Delete repayments first, then loan
        await db.query('DELETE FROM repayments WHERE transaction_id = $1', [id]);
        const result = await db.query('DELETE FROM transactions WHERE id = $1', [id]);

        if (result.rowCount > 0) {
            console.log('Deleted Loan:', id);
            await logAudit('delete', `Deleted loan record for ${name}`);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Loan not found' });
        }
    } catch (err) {
        console.error('Delete loan error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ================== PAYMENT ROUTES ==================

// POST /payments
app.post('/payments', async (req, res) => {
    try {
        const { loanId, amount, date } = req.body;

        // Check loan exists
        const loanResult = await db.query('SELECT * FROM transactions WHERE id = $1', [loanId]);
        if (loanResult.rows.length === 0) {
            return res.status(404).json({ error: 'Loan not found' });
        }
        const loan = loanResult.rows[0];

        const paymentId = generateId();
        const paymentDate = date || new Date().toISOString();

        await db.query(
            'INSERT INTO repayments (id, transaction_id, date, amount) VALUES ($1, $2, $3, $4)',
            [paymentId, loanId, paymentDate, amount]
        );

        console.log(`Payment recorded for ${loan.name}: ${amount}`);
        await logAudit('payment', `Received payment of Rs.${amount} from ${loan.name}`);

        // Return loan with updated repayments
        const repaymentsResult = await db.query('SELECT * FROM repayments WHERE transaction_id = $1', [loanId]);
        const repayments = repaymentsResult.rows.map(r => ({ id: r.id, date: r.date, amount: Number(r.amount) }));

        res.json({ success: true, loan: { ...loan, repayments }, paymentId });
    } catch (err) {
        console.error('Create payment error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /loans/:loanId/payments/:paymentId
app.put('/loans/:loanId/payments/:paymentId', async (req, res) => {
    try {
        const { loanId, paymentId } = req.params;
        const updates = req.body;

        // Check loan exists
        const loanResult = await db.query('SELECT * FROM transactions WHERE id = $1', [loanId]);
        if (loanResult.rows.length === 0) {
            return res.status(404).json({ error: 'Loan not found' });
        }

        const setClauses = [];
        const values = [];
        let paramIndex = 1;

        if (updates.amount !== undefined) {
            setClauses.push(`amount = $${paramIndex}`);
            values.push(updates.amount);
            paramIndex++;
        }
        if (updates.date !== undefined) {
            setClauses.push(`date = $${paramIndex}`);
            values.push(updates.date);
            paramIndex++;
        }

        if (setClauses.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        values.push(paymentId);
        values.push(loanId);
        const result = await db.query(
            `UPDATE repayments SET ${setClauses.join(', ')} WHERE id = $${paramIndex} AND transaction_id = $${paramIndex + 1}`,
            values
        );

        if (result.rowCount > 0) {
            console.log(`Updated Payment ${paymentId} for Loan ${loanId}`);
            await logAudit('update', `Updated payment record for ${loanResult.rows[0].name}`);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Payment not found' });
        }
    } catch (err) {
        console.error('Update payment error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /loans/:loanId/payments/:paymentId
app.delete('/loans/:loanId/payments/:paymentId', async (req, res) => {
    try {
        const { loanId, paymentId } = req.params;

        const loanResult = await db.query('SELECT * FROM transactions WHERE id = $1', [loanId]);
        if (loanResult.rows.length === 0) {
            return res.status(404).json({ error: 'Loan not found' });
        }

        const result = await db.query(
            'DELETE FROM repayments WHERE id = $1 AND transaction_id = $2',
            [paymentId, loanId]
        );

        if (result.rowCount > 0) {
            console.log(`Deleted Payment ${paymentId} from Loan ${loanId}`);
            await logAudit('delete', `Deleted payment record for ${loanResult.rows[0].name}`);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Payment not found' });
        }
    } catch (err) {
        console.error('Delete payment error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ================== AUDIT & REMINDERS ==================

// GET /audit-log
app.get('/audit-log', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 50');
        res.json(result.rows);
    } catch (err) {
        console.error('Get audit log error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /loans/:id/remind
app.post('/loans/:id/remind', async (req, res) => {
    try {
        const { id } = req.params;
        const loanResult = await db.query('SELECT * FROM transactions WHERE id = $1', [id]);

        if (loanResult.rows.length === 0) return res.status(404).json({ error: 'Loan not found' });
        const loan = loanResult.rows[0];

        // Find borrower phone
        const borrowerResult = await db.query('SELECT * FROM borrowers WHERE name = $1', [loan.name]);
        const phone = borrowerResult.rows[0]?.phone || '1234567890';

        const message = `Reminder: Payment for ${loan.frequency} loan of Rs.${loan.amount_given} is due.`;

        if (process.env.TWILIO_ACCOUNT_SID) {
            const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            client.messages.create({
                body: message,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: phone
            }).then(msg => console.log('SMS Sent:', msg.sid)).catch(err => console.error('SMS Error:', err));
        }

        console.log(`[SMS] To ${loan.name} (${phone}): ${message}`);
        await logAudit('reminder', `Sent SMS reminder to ${loan.name}`);

        res.json({ success: true, message: 'Reminder sent successfully' });
    } catch (err) {
        console.error('Remind error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend Server running on http://localhost:${PORT}`);
});
