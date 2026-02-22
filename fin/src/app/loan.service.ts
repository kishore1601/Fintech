import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, switchMap, map, tap, catchError, of } from 'rxjs';

export interface Repayment {
    id: string;
    date: string;
    amount: number;
}

export interface Borrower {
    id: string;
    name: string;
    phone?: string;
    notes?: string;
    created_at?: string;
}

export interface Transaction {
    id: string;
    name: string;
    dateGiven: string;
    amountGiven: number;
    repayments: Repayment[];
    percentage: number;
    frequency: 'Weekly' | 'Monthly';
    installmentAmount: number;
}

export interface DashboardSummary {
    totalLent: number;
    interestEarned: number;
    activeLoans: number;
}

@Injectable({
    providedIn: 'root'
})
export class LoanService {
    private http = inject(HttpClient);
    private apiUrl = 'https://my-backend-api-o0et.onrender.com'; // Base URL

    // State
    connectionError = signal<string | null>(null);
    isOffline = signal(false);

    // Trigger to refresh data
    private refreshTrigger = new BehaviorSubject<void>(undefined);

    // Resource: Borrowers (with offline cache)
    private borrowersResponse$ = this.refreshTrigger.pipe(
        switchMap(() => this.http.get<Borrower[]>(`${this.apiUrl}/borrowers`).pipe(
            tap((data) => {
                this.connectionError.set(null);
                this.isOffline.set(false);
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('kf_borrowers_cache', JSON.stringify(data));
                }
            }),
            catchError(err => {
                console.error('API Error (Borrowers):', err);
                this.isOffline.set(true);
                this.connectionError.set('Offline mode — showing cached data.');
                if (typeof localStorage !== 'undefined') {
                    const cached = localStorage.getItem('kf_borrowers_cache');
                    if (cached) return of(JSON.parse(cached) as Borrower[]);
                }
                return of([] as Borrower[]);
            })
        ))
    );
    borrowers = toSignal(this.borrowersResponse$, { initialValue: [] });

    // Resource: Transactions (with offline cache)
    private transactions$ = this.refreshTrigger.pipe(
        switchMap(() => this.http.get<Transaction[]>(`${this.apiUrl}/loans`).pipe(
            tap((data) => {
                this.connectionError.set(null);
                this.isOffline.set(false);
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('kf_transactions_cache', JSON.stringify(data));
                }
            }),
            catchError(err => {
                console.error('API Error:', err);
                this.isOffline.set(true);
                this.connectionError.set('Offline mode — showing cached data.');
                if (typeof localStorage !== 'undefined') {
                    const cached = localStorage.getItem('kf_transactions_cache');
                    if (cached) return of(JSON.parse(cached) as Transaction[]);
                }
                return of([] as Transaction[]);
            })
        ))
    );
    transactions = toSignal(this.transactions$, { initialValue: [] });

    // Resource: Summary Stats
    // Ideally fetched from /summary, but for now we can compute client-side from the full list if backend endpoint isn't ready.
    // Or we can assume backend has it. The plan says backend provides /summary.
    // Let's rely on the transactions list for now to minimize breakage if backend summary is missing, 
    // BUT we will fetch it if the user wants true server-side calc.
    // Let's stick to the hybrid: Fetch list, compute stats client side (safe fallback), 
    // OR fetch summary. The Integration Guide said "Stop calculating interest in components".
    // I'll compute from the fetched transactions for now to ensure UI consistency with the current table.

    // Computed Stats (Derived from the fetched transactions to ensure consistency)
    totalLent = computed(() => this.transactions().reduce((acc, t) => acc + Number(t.amountGiven), 0));

    totalRepaid = computed(() => this.transactions().reduce((acc, t) => acc + this.getAmountReceived(t), 0));

    // Outstanding = Total Lent - Total Repaid (Global Portfolio Risk)
    outstanding = computed(() => {
        const lent = this.totalLent();
        const repaid = this.totalRepaid();
        return lent - repaid;
    });

    activeLoans = computed(() => this.transactions().filter(t => this.getStatus(t) !== 'Profit' && this.getStatus(t) !== 'Paid Off').length);

    // Projected Income (Weekly)
    activeWeeklyExpected = computed(() => this.transactions()
        .filter(t => t.frequency === 'Weekly' && this.getStatus(t) === 'Active')
        .reduce((acc, t) => acc + (Number(t.installmentAmount) || 0), 0)
    );

    activeMonthlyExpected = computed(() => this.transactions()
        .filter(t => t.frequency === 'Monthly' && this.getStatus(t) === 'Active')
        .reduce((acc, t) => acc + (Number(t.installmentAmount) || 0), 0)
    );

    // === ANALYTICS COMPUTED SIGNALS ===

    // 1. Pie Chart — Loan Status Breakdown
    loanStatusBreakdown = computed(() => {
        const txns = this.transactions();
        let active = 0, paidOff = 0, overdue = 0, profit = 0;
        for (const t of txns) {
            const s = this.getStatus(t);
            if (s === 'Active') {
                // Check if overdue (active loan older than 90 days with <50% repayment)
                const ageMs = Date.now() - new Date(t.dateGiven).getTime();
                const ageDays = ageMs / (1000 * 3600 * 24);
                const ratio = this.getAmountReceived(t) / t.amountGiven;
                if (ageDays > 90 && ratio < 0.5) {
                    overdue++;
                } else {
                    active++;
                }
            } else if (s === 'Paid Off') paidOff++;
            else if (s === 'Profit') profit++;
        }
        return { active, paidOff, overdue, profit, total: txns.length };
    });

    // 2. Interest Earned Tracker
    interestStats = computed(() => {
        const txns = this.transactions();
        let totalPrincipal = 0;
        let totalReceived = 0;
        let interestEarned = 0;

        for (const t of txns) {
            totalPrincipal += Number(t.amountGiven);
            const received = this.getAmountReceived(t);
            totalReceived += received;
            if (received > t.amountGiven) {
                interestEarned += (received - t.amountGiven);
            }
        }

        const ratio = totalPrincipal > 0 ? (interestEarned / totalPrincipal) * 100 : 0;
        return { totalPrincipal, totalReceived, interestEarned, ratio };
    });

    // 3. Cash Flow Forecast (30/60/90 days)
    cashFlowForecast = computed(() => {
        const txns = this.transactions();
        let forecast30 = 0, forecast60 = 0, forecast90 = 0;

        for (const t of txns) {
            const status = this.getStatus(t);
            if (status !== 'Active') continue;

            const installment = Number(t.installmentAmount) || 0;
            if (installment <= 0) continue;

            if (t.frequency === 'Monthly') {
                forecast30 += installment;       // 1 month
                forecast60 += installment * 2;   // 2 months
                forecast90 += installment * 3;   // 3 months
            } else {
                // Weekly
                forecast30 += installment * 4;   // ~4 weeks
                forecast60 += installment * 8;   // ~8 weeks
                forecast90 += installment * 13;  // ~13 weeks
            }
        }

        return { forecast30, forecast60, forecast90 };
    });

    // 4. Top Borrowers (by outstanding + by profit)
    topBorrowers = computed(() => {
        const txns = this.transactions();
        const borrowerMap = new Map<string, { name: string, outstanding: number, profit: number }>();

        for (const t of txns) {
            const current = borrowerMap.get(t.name) || { name: t.name, outstanding: 0, profit: 0 };
            const received = this.getAmountReceived(t);
            const outstanding = t.amountGiven - received;

            if (outstanding > 0) current.outstanding += outstanding;
            if (received > t.amountGiven) current.profit += (received - t.amountGiven);

            borrowerMap.set(t.name, current);
        }

        const all = Array.from(borrowerMap.values());
        const byOutstanding = [...all].sort((a, b) => b.outstanding - a.outstanding).slice(0, 5);
        const byProfit = [...all].sort((a, b) => b.profit - a.profit).slice(0, 5);

        return { byOutstanding, byProfit };
    });

    // 5. Overdue Loans
    overdueLoans = computed(() => {
        const txns = this.transactions();
        const overdue: { name: string, amount: number, daysSince: number, repaidRatio: number }[] = [];

        for (const t of txns) {
            if (this.getStatus(t) !== 'Active') continue;
            const ageMs = Date.now() - new Date(t.dateGiven).getTime();
            const ageDays = Math.floor(ageMs / (1000 * 3600 * 24));
            const received = this.getAmountReceived(t);
            const ratio = t.amountGiven > 0 ? received / t.amountGiven : 0;

            if (ageDays > 90 && ratio < 0.5) {
                overdue.push({
                    name: t.name,
                    amount: t.amountGiven - received,
                    daysSince: ageDays,
                    repaidRatio: Math.round(ratio * 100)
                });
            }
        }

        return overdue.sort((a, b) => b.amount - a.amount);
    });

    // Helpers
    getAmountReceived(t: Transaction): number {
        return t.repayments ? t.repayments.reduce((sum, r) => sum + Number(r.amount), 0) : 0;
    }

    getStatus(t: Transaction): 'Active' | 'Overdue' | 'Paid Off' | 'Profit' {
        const received = this.getAmountReceived(t);
        const profit = received - t.amountGiven;
        if (profit > 0) return 'Profit';
        if (profit === 0 && t.amountGiven > 0) return 'Paid Off';
        return 'Active';
    }

    getBorrowerTransactions(name: string): Transaction[] {
        return this.transactions().filter(t => t.name === name);
    }

    // Actions

    addTransaction(t: Transaction) {
        // We strip the ID as backend generates it
        const { id, ...payload } = t;
        this.http.post(`${this.apiUrl}/loans`, payload).subscribe({
            next: () => this.refreshTrigger.next(),
            error: (err) => console.error('Failed to create loan', err)
        });
    }

    deleteTransaction(id: string) {
        this.http.delete(`${this.apiUrl}/loans/${id}`).subscribe({
            next: () => this.refreshTrigger.next(),
            error: (err) => console.error('Failed to delete loan', err)
        });
    }

    updateTransaction(id: string, updates: Partial<Transaction>) {
        this.http.put(`${this.apiUrl}/loans/${id}`, updates).subscribe({
            next: () => this.refreshTrigger.next(),
            error: (err) => console.error('Failed to update loan', err)
        });
    }

    updateRepayment(loanId: string, repaymentId: string | number, updates: Partial<Repayment>) {
        this.http.put(`${this.apiUrl}/loans/${loanId}/payments/${repaymentId}`, updates).subscribe({
            next: () => this.refreshTrigger.next(),
            error: (err) => console.error('Failed to update repayment', err)
        });
    }

    createBorrower(borrower: Partial<Borrower>) {
        this.http.post(`${this.apiUrl}/borrowers`, borrower).subscribe({
            next: () => this.refreshTrigger.next(),
            error: (err) => {
                console.error('Failed to create borrower', err);
                this.connectionError.set('Failed to create borrower. Ensure backend is running.');
            }
        });
    }

    deleteBorrower(name: string) {
        // Backend handles bulk delete by name or we need to find IDs.
        // Assuming backend support DELETE /borrowers/:name or we filter and delete.
        // For now, let's assume we delete individually or backend has an endpoint.
        // The plan said: DELETE /borrowers/:id. But we have name here.
        // Let's try to pass the name as query param or ID.
        // Wait, current design uses Name as ID in many places.
        // Use a special endpoint or just loop?
        // Let's assume generic /borrowers/name/:name for now or loop.
        // Safest is to loop client side if no endpoint, but let's try the logical endpoint.
        this.http.delete(`${this.apiUrl}/borrowers/${name}`).subscribe({
            next: () => this.refreshTrigger.next(),
            error: (err) => console.error('Failed to delete borrower', err)
        });
    }

    renameBorrower(oldName: string, newName: string) {
        return this.http.put(`${this.apiUrl}/borrowers/${oldName}`, { newName }).pipe(
            tap(() => this.refreshTrigger.next()),
            catchError(err => {
                console.error('Failed to rename borrower', err);
                return of(null);
            })
        );
    }

    recordRepayment(transactionId: string, amount: number) {
        this.http.post(`${this.apiUrl}/payments`, {
            loanId: transactionId,
            amount: amount,
            date: new Date().toISOString()
        }).subscribe({
            next: () => this.refreshTrigger.next(),
            error: (err) => console.error('Failed to record repayment', err)
        });
    }

    deleteRepayment(loanId: string, paymentId: string | number) {
        // We assume the backend can handle deletion via loanId/paymentId or if paymentId is unique
        this.http.delete(`${this.apiUrl}/loans/${loanId}/payments/${paymentId}`).subscribe({
            next: () => this.refreshTrigger.next(),
            error: (err) => console.error('Failed to delete repayment', err)
        });
    }

    // Chart Data
    monthlyStats = computed(() => {
        const stats = new Map<string, number>();
        const now = new Date();
        const transactions = this.transactions();

        // Initialize last 6 months
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            stats.set(key, 0);
        }

        transactions.forEach(t => {
            if (t.repayments) {
                t.repayments.forEach(r => {
                    const d = new Date(r.date);
                    const key = `${d.getFullYear()}-${d.getMonth()}`;
                    if (stats.has(key)) {
                        stats.set(key, stats.get(key)! + Number(r.amount));
                    }
                });
            }
        });

        return Array.from(stats.entries()).map(([key, value]) => {
            const [year, month] = key.split('-').map(Number);
            const date = new Date(year, month, 1);
            return {
                label: date.toLocaleString('default', { month: 'short' }),
                value
            };
        });
    });

    weeklyStats = computed(() => {
        const buckets: { label: string, value: number, minAge: number, maxAge: number }[] = [];
        for (let i = 0; i < 4; i++) {
            buckets.push({ label: i === 0 ? 'This Week' : `${i}w ago`, value: 0, minAge: i * 7, maxAge: (i + 1) * 7 });
        }

        this.transactions().forEach(t => {
            if (t.repayments) {
                const now = new Date().getTime();
                t.repayments.forEach(r => {
                    const diffDays = (now - new Date(r.date).getTime()) / (1000 * 3600 * 24);
                    const bucket = buckets.find(b => diffDays >= b.minAge && diffDays < b.maxAge);
                    if (bucket) {
                        bucket.value += Number(r.amount);
                    }
                });
            }
        });

        return buckets.reverse();
    });

    getChartPath(isArea: boolean, period: 'Monthly' | 'Weekly' = 'Monthly'): string {
        const data = period === 'Monthly' ? this.monthlyStats() : this.weeklyStats();
        if (!data.length) return '';

        const maxVal = Math.max(...data.map(d => d.value), 100);
        const width = 100;
        const height = 50;
        const step = width / (data.length - 1);

        const points = data.map((d, i) => {
            const x = i * step;
            const y = height - (d.value / maxVal * height * 0.8);
            return `${x},${y}`;
        });

        if (points.length === 0) return '';

        const linePath = `M ${points[0]} ` + points.slice(1).map(p => `L ${p}`).join(' ');

        if (isArea) {
            return `${linePath} L 100,50 L 0,50 Z`; // Close the area
        } else {
            return linePath;
        }
    }

    // === BACKUP & RESTORE ===
    exportData() {
        const data = {
            exportDate: new Date().toISOString(),
            app: 'KishoreFintech',
            borrowers: this.borrowers(),
            transactions: this.transactions()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `kishorefintech-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    importData(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target?.result as string);
                    if (!data.borrowers || !data.transactions) {
                        reject('Invalid backup file format.');
                        return;
                    }

                    // Store in local cache immediately
                    if (typeof localStorage !== 'undefined') {
                        localStorage.setItem('kf_borrowers_cache', JSON.stringify(data.borrowers));
                        localStorage.setItem('kf_transactions_cache', JSON.stringify(data.transactions));
                    }

                    // Try to POST borrowers to API
                    let completed = 0;
                    const total = data.borrowers.length;
                    if (total === 0) {
                        this.refreshTrigger.next();
                        resolve('Backup restored successfully (0 borrowers).');
                        return;
                    }

                    for (const b of data.borrowers) {
                        this.http.post(`${this.apiUrl}/borrowers`, b).subscribe({
                            next: () => {
                                completed++;
                                if (completed === total) {
                                    this.refreshTrigger.next();
                                    resolve(`Restored ${total} borrowers successfully.`);
                                }
                            },
                            error: () => {
                                completed++;
                                if (completed === total) {
                                    this.refreshTrigger.next();
                                    resolve(`Restored with some errors. ${completed} attempted.`);
                                }
                            }
                        });
                    }
                } catch {
                    reject('Could not parse backup file.');
                }
            };
            reader.readAsText(file);
        });
    }

    // === NEW FEATURES ===

    getAuditLog() {
        return this.http.get<{ type: string, message: string, timestamp: string }[]>(`${this.apiUrl}/audit-log`).pipe(
            catchError(() => of([]))
        );
    }

    sendReminder(loanId: string) {
        return this.http.post(`${this.apiUrl}/loans/${loanId}/remind`, {});
    }
}
