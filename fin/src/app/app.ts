import { Component, signal, computed, inject, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ThemeService } from './theme.service';
import { LoanService, Transaction } from './loan.service';
import { AuthService } from './auth.service';
import { RouterOutlet } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { ProfileSettingsComponent } from './settings/profile-settings.component';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, CommonModule, RouterOutlet, ProfileSettingsComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  // Services
  themeService = inject(ThemeService);
  loanService = inject(LoanService);
  authService = inject(AuthService);

  // Form signals
  name = signal('');
  dateGiven = signal(new Date().toISOString().split('T')[0]);
  amountGiven = signal<number | null>(null);
  percentage = signal<number | null>(null);
  frequency = signal<'Weekly' | 'Monthly'>('Monthly');
  installmentAmount = signal<number | null>(null);

  // State
  currentTab = signal<'dashboard' | 'loans' | 'borrowers' | 'settings'>('dashboard');
  selectedBorrower = signal<string | null>(null); // For detail view
  showProfileMenu = signal(false);
  showSettingsMenu = signal(false);
  editingLoanId = signal<string | null>(null);
  payingLoanId = signal<string | null>(null);
  paymentAmount = signal<number | null>(null);
  isAddingHistoryEntry = signal(false);
  newEntryType: 'Loan' | 'Repayment' = 'Repayment';
  newEntryAmount: number | null = null;
  newEntryDate: string = new Date().toISOString().split('T')[0];
  selectedTransactionIds = signal<Set<string | number>>(new Set());
  editingTransactionId = signal<string | null>(null);
  editingRepaymentId = signal<string | null>(null);

  // Modal Signals
  showAddBorrowerModal = signal(false);
  showAddTransactionModal = signal(false);
  fabOpen = signal(false);

  // Rename State
  isEditingName = signal(false);
  newNameEdit = signal('');

  // New Borrower Form
  newBorrowerName = signal('');
  newBorrowerPhone = signal('');
  newBorrowerNotes = signal('');

  // New Transaction Form
  // reusing: dateGiven, percentage, frequency, installmentAmount
  // specific for this modal
  newLoanAmount = signal<number | null>(null);

  isAllSelected = computed(() => {
    const transactions = this.getBorrowerTransactions(this.selectedBorrower() || '');
    if (transactions.length === 0) return false;

    // Check if all loans AND all their repayments are selected
    for (const t of transactions) {
      if (!this.selectedTransactionIds().has(t.id)) return false;
      for (let i = 0; i < t.repayments.length; i++) {
        const r = t.repayments[i];
        if (!this.selectedTransactionIds().has(r.id || i)) return false;
      }
    }
    return true;
  });

  // Expose Service Signals for Template
  transactions = this.loanService.transactions;
  totalLent = this.loanService.totalLent;
  totalRepaid = this.loanService.totalRepaid;
  outstanding = this.loanService.outstanding;
  activeLoans = this.loanService.activeLoans;
  overdueAmount = signal(0);
  monthlyStats = this.loanService.monthlyStats;
  weeklyStats = this.loanService.weeklyStats;

  // UI State
  chartPeriod = signal<'Monthly' | 'Weekly'>('Monthly');



  getChartPath(isArea: boolean) {
    return this.loanService.getChartPath(isArea, this.chartPeriod());
  }
  activeMonthlyExpected = this.loanService.activeMonthlyExpected;

  // Analytics
  loanStatusBreakdown = this.loanService.loanStatusBreakdown;
  interestStats = this.loanService.interestStats;
  cashFlowForecast = this.loanService.cashFlowForecast;
  topBorrowers = this.loanService.topBorrowers;
  overdueLoans = this.loanService.overdueLoans;

  // Loan Calculator State
  showCalculator = signal(false);
  calcPrincipal = signal<number | null>(null);
  calcRate = signal<number | null>(null);
  calcTenure = signal<number | null>(null);
  calcFrequency = signal<'Monthly' | 'Weekly'>('Monthly');

  calcResult = computed(() => {
    const p = this.calcPrincipal();
    const r = this.calcRate();
    const t = this.calcTenure();
    const f = this.calcFrequency();

    if (!p || !r || !t) return null;

    // Standard EMI formula: E = P * r * (1+r)^n / ((1+r)^n - 1)
    // Rate is annual %, need to convert to period rate
    // Monthly: r / 12 / 100
    // Weekly: r / 52 / 100

    let periodRate = 0;
    if (f === 'Monthly') periodRate = r / 12 / 100;
    else periodRate = r / 52 / 100;

    const n = t;
    let emi = 0;

    if (periodRate === 0) {
      emi = p / n;
    } else {
      emi = (p * periodRate * Math.pow(1 + periodRate, n)) / (Math.pow(1 + periodRate, n) - 1);
    }

    const totalPayable = emi * n;
    const totalInterest = totalPayable - p;

    return {
      emi,
      totalInterest,
      totalPayable
    };
  });

  // Audit Log
  auditLog = signal<{ type: string, message: string, timestamp: string }[]>([]);

  constructor() {
    // Poll for audit log updates every 5s (simple implementation)
    // In production, use WebSockets or SSE
    setInterval(() => {
      this.refreshAuditLog();
    }, 5000);
    this.refreshAuditLog();
  }

  refreshAuditLog() {
    this.loanService.getAuditLog().subscribe(logs => {
      this.auditLog.set(logs);
    });
  }

  sendReminder(t: Transaction) {
    if (!confirm(`Send SMS reminder to ${t.name} for ${t.frequency} payment?`)) return;

    this.loanService.sendReminder(t.id).subscribe({
      next: (res: any) => {
        alert(res.message);
        this.refreshAuditLog();
      },
      error: (err) => alert('Failed to send reminder: ' + err.error?.error || 'Unknown error')
    });
  }

  // Pie Chart SVG Helper
  getPieSlicePath(startAngle: number, endAngle: number, radius: number = 40, cx: number = 50, cy: number = 50): string {
    if (endAngle - startAngle >= 360) {
      // Full circle — draw two arcs
      const r = radius;
      return `M ${cx},${cy - r} A ${r},${r} 0 1 1 ${cx},${cy + r} A ${r},${r} 0 1 1 ${cx},${cy - r} Z`;
    }
    const startRad = (startAngle - 90) * Math.PI / 180;
    const endRad = (endAngle - 90) * Math.PI / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${cx},${cy} L ${x1},${y1} A ${radius},${radius} 0 ${largeArc} 1 ${x2},${y2} Z`;
  }


  // Borrowers Stats
  // Borrowers Stats
  borrowers = computed(() => {
    const map = new Map<string, {
      name: string,
      totalLent: number,
      totalReceived: number,
      outstanding: number,
      profit: number,
      activeLoans: number,
      status: string,
      phone?: string,
      notes?: string
    }>();

    // 1. Add all known borrowers from directory fetch
    for (const b of this.loanService.borrowers()) {
      map.set(b.name, {
        name: b.name,
        totalLent: 0,
        totalReceived: 0,
        outstanding: 0,
        profit: 0,
        activeLoans: 0,
        status: 'Inactive',
        phone: b.phone,
        notes: b.notes
      });
    }

    // 2. Merge/Add data from transactions
    for (const t of this.transactions()) {
      let current = map.get(t.name);
      if (!current) {
        current = {
          name: t.name,
          totalLent: 0,
          totalReceived: 0,
          outstanding: 0,
          profit: 0,
          activeLoans: 0,
          status: 'Active'
        };
      }

      // Financials
      const received = this.loanService.getAmountReceived(t);
      const outstanding = t.amountGiven - received;
      const profit = received - t.amountGiven;

      current.totalLent += t.amountGiven;
      current.totalReceived += received;

      if (outstanding > 0) {
        current.outstanding += outstanding;
      }

      if (profit > 0) {
        current.profit += profit;
      }

      if (this.loanService.getStatus(t) === 'Active' || this.loanService.getStatus(t) === 'Overdue') {
        current.activeLoans++;
      }

      map.set(t.name, current);
    }

    // 3. Finalize Status
    return Array.from(map.values()).map(b => {
      if (b.activeLoans > 0) b.status = 'Active';
      else if (b.outstanding > 0) b.status = 'Overdue'; // Or Unsettled
      else if (b.profit > 0) b.status = 'Profitable';
      else if (b.totalLent > 0) b.status = 'Settled';
      else b.status = 'New / Inactive';
      return b;
    });
  });



  // Helpers (Delegated to Service)
  getAmountReceived(t: Transaction): number {
    return this.loanService.getAmountReceived(t);
  }

  getOutstanding(t: Transaction): string {
    const outstanding = t.amountGiven - this.getAmountReceived(t);
    return outstanding > 0 ? outstanding.toString() : 'Subject to profit';
  }

  getStatus(t: Transaction) {
    return this.loanService.getStatus(t);
  }



  getBorrowerTransactions(name: string): Transaction[] {
    return this.loanService.getBorrowerTransactions(name);
  }

  addTransaction() {
    if (this.name() && this.dateGiven() && this.amountGiven() !== null && this.percentage() !== null) {
      const newTransaction: Transaction = {
        id: crypto.randomUUID(),
        name: this.name(),
        dateGiven: this.dateGiven(),
        amountGiven: this.amountGiven()!,
        repayments: [],
        percentage: this.percentage()!,
        frequency: this.frequency(),
        installmentAmount: this.installmentAmount() || 0
      };

      this.loanService.addTransaction(newTransaction);
      this.resetForm();
      this.showAddTransactionModal.set(false);
    } else {
      alert('Please fill in all required fields (Amount and Interest Rate).');
    }
  }

  openAddTransaction() {
    this.resetForm();
    if (this.selectedBorrower()) {
      this.name.set(this.selectedBorrower()!);
    }
    this.showAddTransactionModal.set(true);
  }

  saveTransaction() {
    // Alias to addTransaction but using the specific modal signals if needed,
    // or we just reuse the addTransaction logic if we bind the modal to existing signals.
    // Let's bind the Modal to the existing signals (name, amountGiven, etc)
    // But we need to make sure we map 'newLoanAmount' to 'amountGiven' if we separated them.
    // Actually, let's use the standard signals: amountGiven, percentage, frequency...
    // I added newLoanAmount above but maybe I don't need it if I reuse amountGiven.
    // Let's reuse amountGiven to keep it simple.
    this.addTransaction();
  }

  openAddBorrower() {
    this.newBorrowerName.set('');
    this.newBorrowerPhone.set('');
    this.newBorrowerNotes.set('');
    this.showAddBorrowerModal.set(true);
  }

  saveBorrower() {
    if (this.newBorrowerName()) {
      this.loanService.createBorrower({
        name: this.newBorrowerName(),
        phone: this.newBorrowerPhone(),
        notes: this.newBorrowerNotes()
      });
      this.selectedBorrower.set(this.newBorrowerName()); // Go to their profile
      this.showAddBorrowerModal.set(false);
    }
  }

  switchTab(tab: 'dashboard' | 'loans' | 'borrowers' | 'settings') {
    this.currentTab.set(tab);
    this.selectedBorrower.set(null);
    this.showSettingsMenu.set(false);
  }

  // getProfit method removed as it's now handled within the service's getStatus logic

  generateStatement() {
    const borrowerName = this.name();
    if (!borrowerName) {
      alert('Please enter a borrower name in the form to generate a statement.');
      return;
    }

    const transactions = this.getBorrowerTransactions(borrowerName);
    if (transactions.length === 0) {
      alert(`No transactions found for borrower: ${borrowerName}`);
      return;
    }

    const data = transactions.map(t => ({
      Date: t.dateGiven,
      Type: t.frequency + ' Loan',
      Principal: t.amountGiven,
      Rate: t.percentage + '%',
      TotalDue: t.amountGiven * (1 + t.percentage / 100),
      Paid: this.getAmountReceived(t),
      Status: this.getStatus(t),
      History: JSON.stringify(t.repayments.map(r => `${r.date.split('T')[0]}: ${r.amount}`))
    }));

    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(data);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Statement');
    XLSX.writeFile(wb, `${borrowerName}_statement.xlsx`);
  }

  // Modal-based methods removed in favor of inline ledger editing


  startEditingLoan(t: Transaction) {
    this.editingLoanId.set(t.id);
    this.amountGiven.set(t.amountGiven);
    this.percentage.set(t.percentage);
    this.frequency.set(t.frequency);
    this.installmentAmount.set(t.installmentAmount);
    this.dateGiven.set(t.dateGiven);
  }


  startAddingRepayment() {
    this.isAddingHistoryEntry.set(true);
    this.newEntryType = 'Repayment';
    this.newEntryAmount = null;
    this.newEntryDate = new Date().toISOString().split('T')[0];

    // Optional: wait for render then scroll to bottom? 
    // For now simple state change is enough, user will see the row appear at bottom.
  }

  addHistoryEntry() {
    if (this.selectedBorrower() && this.newEntryAmount) {
      if (this.newEntryType === 'Loan') {
        const t: Partial<Transaction> = {
          name: this.selectedBorrower()!,
          amountGiven: this.newEntryAmount,
          dateGiven: this.newEntryDate,
          percentage: 3, // Default for quick add
          frequency: 'Monthly',
          installmentAmount: 0,
          repayments: []
        };
        this.loanService.addTransaction(t as Transaction);
      } else {
        // Find most recent active loan to apply repayment to
        const history = this.getBorrowerTransactions(this.selectedBorrower()!);
        if (history.length > 0) {
          const loanId = history[0].id;
          this.loanService.recordRepayment(loanId, this.newEntryAmount);
        }
      }
      this.cancelAddingHistory();
    }
  }

  cancelAddingHistory() {
    this.isAddingHistoryEntry.set(false);
    this.newEntryAmount = null;
    this.newEntryDate = new Date().toISOString().split('T')[0];
  }

  private resetForm() {
    this.name.set('');
    this.dateGiven.set(new Date().toISOString().split('T')[0]);
    this.amountGiven.set(null);
    this.percentage.set(3);
    this.frequency.set('Monthly');
    this.installmentAmount.set(null);
  }

  deleteUser(name: string) {
    if (confirm(`Are you sure you want to delete all history for ${name}? This cannot be undone.`)) {
      this.loanService.deleteBorrower(name);
      if (this.selectedBorrower() === name) {
        this.selectedBorrower.set(null); // Return to directory if deleting current user
      }
    }
  }

  deleteLoan(t: Transaction) {
    if (confirm(`Delete the ${t.frequency} loan of ${t.amountGiven}?`)) {
      this.loanService.deleteTransaction(t.id);
    }
  }

  // Selection Logic
  // Selection Logic
  toggleSelection(id: string | number) {
    const selected = new Set(this.selectedTransactionIds());
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
    this.selectedTransactionIds.set(selected);
  }

  toggleSelectAll() {
    const transactions = this.getBorrowerTransactions(this.selectedBorrower() || '');
    const current = new Set(this.selectedTransactionIds());

    if (this.isAllSelected()) {
      this.selectedTransactionIds.set(new Set());
    } else {
      const allIds = new Set<string | number>();
      for (const t of transactions) {
        allIds.add(t.id);
        for (let i = 0; i < t.repayments.length; i++) {
          const r = t.repayments[i];
          // Use ID if available, otherwise Index
          allIds.add(r.id || i);
        }
      }
      this.selectedTransactionIds.set(allIds);
    }
  }

  deleteSelected() {
    const ids = Array.from(this.selectedTransactionIds());
    if (ids.length === 0) return;

    if (confirm(`Are you sure you want to delete ${ids.length} selected items?`)) {
      const transactions = this.transactions();

      ids.forEach(id => {
        // Try deleting as a loan
        const loan = transactions.find(t => t.id === id);
        if (loan) {
          this.loanService.deleteTransaction(id as string);
        } else {
          // Find which loan this repayment belongs to
          for (const t of transactions) {
            // Find by ID or Index
            const repayment = t.repayments.find((r, i) => (r.id === id) || (i === id));
            if (repayment) {
              // Pass ID if available, else index
              const deleteId = repayment.id || id;
              this.loanService.deleteRepayment(t.id, deleteId);
              break;
            }
          }
        }
      });
      this.selectedTransactionIds.set(new Set());
    }
  }

  // Inline Editing Logic
  startEditingTransaction(t: Transaction) {
    this.editingTransactionId.set(t.id);
    // Populate form signals for editing
    this.newEntryAmount = t.amountGiven;
    // Ensure date is YYYY-MM-DD
    const dateStr = t.dateGiven ? new Date(t.dateGiven).toISOString().split('T')[0] : '';
    this.newEntryDate = dateStr;
  }

  saveTransactionEdit(t: Transaction) {
    if (this.newEntryAmount) {
      const updates: Partial<Transaction> = {
        amountGiven: this.newEntryAmount,
        dateGiven: this.newEntryDate
      };
      this.loanService.updateTransaction(t.id, updates);
      this.cancelTransactionEdit();
    }
  }

  cancelTransactionEdit() {
    this.editingTransactionId.set(null);
    this.newEntryAmount = null;
    this.newEntryDate = new Date().toISOString().split('T')[0];
  }

  startEditingRepayment(t: Transaction, r: any, index: number) {
    const key = `${t.id}_${r.id || index}`;
    this.editingRepaymentId.set(key);
    this.newEntryAmount = r.amount;
    // Ensure date is YYYY-MM-DD for input type="date"
    const dateStr = r.date ? new Date(r.date).toISOString().split('T')[0] : '';
    this.newEntryDate = dateStr;
  }

  saveRepaymentEdit(t: Transaction, r: any, index: number) {
    if (this.newEntryAmount) {
      const updates = {
        amount: this.newEntryAmount,
        date: this.newEntryDate
      };
      // Use ID if available, otherwise use index
      const idToUse = r.id || index;
      this.loanService.updateRepayment(t.id, idToUse, updates);
      this.cancelRepaymentEdit();
    }
  }

  cancelRepaymentEdit() {
    this.editingRepaymentId.set(null);
    this.newEntryAmount = null;
    this.newEntryDate = new Date().toISOString().split('T')[0];
  }

  startEditingName() {
    this.newNameEdit.set(this.selectedBorrower()!);
    this.isEditingName.set(true);
  }

  saveName() {
    const oldName = this.selectedBorrower();
    const newName = this.newNameEdit();
    if (oldName && newName && oldName !== newName) {
      this.loanService.renameBorrower(oldName, newName).subscribe(res => {
        if (res) {
          this.selectedBorrower.set(newName); // Update view to new name
          this.isEditingName.set(false);
        }
      });
    } else {
      this.isEditingName.set(false);
    }
  }

  cancelNameEdit() {
    this.isEditingName.set(false);
  }

  handleImportFile(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.loanService.importData(input.files[0]).then(
        (msg) => alert(msg),
        (err) => alert('Import failed: ' + err)
      );
      input.value = ''; // Reset so same file can be re-imported
    }
  }
}
