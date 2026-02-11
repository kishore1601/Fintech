import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="login-container">
      <div class="glass glass-card login-card">
        <div class="text-center mb-2">
          <h2 class="neon-text-blue">Recover Account</h2>
          <p class="text-gray" *ngIf="step() === 1">Enter your details to receive an OTP</p>
          <p class="text-gray" *ngIf="step() === 2">Enter the OTP sent to your phone</p>
        </div>

        <!-- Step 1: Username & Phone -->
        <div *ngIf="step() === 1" class="form-group fade-in">
          <label>Username</label>
          <input type="text" [(ngModel)]="username" class="glass-input" placeholder="Enter username">
          
          <label>Phone Number</label>
          <input type="text" [(ngModel)]="phoneNumber" class="glass-input" placeholder="Enter linked phone number">
          
          <button class="btn-primary login-btn mt-1" (click)="sendOtp()" [disabled]="isLoading() || !username || !phoneNumber">
            {{ isLoading() ? 'Sending...' : 'Send OTP' }}
          </button>
        </div>

        <!-- Step 2: OTP & New Password -->
        <div *ngIf="step() === 2" class="form-group fade-in">
          <label>OTP Code</label>
          <input type="text" [(ngModel)]="otp" class="glass-input" placeholder="Enter 6-digit OTP">
          
          <label class="mt-1">New Password</label>
          <input type="password" [(ngModel)]="newPassword" class="glass-input" placeholder="New password">

          <button class="btn-primary login-btn mt-1" (click)="verify()" [disabled]="isLoading() || !otp || !newPassword">
            {{ isLoading() ? 'Verifying...' : 'Reset Password' }}
          </button>
        </div>

        <div class="error-msg" *ngIf="error()">
          <i class="fas fa-exclamation-circle"></i> {{ error() }}
        </div>

        <div class="success-msg" *ngIf="successMsg()">
          <i class="fas fa-check-circle"></i> {{ successMsg() }}
        </div>

        <div class="mt-2 text-center">
            <a routerLink="/login" class="text-link">Back to Login</a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .login-container {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: radial-gradient(circle at top right, #1a1a2e, #0f0f1a);
    }
    .login-card {
      width: 100%;
      max-width: 400px;
      padding: 2rem;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.03);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
    }
    .glass-input {
      width: 100%;
      padding: 12px;
      margin-top: 5px;
      margin-bottom: 15px;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      color: white;
      font-size: 1rem;
      outline: none;
      transition: all 0.3s ease;
    }
    .glass-input:focus {
      border-color: #6c5ce7;
      box-shadow: 0 0 10px rgba(108, 92, 231, 0.3);
    }
    .btn-primary {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #6c5ce7, #a29bfe);
      border: none;
      border-radius: 8px;
      color: white;
      font-weight: bold;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn-primary:not(:disabled):hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 15px rgba(108, 92, 231, 0.4);
    }
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .text-link {
        color: #a29bfe;
        text-decoration: none;
        font-size: 0.9rem;
    }
    .text-link:hover {
        text-decoration: underline;
    }
    .error-msg {
      color: #ff7675;
      margin-top: 1rem;
      text-align: center;
      background: rgba(255, 0, 0, 0.1);
      padding: 0.5rem;
      border-radius: 8px;
    }
    .success-msg {
      color: #55efc4;
      margin-top: 1rem;
      text-align: center;
      background: rgba(0, 255, 128, 0.1);
      padding: 0.5rem;
      border-radius: 8px;
    }
    .text-gray { color: rgba(255,255,255,0.6); font-size: 0.9rem; }
    .fade-in { animation: fadeIn 0.5s ease-in; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  `]
})
export class ForgotPasswordComponent {
  auth = inject(AuthService);
  router = inject(Router);

  step = signal(1);
  username = '';
  phoneNumber = '';
  otp = '';
  newPassword = '';
  isLoading = signal(false);
  error = signal('');
  successMsg = signal('');

  sendOtp() {
    this.isLoading.set(true);
    this.error.set('');
    this.successMsg.set('');

    this.auth.forgotPassword(this.username, this.phoneNumber).subscribe({
      next: (res: any) => {
        this.isLoading.set(false);
        this.successMsg.set(res.message);

        // FOR DEMO PURPOSES: Show OTP in alert since no real SMS
        if (res.debugOtp) {
          alert(`[DEMO SMS] Your OTP is: ${res.debugOtp}`);
        }

        setTimeout(() => {
          this.step.set(2);
          this.successMsg.set(''); // Clear success msg for next step cleanliness
        }, 1500);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.error.set(err.error.error || 'Failed to send OTP');
      }
    });
  }

  verify() {
    this.isLoading.set(true);
    this.error.set('');

    this.auth.verifyOtp({ username: this.username, otp: this.otp, newPassword: this.newPassword }).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        this.successMsg.set(res.message + ' Redirecting...');
        setTimeout(() => this.router.navigate(['/login']), 2000);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.error.set(err.error.error || 'Verification failed');
      }
    });
  }
}
