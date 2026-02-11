import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../auth.service';

@Component({
    selector: 'app-profile-settings',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
    <div class="settings-container">
      <div class="glass glass-card settings-card">
        <h2 class="neon-text-blue mb-2">Profile Settings</h2>
        
        <div class="form-group fade-in">
          <label>Current Password <span class="text-red">*</span></label>
          <input type="password" [(ngModel)]="currentPassword" class="glass-input" placeholder="Required to make changes">
        </div>

        <hr class="glass-divider">

        <h3 class="text-white mt-2">Update Details</h3>
        
        <div class="form-group fade-in">
          <label>New Username</label>
          <input type="text" [(ngModel)]="newUsername" class="glass-input" placeholder="Leave blank to keep current">
        </div>

        <div class="form-group fade-in">
          <label>New Phone Number</label>
          <input type="text" [(ngModel)]="newPhone" class="glass-input" placeholder="Leave blank to keep current">
        </div>

        <div class="form-group fade-in">
          <label>New Password</label>
          <input type="password" [(ngModel)]="newPassword" class="glass-input" placeholder="Leave blank to keep current">
        </div>

        <button class="btn-primary mt-2" (click)="update()" [disabled]="isLoading() || !currentPassword">
          {{ isLoading() ? 'Updating...' : 'Save Changes' }}
        </button>

        <div class="error-msg" *ngIf="error()">
          <i class="fas fa-exclamation-circle"></i> {{ error() }}
        </div>

        <div class="success-msg" *ngIf="successMsg()">
          <i class="fas fa-check-circle"></i> {{ successMsg() }}
        </div>
      </div>
    </div>
  `,
    styles: [`
    .settings-container {
      padding: 2rem;
      display: flex;
      justify-content: center;
    }
    .settings-card {
      width: 100%;
      max-width: 500px;
      padding: 2rem;
      background: rgba(255, 255, 255, 0.03);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.1);
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
    }
    .glass-input:focus {
      border-color: #6c5ce7;
    }
    .glass-divider {
        border: 0;
        height: 1px;
        background: rgba(255, 255, 255, 0.1);
        margin: 1.5rem 0;
    }
    .btn-primary {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #00cec9, #0984e3);
      border: none;
      border-radius: 8px;
      color: white;
      font-weight: bold;
      cursor: pointer;
    }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .text-red { color: #ff7675; }
    .text-white { color: white; }
    .error-msg { color: #ff7675; margin-top: 1rem; text-align: center; background: rgba(255,0,0,0.1); padding: 0.5rem; border-radius: 8px; }
    .success-msg { color: #55efc4; margin-top: 1rem; text-align: center; background: rgba(0,255,128,0.1); padding: 0.5rem; border-radius: 8px; }
  `]
})
export class ProfileSettingsComponent {
    auth = inject(AuthService);

    currentPassword = '';
    newUsername = '';
    newPhone = '';
    newPassword = '';

    isLoading = signal(false);
    error = signal('');
    successMsg = signal('');

    update() {
        this.isLoading.set(true);
        this.error.set('');
        this.successMsg.set('');

        const payload = {
            currentPassword: this.currentPassword,
            newUsername: this.newUsername || undefined,
            newPhone: this.newPhone || undefined,
            newPassword: this.newPassword || undefined
        };

        this.auth.updateProfile(payload).subscribe({
            next: (res) => {
                this.isLoading.set(false);
                this.successMsg.set(res.message);
                if (res.token) {
                    // Token updated (username changed), maybe reload or notify
                }
                // Clear sensitive fields
                this.currentPassword = '';
                this.newPassword = '';
            },
            error: (err) => {
                this.isLoading.set(false);
                this.error.set(err.error.error || 'Update failed');
            }
        });
    }
}
