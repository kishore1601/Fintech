const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// In-memory Database
// In-memory Database
let transactions = [
    {
        id: '1',
        name: 'John Doe',
        dateGiven: '2023-11-01',
        amountGiven: 50000,
        repayments: [],
        percentage: 5,
        frequency: 'Monthly',
        installmentAmount: 5000
    },
    {
        id: '2',
        name: 'Jane Smith',
        dateGiven: '2023-12-15',
        amountGiven: 20000,
        repayments: [],
        percentage: 3,
        frequency: 'Weekly',
        installmentAmount: 2000
    }
];

let borrowers = []; // Standalone borrowers

// Routes

// POST /login - Simple Admin Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    // Hardcoded for demo/simplicity as requested "without altering other features"
    // In a real app, this would query a Users DB
    if (username === 'admin' && password === 'admin') {
        res.json({ success: true, token: 'fake-jwt-token-for-demo' });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// GET /borrowers - Get all borrowers (merged from standalone + transactions)
app.get('/borrowers', (req, res) => {
    // 1. Get unique names from transactions
    const transactionNames = new Set(transactions.map(t => t.name));

    // 2. Get standalone borrowers
    const allBorrowers = [...borrowers];

    // 3. Add transaction borrowers if not already in list
    transactionNames.forEach(name => {
        if (!allBorrowers.find(b => b.name === name)) {
            allBorrowers.push({ name, activeLoans: 0 }); // minimalist structure
        }
    });

    res.json(allBorrowers);
});

// POST /borrowers - Create a new borrower
app.post('/borrowers', (req, res) => {
    const borrower = req.body;
    borrower.id = Math.random().toString(36).substr(2, 9);
    borrower.created_at = new Date().toISOString();
    borrowers.push(borrower);
    console.log('Created Borrower:', borrower);
    res.json(borrower);
});

// GET /loans - Get all transactions
app.get('/loans', (req, res) => {
    res.json(transactions);
});

// POST /loans - Create a new loan
app.post('/loans', (req, res) => {
    const loan = req.body;
    loan.id = Math.random().toString(36).substr(2, 9);
    loan.repayments = [];
    transactions.push(loan);
    console.log('Created Loan:', loan);
    res.json(loan);
});

// POST /payments - Record a repayment
app.post('/payments', (req, res) => {
    const { loanId, amount, date } = req.body;
    const loan = transactions.find(t => t.id === loanId);
    if (loan) {
        const payment = {
            id: Math.random().toString(36).substr(2, 9),
            date: date || new Date().toISOString(),
            amount
        };
        loan.repayments.push(payment);
        console.log(`Payment recorded for ${loan.name}: ${amount}`);
        res.json({ success: true, loan, paymentId: payment.id });
    } else {
        res.status(404).json({ error: 'Loan not found' });
    }
});

// UPGRADE: Routes for Repayment Management

// PUT /loans/:loanId/payments/:paymentId - Update a repayment
app.put('/loans/:loanId/payments/:paymentId', (req, res) => {
    const { loanId, paymentId } = req.params;
    const updates = req.body; // { amount, date }

    const loan = transactions.find(t => t.id === loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    let paymentIndex = loan.repayments.findIndex(r => r.id === paymentId);

    // Fallback: Try index if ID match failed (for legacy data)
    if (paymentIndex === -1) {
        const index = parseInt(paymentId);
        if (!isNaN(index) && index >= 0 && index < loan.repayments.length) {
            paymentIndex = index;
        }
    }

    if (paymentIndex !== -1) {
        loan.repayments[paymentIndex] = { ...loan.repayments[paymentIndex], ...updates };
        console.log(`Updated Payment ${paymentId} for Loan ${loanId}`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Payment not found' });
    }
});

// PUT /loans/:id - Update a loan
app.put('/loans/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const index = transactions.findIndex(t => t.id === id);
    if (index !== -1) {
        transactions[index] = { ...transactions[index], ...updates };
        console.log('Updated Loan:', transactions[index]);
        res.json(transactions[index]);
    } else {
        res.status(404).json({ error: 'Loan not found' });
    }
});

// DELETE /loans/:loanId/payments/:paymentId - Delete a repayment
app.delete('/loans/:loanId/payments/:paymentId', (req, res) => {
    const { loanId, paymentId } = req.params;

    const loan = transactions.find(t => t.id === loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const initialLength = loan.repayments.length;
    // 1. Try deleting by ID
    loan.repayments = loan.repayments.filter(r => r.id !== paymentId);

    // 2. Fallback: If no change, try deleting by index (Legacy Data Support)
    if (loan.repayments.length === initialLength) {
        const index = parseInt(paymentId);
        if (!isNaN(index) && index >= 0 && index < initialLength) {
            loan.repayments = loan.repayments.filter((_, i) => i !== index);
        }
    }

    if (loan.repayments.length < initialLength) {
        console.log(`Deleted Payment ${paymentId} from Loan ${loanId}`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Payment not found' });
    }
});

// DELETE /loans/:id - Delete a loan
app.delete('/loans/:id', (req, res) => {
    const { id } = req.params;
    transactions = transactions.filter(t => t.id !== id);
    console.log('Deleted Loan:', id);
    res.json({ success: true });
});

// DELETE /borrowers/:name - Delete a borrower
app.delete('/borrowers/:name', (req, res) => {
    const { name } = req.params;
    transactions = transactions.filter(t => t.name !== name);
    borrowers = borrowers.filter(b => b.name !== name); // Also delete from standalone
    console.log('Deleted Borrower:', name);
    res.json({ success: true });
});

// PUT /borrowers/:name - Rename a borrower
app.put('/borrowers/:name', (req, res) => {
    const { name } = req.params;
    const { newName } = req.body;

    if (!newName) {
        return res.status(400).json({ error: 'New name is required' });
    }

    // 1. Update standalone borrowers
    const borrower = borrowers.find(b => b.name === name);
    if (borrower) {
        borrower.name = newName;
    }

    // 2. Update all transactions for this borrower
    let updatedCount = 0;
    transactions.forEach(t => {
        if (t.name === name) {
            t.name = newName;
            updatedCount++;
        }
    });

    console.log(`Renamed Borrower: ${name} -> ${newName} (${updatedCount} transactions updated)`);
    res.json({ success: true, oldName: name, newName: newName });
});

// Start Server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Backend Server running on http://localhost:${PORT}`);
});
