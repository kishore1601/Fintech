import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="login-container">
      <!-- Glow Effect backdrop -->
      <div class="glow-orb" style="top: 20%; left: 30%; background: var(--primary);"></div>
      <div class="glow-orb" style="bottom: 20%; right: 30%; background: var(--secondary);"></div>

      <div class="glass glass-card login-card">
        <div style="margin-bottom: 2.5rem; position: relative;">
            <div style="width: 60px; height: 5px; background: var(--primary); margin: 0 auto 10px; border-radius: 10px; box-shadow: 0 0 10px var(--primary-glow);"></div>
            <h1 class="logo-title">KishoreFintech</h1>
            <p class="subtitle">Secure Admin Access</p>
        </div>

        <div class="form-group">
            <label>Username</label>
            <input type="text" [(ngModel)]="username" placeholder="Enter username" class="ledger-input">
        </div>

        <div class="form-group">
            <label>Password</label>
            <div class="input-wrapper">
                <input [type]="showPassword() ? 'text' : 'password'" [(ngModel)]="password" placeholder="Enter password" class="ledger-input" style="padding-right: 40px;">
                <button type="button" class="password-toggle" (click)="showPassword.set(!showPassword())">
                    <!-- Eye Icon (Show) -->
                    <svg *ngIf="!showPassword()" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    <!-- Eye Off Icon (Hide) -->
                    <svg *ngIf="showPassword()" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M1 1l22 22"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path></svg>
                </button>
            </div>
            <div style="text-align: right; margin-top: 0.5rem;">
                <a routerLink="/forgot-password" class="text-link-sm">Forgot Password?</a>
            </div>
        </div>

        <div *ngIf="error()" class="error-msg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            {{ error() }}
        </div>

        <button class="btn-primary login-btn" (click)="onLogin()" [disabled]="auth.isLoading()">
            <span>{{ auth.isLoading() ? 'Verifying...' : 'Access Dashboard' }}</span>
            <svg *ngIf="!auth.isLoading()" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .login-container {
      height: 100vh;
      width: 100vw;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg-dark);
      position: relative;
      overflow: hidden;
    }

    .glow-orb {
        position: absolute;
        width: 300px;
        height: 300px;
        border-radius: 50%;
        filter: blur(100px);
        opacity: 0.2;
        animation: float 6s ease-in-out infinite;
    }

    @keyframes float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-20px); }
    }

    .login-card {
      width: 100%;
      max-width: 420px;
      padding: 3.5rem 2.5rem;
      border: 1px solid var(--glass-border);
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(20px);
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      text-align: center;
      z-index: 10;
    }

    .logo-title {
      font-size: 2.2rem;
      font-weight: 800;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, var(--text-pure), var(--primary));
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -1px;
    }

    .subtitle {
      color: var(--text-med);
      font-size: 0.95rem;
      letter-spacing: 0.5px;
    }

    .form-group {
      margin-bottom: 1.5rem;
      text-align: left;
    }

    .form-group label {
      display: block;
      margin-bottom: 0.75rem;
      color: var(--text-med);
      font-size: 0.9rem;
      font-weight: 600;
      margin-left: 4px;
    }

    .input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
    }

    .ledger-input {
      width: 100%;
      padding: 1rem 1.25rem;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      color: var(--text-pure);
      outline: none;
      font-size: 1rem;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .ledger-input:focus {
      border-color: var(--primary);
      background: rgba(255, 255, 255, 0.06);
      box-shadow: 0 0 0 4px var(--primary-glow);
      transform: translateY(-1px);
    }

    .password-toggle {
        position: absolute;
        right: 15px;
        background: none;
        border: none;
        color: var(--text-med);
        cursor: pointer;
        padding: 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.2s;
    }

    .password-toggle:hover {
        color: var(--text-pure);
    }

    .login-btn {
      width: 100%;
      margin-top: 1.5rem;
      padding: 1.1rem;
      font-size: 1.05rem;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      color: white;
      border: none;
      border-radius: 16px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
      transition: all 0.3s ease;
    }

    .login-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(99, 102, 241, 0.5);
    }

    .login-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
        transform: none;
    }

    .error-msg {
      color: var(--error);
      background: rgba(239, 68, 68, 0.1);
      padding: 1rem;
      border-radius: 12px;
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 10px;
      justify-content: center;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }
    .text-link-sm {
        font-size: 0.8rem;
        color: var(--text-med);
        text-decoration: none;
        transition: color 0.2s;
        cursor: pointer;
    }
    .text-link-sm:hover {
        color: var(--primary);
        text-decoration: underline;
    }
  `]
})
export class LoginComponent {
  auth = inject(AuthService);

  username = '';
  password = '';
  showPassword = signal(false);
  error = signal('');

  onLogin() {
    if (!this.username || !this.password) {
      this.error.set('Please enter both username and password');
      return;
    }

    this.auth.login(this.username, this.password).subscribe((res: any) => {
      if (!res.success) {
        this.error.set(res.error || 'Invalid credentials');
      } else {
        this.error.set('');
      }
    });
  }
}
