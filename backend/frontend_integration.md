# Frontend Integration Guide

This guide explains how to refactor the Angular application to consume the banking-grade backend.

## 1. Create Angular Services
Stop calculating interest in components. Use services to fetch data.

`ng g s services/loan`
`ng g s services/borrower`

### LoanService Example
```typescript
@Injectable({ providedIn: 'root' })
export class LoanService {
  private apiUrl = 'http://localhost:3000/loans';
  constructor(private http: HttpClient) {}

  // Fetch Dashboard Summary
  // The backend should provide a /summary endpoint that returns pre-calculated totals
  getSummary() {
    return this.http.get<{ totalLent: number, interestEarned: number }>(`${this.apiUrl}/summary`);
  }

  // Create Loan
  createLoan(data: CreateLoanDto) {
    return this.http.post(this.apiUrl, data);
  }

  // Record Payment
  recordPayment(loanId: string, amount: number, date: string) {
    return this.http.post(`${this.apiUrl}/${loanId}/payments`, { amount, date });
  }

  // Get Detail
  getLoanDetail(id: string) {
    return this.http.get<LoanDetail>(`${this.apiUrl}/${id}`);
  }
}
```

## 2. Refactor Components

### Dashboard (`App` Component)
- **Delete**: Remove `computed` signals that calculate totals from local transactions.
- **Add**: `ngOnInit` (or resource effect) to call `LoanService.getSummary()`.
- **Display**: Bind UI to the data returned from API.

### New Loan Form
- **Delete**: `this.transactions.update(...)` logic.
- **Add**: Call `LoanService.createLoan(formValues).subscribe(...)`.
- The backend will handle the `daily_interest_rate` calculation.

### Record Payment Modal
- **Delete**: Math logic that updates arrays.
- **Add**: Call `LoanService.recordPayment(id, amount, date)`.
- **Refresh**: Re-fetch the loan detail after success to see the updated `outstanding_principal`.

## 3. Data Flow

1.  **User Action**: User enters payment of ₹10,000.
2.  **Angular**: Sends `POST /loans/:id/payments` with body `{ amount: 10000, date: '2024-02-01' }`.
3.  **NestJS Controller**: Receives request, delegates to `PaymentService`.
4.  **PaymentService**:
    *   Locks the loan row.
    *   Calculates accrued interest from DB state.
    *   Splits ₹10,000 into Interest and Principal.
    *   Updates Loan balance.
    *   Inserts Payment record.
5.  **Response**: Returns `{ paymentId: '...', allocatedInterest: 500, allocatedPrincipal: 9500, remaining: 40500 }`.
6.  **Angular**: Receives response. Shows success toast. Refetches Loan to update UI.

## Key Rule: Trust the Backend
- **Do not** try to predict the outstanding balance in the frontend.
- **Do not** calculate "Next Interest" in the frontend for official display.
- Always display what the backend returns.
