import { Injectable } from '@nestjs/common';
import { differenceInCalendarDays } from 'date-fns'; // Assumption: date-fns is installed

@Injectable()
export class InterestService {
    /**
     * Calculates interest accrued between two dates using Simple Interest.
     * Formula: Principal * DailyRate * Days
     * @param principal The outstanding principal amount
     * @param dailyRate The pre-calculated daily interest rate (decimal)
     * @param lastCalcDate The date interest was last calculated (exclusive)
     * @param targetDate The date to calculate interest up to (inclusive)
     */
    calculateAccruedInterest(
        principal: number,
        dailyRate: number,
        lastCalcDate: Date | string,
        targetDate: Date | string
    ): number {
        const start = new Date(lastCalcDate);
        const end = new Date(targetDate);

        // Calculate days elapsed (inclusive of payment date, exclusive of last calc date)
        // Example: Last calc Jan 1. Payment Jan 5. Days = 4 (2, 3, 4, 5).
        const days = differenceInCalendarDays(end, start);

        if (days <= 0) {
            return 0;
        }

        const interest = principal * dailyRate * days;
        return parseFloat(interest.toFixed(2)); // Round to 2 decimals usually, or keep high precision if internal
    }

    /**
     * Converts a user-friendly rate (e.g. 5%) to a daily decimal rate.
     * @param rate Input rate (e.g., 5.0 for 5%)
     * @param frequency 'Weekly' or 'Monthly'
     */
    convertRateToDaily(rate: number, frequency: 'Weekly' | 'Monthly'): number {
        const decimalRate = rate / 100;
        let divisor = 30; // Default Monthly

        if (frequency === 'Weekly') {
            divisor = 7;
        }

        // We do NOT round here to maintain precision
        return decimalRate / divisor;
    }
}
