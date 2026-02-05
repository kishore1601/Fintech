-- Database Schema for Banking-Grade Loan App
-- Strict Financial Types: DECIMAL(15,2) for currency, DECIMAL(10,8) for rates.

-- 1. Borrowers
CREATE TABLE borrowers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Loans
CREATE TABLE loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id UUID NOT NULL REFERENCES borrowers(id),
  
  -- Principal Types
  principal_amount DECIMAL(15, 2) NOT NULL CHECK (principal_amount > 0),
  outstanding_principal DECIMAL(15, 2) NOT NULL DEFAULT 0 CHECK (outstanding_principal >= 0),
  
  -- Interest Configuration
  interest_rate_input DECIMAL(5, 2) NOT NULL, -- The user-facing rate (e.g. 5.00 for 5%)
  interest_frequency TEXT NOT NULL CHECK (interest_frequency IN ('Weekly', 'Monthly')),
  daily_interest_rate DECIMAL(15, 10) NOT NULL, -- PRECISION CRITICAL: stored daily rate
  
  -- Dates
  start_date DATE NOT NULL,
  last_interest_calc_date DATE NOT NULL, -- The "Paid Thru" date for interest
  
  -- Status
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Closed', 'Defaulted')),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Payments (Immutable Ledger)
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id),
  
  payment_date DATE NOT NULL,
  amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
  
  -- Allocation (Calculated by Backend)
  interest_component DECIMAL(15, 2) NOT NULL CHECK (interest_component >= 0),
  principal_component DECIMAL(15, 2) NOT NULL CHECK (principal_component >= 0),
  
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() -- Never updated
);

-- Indexes for performance
CREATE INDEX idx_loans_borrower ON loans(borrower_id);
CREATE INDEX idx_payments_loan ON payments(loan_id);
