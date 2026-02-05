import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Loan } from './loan.entity'; // Assumed entity
import { Payment } from './payment.entity'; // Assumed entity
import { InterestService } from './interest.service';

@Injectable()
export class PaymentService {
    constructor(
        @InjectRepository(Loan)
        private loanRepo: Repository<Loan>,
        @InjectRepository(Payment)
        private paymentRepo: Repository<Payment>,
        private interestService: InterestService,
        private dataSource: DataSource,
    ) { }

    async recordPayment(loanId: string, amount: number, paymentDate: Date) {
        // Start Transaction
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // 1. Fetch Loan with Lock (Pessimistic Write to prevent race conditions)
            const loan = await queryRunner.manager.findOne(Loan, {
                where: { id: loanId },
                lock: { mode: 'pessimistic_write' }
            });

            if (!loan) throw new NotFoundException('Loan not found');

            // 2. Calculate Accrued Interest since last calculation
            const accruedInterest = this.interestService.calculateAccruedInterest(
                loan.outstanding_principal,
                loan.daily_interest_rate,
                loan.last_interest_calc_date,
                paymentDate
            );

            // 3. Allocate Payment (Interest First Rule)
            let interestComponent = 0;
            let principalComponent = 0;
            let remainingPayment = amount;

            // a. Pay off accrued interest first
            if (remainingPayment >= accruedInterest) {
                interestComponent = accruedInterest;
                remainingPayment -= accruedInterest;
            } else {
                interestComponent = remainingPayment;
                remainingPayment = 0;
            }

            // b. Remainder goes to principal
            principalComponent = remainingPayment;

            // 4. Update Loan State
            loan.outstanding_principal -= principalComponent;

            // CRITICAL: Move the interest clock forward to the payment date
            // We have "settled" the interest up to this date
            loan.last_interest_calc_date = paymentDate;

            if (loan.outstanding_principal <= 0) {
                loan.outstanding_principal = 0;
                loan.status = 'Closed';
            }

            // 5. Save Changes
            const payment = new Payment();
            payment.loan = loan;
            payment.payment_date = paymentDate;
            payment.amount = amount;
            payment.interest_component = interestComponent;
            payment.principal_component = principalComponent;

            await queryRunner.manager.save(loan);
            await queryRunner.manager.save(payment);

            await queryRunner.commitTransaction();

            return {
                paymentId: payment.id,
                allocatedInterest: interestComponent,
                allocatedPrincipal: principalComponent,
                remainingLoanBalance: loan.outstanding_principal
            };

        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }
}
