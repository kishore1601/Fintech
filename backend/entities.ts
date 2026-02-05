import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany, ManyToOne, JoinColumn } from 'typeorm';

@Entity('borrowers')
export class Borrower {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column({ nullable: true })
    phone: string;

    @Column({ nullable: true })
    notes: string;

    @CreateDateColumn()
    created_at: Date;

    @OneToMany(() => Loan, loan => loan.borrower)
    loans: Loan[];
}

@Entity('loans')
export class Loan {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'decimal', precision: 15, scale: 2 })
    principal_amount: number;

    @Column({ type: 'decimal', precision: 15, scale: 2 })
    outstanding_principal: number;

    @Column({ type: 'decimal', precision: 5, scale: 2 })
    interest_rate_input: number;

    @Column()
    interest_frequency: 'Weekly' | 'Monthly';

    @Column({ type: 'decimal', precision: 15, scale: 10 })
    daily_interest_rate: number;

    @Column({ type: 'date' })
    start_date: string;

    @Column({ type: 'date' })
    last_interest_calc_date: Date;

    @Column({ default: 'Active' })
    status: 'Active' | 'Closed' | 'Defaulted';

    @CreateDateColumn()
    created_at: Date;

    @ManyToOne(() => Borrower, borrower => borrower.loans)
    @JoinColumn({ name: 'borrower_id' })
    borrower: Borrower;

    @OneToMany(() => Payment, payment => payment.loan)
    payments: Payment[];
}

@Entity('payments')
export class Payment {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'date' })
    payment_date: Date;

    @Column({ type: 'decimal', precision: 15, scale: 2 })
    amount: number;

    @Column({ type: 'decimal', precision: 15, scale: 2 })
    interest_component: number;

    @Column({ type: 'decimal', precision: 15, scale: 2 })
    principal_component: number;

    @CreateDateColumn()
    created_at: Date;

    @ManyToOne(() => Loan, loan => loan.payments)
    @JoinColumn({ name: 'loan_id' })
    loan: Loan;
}
