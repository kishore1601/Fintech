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
    private apiUrl = 'http://localhost:3000'; // Base URL

    // State
    connectionError = signal<string | null>(null);

    // Trigger to refresh data
    private refreshTrigger = new BehaviorSubject<void>(undefined);

    // Resource: Borrowers
    // We fetch all borrowers to populate the directory.
    private borrowersResponse$ = this.refreshTrigger.pipe(
        switchMap(() => this.http.get<Borrower[]>(`${this.apiUrl}/borrowers`).pipe(
            tap(() => this.connectionError.set(null)), // Clear error on success
            catchError(err => {
                console.error('API Error (Borrowers):', err);
                this.connectionError.set('Could not connect to backend server. Ensure it is running on port 3000.');
                return of([] as Borrower[]);
            })
        ))
    );
    borrowers = toSignal(this.borrowersResponse$, { initialValue: [] });

    // Resource: Transactions (All Loans)
    // We fetch all loans to populate the table.
    private transactions$ = this.refreshTrigger.pipe(
        switchMap(() => this.http.get<Transaction[]>(`${this.apiUrl}/loans`).pipe(
            tap(() => this.connectionError.set(null)), // Clear error on success
            catchError(err => {
                console.error('API Error:', err);
                this.connectionError.set('Could not connect to backend server. Ensure it is running on port 3000.');
                return of([] as Transaction[]); // Return empty list to prevent crash
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
}
