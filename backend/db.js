const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'db.json');

class Database {
    constructor() {
        this.data = {
            users: [],
            borrowers: [],
            transactions: [],
            audit_log: []
        };
        this.load();
    }

    load() {
        if (fs.existsSync(DB_FILE)) {
            try {
                const fileData = fs.readFileSync(DB_FILE, 'utf8');
                this.data = JSON.parse(fileData);
            } catch (err) {
                console.error('Error reading DB file:', err);
                this.save(); // Reset if corrupted
            }
        } else {
            this.save(); // Create if not exists
        }
    }

    save() {
        try {
            fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2));
        } catch (err) {
            console.error('Error writing DB file:', err);
        }
    }

    get(collection) {
        return this.data[collection] || [];
    }

    add(collection, item) {
        if (!this.data[collection]) this.data[collection] = [];
        this.data[collection].push(item);
        this.save();
        return item;
    }

    update(collection, id, updates) {
        const list = this.data[collection];
        const index = list.findIndex(item => item.id === id);
        if (index !== -1) {
            list[index] = { ...list[index], ...updates };
            this.save();
            return list[index];
        }
        return null;
    }

    delete(collection, id) {
        const list = this.data[collection];
        const index = list.findIndex(item => item.id === id);
        if (index !== -1) {
            list.splice(index, 1);
            this.save();
            return true;
        }
        return false;
    }

    find(collection, predicate) {
        return this.data[collection].find(predicate);
    }
}

module.exports = new Database();
